export type HomeExperienceState =
  | "hero"
  | "transitioning-to-carousel"
  | "carousel"
  | "transitioning-to-hero";

export type CarouselSlideIndex = 0 | 1 | 2;
export type HomeTransitionLock = "experience" | "slide" | null;
export type GestureDirection = -1 | 0 | 1;
export type GestureAxis = "undecided" | "horizontal" | "vertical";

export interface HomeExperienceModel {
  experience: HomeExperienceState;
  activeSlide: CarouselSlideIndex;
  transitionLock: HomeTransitionLock;
  reducedMotion: boolean;
}

export type HomeExperienceAction =
  | { type: "OPEN_CAROUSEL"; slide: number }
  | { type: "RETURN_TO_HERO" }
  | { type: "FINISH_EXPERIENCE_TRANSITION" }
  | { type: "SET_SLIDE"; slide: number }
  | { type: "FINISH_SLIDE_TRANSITION" }
  | { type: "SET_REDUCED_MOTION"; reducedMotion: boolean };

export const INITIAL_HOME_EXPERIENCE: HomeExperienceModel = {
  experience: "hero",
  activeSlide: 0,
  transitionLock: null,
  reducedMotion: false,
};

export function clampSlide(slide: number): CarouselSlideIndex {
  return Math.min(2, Math.max(0, Math.round(slide))) as CarouselSlideIndex;
}

export function dragThreshold(viewportWidth: number): number {
  return Math.min(96, Math.max(48, viewportWidth * 0.08));
}

export function shouldUnlockCarouselTransition(
  slide: CarouselSlideIndex,
  activeSlide: CarouselSlideIndex,
  propertyName: string,
  selfTarget: boolean,
): boolean {
  return slide === activeSlide && propertyName === "transform" && selfTarget;
}

export function hasHorizontalWheelIntent(deltaX: number, deltaY: number): boolean {
  return Math.abs(deltaX) >= 1 && Math.abs(deltaX) >= Math.abs(deltaY) * 0.7;
}

export function hasDownwardHeroWheelIntent(deltaX: number, deltaY: number): boolean {
  return (
    deltaY > 0 &&
    Math.abs(deltaY) >= 2 &&
    Math.abs(deltaY) >= Math.abs(deltaX) * 1.2
  );
}

export function hasReturnToHeroWheelIntent(
  deltaX: number,
  deltaY: number,
  scrollTop: number,
): boolean {
  return (
    scrollTop <= 1 &&
    deltaY < 0 &&
    Math.abs(deltaY) >= 2 &&
    Math.abs(deltaY) >= Math.abs(deltaX) * 1.2
  );
}

export function hasReturnToHeroTouchIntent(
  deltaX: number,
  deltaY: number,
  startedAtTop: boolean,
): boolean {
  return (
    startedAtTop &&
    deltaY > 0 &&
    Math.abs(deltaY) >= Math.abs(deltaX) * 1.2
  );
}

export const HERO_WHEEL_ACTIVATION_THRESHOLD = 52;
export const WHEEL_GESTURE_INTENT_THRESHOLD = 8;
export const WHEEL_GESTURE_THRESHOLD = 38;
export const WHEEL_GESTURE_REVERSE_THRESHOLD = 22;
export const WHEEL_GESTURE_QUIET_MS = 150;
export const RETURN_TO_HERO_WHEEL_THRESHOLD = 46;
export const RETURN_TO_HERO_TOUCH_THRESHOLD = 64;

/**
 * One state record describes the complete homepage wheel stream. UI context is
 * copied into it so every event is decided against the same stage, slide, lock,
 * and reduced-motion state as its accumulated intent and momentum cooldown.
 */
export interface HomeGestureState {
  experience: HomeExperienceState;
  activeSlide: CarouselSlideIndex;
  transitionLocked: boolean;
  reducedMotion: boolean;
  totalX: number;
  totalY: number;
  axis: GestureAxis;
  momentumDirection: GestureDirection;
  cooldown: boolean;
  oppositeTotal: number;
  pendingDirection: GestureDirection;
  exitTotal: number;
  lastEventAt: number;
}

export interface HomeGestureContext {
  experience: HomeExperienceState;
  activeSlide: CarouselSlideIndex;
  transitionLocked: boolean;
  reducedMotion: boolean;
}

export const INITIAL_HOME_GESTURE: HomeGestureState = {
  experience: "hero",
  activeSlide: 0,
  transitionLocked: false,
  reducedMotion: false,
  totalX: 0,
  totalY: 0,
  axis: "undecided",
  momentumDirection: 0,
  cooldown: false,
  oppositeTotal: 0,
  pendingDirection: 0,
  exitTotal: 0,
  lastEventAt: 0,
};

export function resetHomeGestureState(
  context: HomeGestureContext,
  previous?: HomeGestureState,
  preserveMomentum = false,
): HomeGestureState {
  return {
    ...INITIAL_HOME_GESTURE,
    ...context,
    momentumDirection: preserveMomentum ? previous?.momentumDirection ?? 0 : 0,
    cooldown: preserveMomentum ? previous?.cooldown ?? false : false,
    lastEventAt: preserveMomentum ? previous?.lastEventAt ?? 0 : 0,
  };
}

interface HomeWheelGestureInput extends HomeGestureContext {
  deltaX: number;
  deltaY: number;
  now: number;
  activeScrollTop: number;
}

export interface HomeWheelGestureDecision {
  state: HomeGestureState;
  action: "open-carousel" | "return-to-hero" | null;
  nextSlide: CarouselSlideIndex | null;
  preventDefault: boolean;
}

function decision(
  state: HomeGestureState,
  preventDefault: boolean,
  nextSlide: CarouselSlideIndex | null = null,
  action: HomeWheelGestureDecision["action"] = null,
): HomeWheelGestureDecision {
  return { state, action, nextSlide, preventDefault };
}

/**
 * Reduces hero and carousel wheel input into one intentional action at a time.
 * The caller owns the single scoped wheel listener and performs the returned
 * action; this reducer never touches routing or browser history.
 */
export function reduceHomeWheelGesture(
  previous: HomeGestureState,
  input: HomeWheelGestureInput,
): HomeWheelGestureDecision {
  const {
    deltaX,
    deltaY,
    now,
    experience,
    activeSlide,
    transitionLocked,
    reducedMotion,
    activeScrollTop,
  } = input;
  const context: HomeGestureContext = {
    experience,
    activeSlide,
    transitionLocked,
    reducedMotion,
  };
  const quiet =
    previous.lastEventAt === 0 ||
    now - previous.lastEventAt >= WHEEL_GESTURE_QUIET_MS;
  const base = quiet
    ? resetHomeGestureState(context)
    : { ...previous, ...context };
  const horizontalEvent = hasHorizontalWheelIntent(deltaX, deltaY);

  // During either panel transition, absorb horizontal intent across the whole
  // homepage so a browser history gesture cannot begin in the entrance window.
  if (experience !== "hero" && experience !== "carousel") {
    if (!horizontalEvent) return decision(base, false);
    return decision(
      {
        ...base,
        totalX: 0,
        totalY: 0,
        axis: "horizontal",
        lastEventAt: now,
      },
      true,
    );
  }

  if (experience === "hero") {
    if (horizontalEvent) {
      return decision(
        {
          ...base,
          totalX: base.axis === "horizontal" ? base.totalX + deltaX : deltaX,
          totalY: base.axis === "horizontal" ? base.totalY + deltaY : deltaY,
          axis: "horizontal",
          lastEventAt: now,
        },
        true,
      );
    }

    if (!hasDownwardHeroWheelIntent(deltaX, deltaY)) {
      return decision(
        {
          ...base,
          totalX: 0,
          totalY: 0,
          axis: "undecided",
        },
        false,
      );
    }

    const totalY = base.axis === "vertical" ? base.totalY + deltaY : deltaY;
    const state: HomeGestureState = {
      ...base,
      totalX: base.axis === "vertical" ? base.totalX + deltaX : deltaX,
      totalY,
      axis: "vertical",
      lastEventAt: now,
    };
    if (totalY < HERO_WHEEL_ACTIVATION_THRESHOLD) {
      return decision(state, totalY >= WHEEL_GESTURE_INTENT_THRESHOLD);
    }
    return decision(resetHomeGestureState(context), true, null, "open-carousel");
  }

  const exitIntent =
    activeSlide === 0 &&
    hasReturnToHeroWheelIntent(deltaX, deltaY, activeScrollTop);
  if (exitIntent && !transitionLocked) {
    const exitTotal =
      base.axis === "vertical" ? base.exitTotal + deltaY : deltaY;
    const state: HomeGestureState = {
      ...base,
      totalX: 0,
      totalY: 0,
      axis: "vertical",
      oppositeTotal: 0,
      exitTotal,
      lastEventAt: now,
    };
    if (exitTotal > -RETURN_TO_HERO_WHEEL_THRESHOLD) {
      return decision(state, true);
    }
    return decision(resetHomeGestureState(context), true, null, "return-to-hero");
  }

  if (!horizontalEvent) {
    return decision(
      {
        ...base,
        totalX: 0,
        totalY: 0,
        axis: "undecided",
        oppositeTotal: 0,
        exitTotal: 0,
      },
      false,
    );
  }

  const direction: GestureDirection = deltaX > 0 ? 1 : -1;

  // Keep consuming the triggering stream while a slide is moving. A strong
  // opposite stream is buffered and applied only after the transition unlocks.
  if (transitionLocked) {
    const reversing =
      base.cooldown &&
      base.momentumDirection !== 0 &&
      direction !== base.momentumDirection;
    const oppositeTotal = reversing ? base.oppositeTotal + deltaX : 0;
    return decision(
      {
        ...base,
        totalX: 0,
        totalY: 0,
        axis: "horizontal",
        oppositeTotal,
        pendingDirection:
          reversing && Math.abs(oppositeTotal) >= WHEEL_GESTURE_THRESHOLD
            ? direction
            : base.pendingDirection,
        exitTotal: 0,
        lastEventAt: now,
      },
      true,
    );
  }

  // Same-direction momentum remains in cooldown until the stream goes quiet.
  // A deliberate opposite stream may reverse immediately after unlock.
  if (base.cooldown) {
    if (base.momentumDirection === direction) {
      return decision(
        {
          ...base,
          totalX: 0,
          totalY: 0,
          axis: "horizontal",
          oppositeTotal: 0,
          exitTotal: 0,
          lastEventAt: now,
        },
        true,
      );
    }

    const oppositeTotal = base.oppositeTotal + deltaX;
    if (Math.abs(oppositeTotal) < WHEEL_GESTURE_REVERSE_THRESHOLD) {
      return decision(
        {
          ...base,
          axis: "horizontal",
          oppositeTotal,
          exitTotal: 0,
          lastEventAt: now,
        },
        true,
      );
    }

    const nextSlide = clampSlide(activeSlide + direction);
    const state: HomeGestureState = {
      ...resetHomeGestureState(context),
      axis: "horizontal",
      momentumDirection: direction,
      cooldown: true,
      lastEventAt: now,
    };
    return decision(
      state,
      true,
      nextSlide === activeSlide ? null : nextSlide,
    );
  }

  const totalX =
    base.axis === "undecided" || base.axis === "horizontal"
      ? base.totalX + deltaX
      : deltaX;
  const totalY =
    base.axis === "undecided" || base.axis === "horizontal"
      ? base.totalY + deltaY
      : deltaY;
  const horizontalIntent =
    Math.abs(totalX) >= WHEEL_GESTURE_INTENT_THRESHOLD &&
    Math.abs(totalX) >= Math.abs(totalY) * 0.7;
  const accumulating: HomeGestureState = {
    ...base,
    totalX,
    totalY,
    axis: horizontalIntent ? "horizontal" : "undecided",
    oppositeTotal: 0,
    exitTotal: 0,
    lastEventAt: now,
  };

  if (!horizontalIntent || Math.abs(totalX) < WHEEL_GESTURE_THRESHOLD) {
    return decision(accumulating, true);
  }

  const nextSlide = clampSlide(activeSlide + direction);
  const consumed: HomeGestureState = {
    ...resetHomeGestureState(context),
    axis: "horizontal",
    momentumDirection: direction,
    cooldown: true,
    lastEventAt: now,
  };
  return decision(
    consumed,
    true,
    nextSlide === activeSlide ? null : nextSlide,
  );
}

export function isTransitioning(experience: HomeExperienceState): boolean {
  return experience === "transitioning-to-carousel" || experience === "transitioning-to-hero";
}

export function isHowItWorksLocation(search: string, hash: string): boolean {
  return (
    new URLSearchParams(search).get("view") === "how-it-works" ||
    hash.toLowerCase() === "#how-it-works"
  );
}

export function removeHowItWorksLocation(
  pathname: string,
  search: string,
  hash: string,
): string {
  const params = new URLSearchParams(search);
  if (params.get("view") === "how-it-works") params.delete("view");
  const nextSearch = params.toString();
  const nextHash = hash.toLowerCase() === "#how-it-works" ? "" : hash;
  return `${pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash}`;
}

export function homeExperienceReducer(
  state: HomeExperienceModel,
  action: HomeExperienceAction,
): HomeExperienceModel {
  switch (action.type) {
    case "OPEN_CAROUSEL":
      if (isTransitioning(state.experience)) return state;
      if (state.experience === "carousel") {
        const activeSlide = clampSlide(action.slide);
        if (activeSlide === state.activeSlide || state.transitionLock) return state;
        return { ...state, activeSlide, transitionLock: "slide" };
      }
      return {
        ...state,
        experience: "transitioning-to-carousel",
        activeSlide: clampSlide(action.slide),
        transitionLock: "experience",
      };
    case "RETURN_TO_HERO":
      if (state.experience === "hero" || state.experience === "transitioning-to-hero") {
        return state;
      }
      return {
        ...state,
        experience: "transitioning-to-hero",
        transitionLock: "experience",
      };
    case "FINISH_EXPERIENCE_TRANSITION":
      if (state.experience === "transitioning-to-carousel") {
        return { ...state, experience: "carousel", transitionLock: null };
      }
      if (state.experience === "transitioning-to-hero") {
        return {
          ...state,
          experience: "hero",
          activeSlide: 0,
          transitionLock: null,
        };
      }
      return state;
    case "SET_SLIDE": {
      if (state.experience !== "carousel" || state.transitionLock) return state;
      const activeSlide = clampSlide(action.slide);
      if (activeSlide === state.activeSlide) return state;
      return { ...state, activeSlide, transitionLock: "slide" };
    }
    case "FINISH_SLIDE_TRANSITION":
      return state.transitionLock === "slide"
        ? { ...state, transitionLock: null }
        : state;
    case "SET_REDUCED_MOTION":
      return state.reducedMotion === action.reducedMotion
        ? state
        : { ...state, reducedMotion: action.reducedMotion };
    default:
      return state;
  }
}
