export type HomeExperienceState =
  | "hero"
  | "transitioning-to-carousel"
  | "carousel"
  | "transitioning-to-hero";

export type CarouselSlideIndex = 0 | 1 | 2;

export interface HomeExperienceModel {
  experience: HomeExperienceState;
  activeSlide: CarouselSlideIndex;
}

export type HomeExperienceAction =
  | { type: "OPEN_CAROUSEL"; slide: number }
  | { type: "RETURN_TO_HERO" }
  | { type: "FINISH_TRANSITION" }
  | { type: "SET_SLIDE"; slide: number };

export const INITIAL_HOME_EXPERIENCE: HomeExperienceModel = {
  experience: "hero",
  activeSlide: 0,
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

export const WHEEL_GESTURE_INTENT_THRESHOLD = 10;
export const WHEEL_GESTURE_THRESHOLD = 52;
export const WHEEL_GESTURE_REVERSE_THRESHOLD = 28;
export const WHEEL_GESTURE_QUIET_MS = 180;

export interface WheelGestureState {
  totalX: number;
  totalY: number;
  direction: -1 | 0 | 1;
  consumed: boolean;
  oppositeTotal: number;
  lastEventAt: number;
}

export const INITIAL_WHEEL_GESTURE: WheelGestureState = {
  totalX: 0,
  totalY: 0,
  direction: 0,
  consumed: false,
  oppositeTotal: 0,
  lastEventAt: 0,
};

interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  now: number;
  activeSlide: CarouselSlideIndex;
  locked: boolean;
}

export interface WheelGestureDecision {
  state: WheelGestureState;
  nextSlide: CarouselSlideIndex | null;
  preventDefault: boolean;
}

/**
 * Reduces a browser wheel stream into at most one carousel move per gesture.
 * Trackpad momentum remains consumed until the stream goes quiet, while a
 * deliberate direction reversal can navigate as soon as the slide unlocks.
 */
export function reduceWheelGesture(
  previous: WheelGestureState,
  input: WheelGestureInput,
): WheelGestureDecision {
  const { deltaX, deltaY, now, activeSlide, locked } = input;
  const quiet =
    previous.lastEventAt === 0 ||
    now - previous.lastEventAt >= WHEEL_GESTURE_QUIET_MS;
  const state = quiet ? INITIAL_WHEEL_GESTURE : previous;
  const horizontalEvent = hasHorizontalWheelIntent(deltaX, deltaY);

  if (!horizontalEvent) {
    return {
      state:
        state.direction !== 0 && !state.consumed
          ? { ...state, totalY: state.totalY + deltaY, lastEventAt: now }
          : quiet
            ? INITIAL_WHEEL_GESTURE
            : previous,
      nextSlide: null,
      preventDefault: false,
    };
  }

  const direction = deltaX > 0 ? 1 : -1;

  // Transition locks absorb the remainder of the triggering gesture without
  // allowing small momentum bounces to redefine its direction.
  if (locked) {
    return {
      state: {
        ...state,
        totalX: 0,
        totalY: 0,
        consumed: true,
        oppositeTotal: 0,
        lastEventAt: now,
      },
      nextSlide: null,
      preventDefault: true,
    };
  }

  // Same-direction momentum is consumed until the stream goes quiet. A strong
  // opposite movement after unlock is treated as a deliberate reverse gesture;
  // tiny opposite deltas are ignored as trackpad bounce.
  if (state.consumed) {
    if (state.direction === direction) {
      return {
        state: {
          ...state,
          totalX: 0,
          totalY: 0,
          oppositeTotal: 0,
          lastEventAt: now,
        },
        nextSlide: null,
        preventDefault: true,
      };
    }
    const oppositeTotal = state.oppositeTotal + deltaX;
    if (Math.abs(oppositeTotal) < WHEEL_GESTURE_REVERSE_THRESHOLD) {
      return {
        state: { ...state, oppositeTotal, lastEventAt: now },
        nextSlide: null,
        preventDefault: true,
      };
    }
    const nextSlide = clampSlide(activeSlide + direction);
    return {
      state: {
        totalX: 0,
        totalY: 0,
        direction,
        consumed: true,
        oppositeTotal: 0,
        lastEventAt: now,
      },
      nextSlide: nextSlide === activeSlide ? null : nextSlide,
      preventDefault: true,
    };
  }

  const totalX =
    state.direction === 0 || state.direction === direction
      ? state.totalX + deltaX
      : deltaX;
  const totalY =
    state.direction === 0 || state.direction === direction
      ? state.totalY + deltaY
      : deltaY;
  const horizontalIntent =
    Math.abs(totalX) >= WHEEL_GESTURE_INTENT_THRESHOLD &&
    Math.abs(totalX) >= Math.abs(totalY) * 0.7;

  if (!horizontalIntent) {
    return {
      state: {
        totalX,
        totalY,
        direction: 0,
        consumed: false,
        oppositeTotal: 0,
        lastEventAt: now,
      },
      nextSlide: null,
      preventDefault: horizontalEvent,
    };
  }

  if (Math.abs(totalX) < WHEEL_GESTURE_THRESHOLD) {
    return {
      state: {
        totalX,
        totalY,
        direction,
        consumed: false,
        oppositeTotal: 0,
        lastEventAt: now,
      },
      nextSlide: null,
      preventDefault: true,
    };
  }

  const nextSlide = clampSlide(activeSlide + direction);
  return {
    state: {
      totalX: 0,
      totalY: 0,
      direction,
      consumed: true,
      oppositeTotal: 0,
      lastEventAt: now,
    },
    nextSlide: nextSlide === activeSlide ? null : nextSlide,
    preventDefault: true,
  };
}

export function isTransitioning(experience: HomeExperienceState): boolean {
  return experience === "transitioning-to-carousel" || experience === "transitioning-to-hero";
}

export function homeExperienceReducer(
  state: HomeExperienceModel,
  action: HomeExperienceAction,
): HomeExperienceModel {
  switch (action.type) {
    case "OPEN_CAROUSEL":
      if (isTransitioning(state.experience)) return state;
      return state.experience === "carousel"
        ? { ...state, activeSlide: clampSlide(action.slide) }
        : {
            experience: "transitioning-to-carousel",
            activeSlide: clampSlide(action.slide),
          };
    case "RETURN_TO_HERO":
      if (state.experience !== "carousel") return state;
      return { ...state, experience: "transitioning-to-hero" };
    case "FINISH_TRANSITION":
      if (state.experience === "transitioning-to-carousel") {
        return { ...state, experience: "carousel" };
      }
      if (state.experience === "transitioning-to-hero") {
        return { ...state, experience: "hero" };
      }
      return state;
    case "SET_SLIDE":
      if (state.experience !== "carousel") return state;
      return { ...state, activeSlide: clampSlide(action.slide) };
    default:
      return state;
  }
}
