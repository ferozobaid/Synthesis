import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clampSlide,
  dragThreshold,
  hasDownwardHeroWheelIntent,
  hasHorizontalWheelIntent,
  hasReturnToHeroTouchIntent,
  hasReturnToHeroWheelIntent,
  homeExperienceReducer,
  INITIAL_HOME_EXPERIENCE,
  INITIAL_HOME_GESTURE,
  isHowItWorksLocation,
  reduceHomeWheelGesture,
  removeHowItWorksLocation,
  resetHomeGestureState,
  shouldUnlockCarouselTransition,
  WHEEL_GESTURE_QUIET_MS,
  type HomeGestureContext,
  type HomeGestureState,
} from "@/components/home/homeExperienceState";

const HERO_CONTEXT: HomeGestureContext = {
  experience: "hero",
  activeSlide: 0,
  transitionLocked: false,
  reducedMotion: false,
};

const CAROUSEL_CONTEXT: HomeGestureContext = {
  experience: "carousel",
  activeSlide: 0,
  transitionLocked: false,
  reducedMotion: false,
};

function wheel(
  state: HomeGestureState,
  overrides: Partial<
    HomeGestureContext & {
      deltaX: number;
      deltaY: number;
      now: number;
      activeScrollTop: number;
    }
  >,
) {
  return reduceHomeWheelGesture(state, {
    ...CAROUSEL_CONTEXT,
    deltaX: 0,
    deltaY: 0,
    now: 10,
    activeScrollTop: 0,
    ...overrides,
  });
}

describe("home experience state", () => {
  it("opens Slide 1 through a locked hero-to-carousel transition", () => {
    const transitioning = homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
      type: "OPEN_CAROUSEL",
      slide: 0,
    });
    expect(transitioning).toEqual({
      experience: "transitioning-to-carousel",
      activeSlide: 0,
      transitionLock: "experience",
      reducedMotion: false,
    });
    expect(
      homeExperienceReducer(transitioning, {
        type: "FINISH_EXPERIENCE_TRANSITION",
      }),
    ).toEqual({
      experience: "carousel",
      activeSlide: 0,
      transitionLock: null,
      reducedMotion: false,
    });
  });

  it("opens the requested How-it-works slide without creating slide history", () => {
    const transitioning = homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
      type: "OPEN_CAROUSEL",
      slide: 1,
    });
    expect(transitioning.activeSlide).toBe(1);
    expect(transitioning.transitionLock).toBe("experience");
  });

  it("ignores conflicting actions during an experience transition", () => {
    const transitioning = homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
      type: "OPEN_CAROUSEL",
      slide: 0,
    });
    expect(
      homeExperienceReducer(transitioning, {
        type: "OPEN_CAROUSEL",
        slide: 2,
      }),
    ).toBe(transitioning);
  });

  it("returns explicitly from carousel to a reset landing hero", () => {
    const carousel = {
      ...INITIAL_HOME_EXPERIENCE,
      experience: "carousel" as const,
      activeSlide: 2 as const,
    };
    const returning = homeExperienceReducer(carousel, {
      type: "RETURN_TO_HERO",
    });
    expect(returning.experience).toBe("transitioning-to-hero");
    expect(returning.transitionLock).toBe("experience");
    expect(
      homeExperienceReducer(returning, {
        type: "FINISH_EXPERIENCE_TRANSITION",
      }),
    ).toEqual(INITIAL_HOME_EXPERIENCE);
  });

  it("owns and resets the slide transition lock", () => {
    const carousel = {
      ...INITIAL_HOME_EXPERIENCE,
      experience: "carousel" as const,
      activeSlide: 0 as const,
    };
    const moving = homeExperienceReducer(carousel, {
      type: "SET_SLIDE",
      slide: 1,
    });
    expect(moving.activeSlide).toBe(1);
    expect(moving.transitionLock).toBe("slide");
    expect(
      homeExperienceReducer(moving, { type: "SET_SLIDE", slide: 2 }),
    ).toBe(moving);
    expect(
      homeExperienceReducer(moving, {
        type: "FINISH_SLIDE_TRANSITION",
      }),
    ).toEqual({ ...moving, transitionLock: null });
  });

  it("stores reduced-motion behavior in the same experience model", () => {
    expect(
      homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
        type: "SET_REDUCED_MOTION",
        reducedMotion: true,
      }).reducedMotion,
    ).toBe(true);
  });

  it("clamps slide navigation to the three valid positions", () => {
    expect(clampSlide(-4)).toBe(0);
    expect(clampSlide(1)).toBe(1);
    expect(clampSlide(9)).toBe(2);
  });
});

describe("homepage history location", () => {
  it("recognizes the supported query and hash entry forms", () => {
    expect(isHowItWorksLocation("?view=how-it-works", "")).toBe(true);
    expect(isHowItWorksLocation("", "#how-it-works")).toBe(true);
    expect(isHowItWorksLocation("?view=landing", "")).toBe(false);
  });

  it("removes only stale carousel state without adding a history entry", () => {
    expect(
      removeHowItWorksLocation(
        "/",
        "?view=how-it-works&sample=true",
        "#how-it-works",
      ),
    ).toBe("/?sample=true");
    expect(removeHowItWorksLocation("/", "?sample=true", "#details")).toBe(
      "/?sample=true#details",
    );
  });
});

describe("home gesture state machine", () => {
  it("uses a bounded viewport-relative mouse-drag threshold", () => {
    expect(dragThreshold(320)).toBe(48);
    expect(dragThreshold(1000)).toBe(80);
    expect(dragThreshold(2400)).toBe(96);
  });

  it("requires clear dominant-axis intent", () => {
    expect(hasHorizontalWheelIntent(40, 10)).toBe(true);
    expect(hasHorizontalWheelIntent(10, 40)).toBe(false);
    expect(hasDownwardHeroWheelIntent(2, 12)).toBe(true);
    expect(hasDownwardHeroWheelIntent(20, 12)).toBe(false);
  });

  it("opens Slide 1 after deliberate downward hero accumulation", () => {
    const first = reduceHomeWheelGesture(INITIAL_HOME_GESTURE, {
      ...HERO_CONTEXT,
      deltaX: 2,
      deltaY: 28,
      now: 10,
      activeScrollTop: 0,
    });
    const second = reduceHomeWheelGesture(first.state, {
      ...HERO_CONTEXT,
      deltaX: 1,
      deltaY: 26,
      now: 30,
      activeScrollTop: 0,
    });

    expect(first.action).toBeNull();
    expect(first.preventDefault).toBe(true);
    expect(second.action).toBe("open-carousel");
  });

  it("does not open from a small accidental hero wheel movement", () => {
    const small = reduceHomeWheelGesture(INITIAL_HOME_GESTURE, {
      ...HERO_CONTEXT,
      deltaX: 0,
      deltaY: 4,
      now: 10,
      activeScrollTop: 0,
    });
    expect(small.action).toBeNull();
    expect(small.preventDefault).toBe(false);
  });

  it("consumes horizontal hero gestures without any route action", () => {
    const horizontal = reduceHomeWheelGesture(INITIAL_HOME_GESTURE, {
      ...HERO_CONTEXT,
      deltaX: -42,
      deltaY: 4,
      now: 10,
      activeScrollTop: 0,
    });
    expect(horizontal.preventDefault).toBe(true);
    expect(horizontal.action).toBeNull();
    expect(horizontal.nextSlide).toBeNull();
  });

  it("moves forward Slide 1 → 2 → 3 on distinct gestures", () => {
    const toSecond = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaX: 60,
      activeSlide: 0,
      now: 10,
    });
    const toThird = wheel(toSecond.state, {
      deltaX: 60,
      activeSlide: 1,
      now: 10 + WHEEL_GESTURE_QUIET_MS,
    });
    expect(toSecond.nextSlide).toBe(1);
    expect(toThird.nextSlide).toBe(2);
  });

  it("moves backward Slide 3 → 2 → 1 on distinct gestures", () => {
    const fromThird = wheel(
      resetHomeGestureState({ ...CAROUSEL_CONTEXT, activeSlide: 2 }),
      { deltaX: -60, activeSlide: 2, now: 10 },
    );
    const fromSecond = wheel(fromThird.state, {
      deltaX: -60,
      activeSlide: 1,
      now: 10 + WHEEL_GESTURE_QUIET_MS,
    });
    expect(fromThird.nextSlide).toBe(1);
    expect(fromSecond.nextSlide).toBe(0);
  });

  it("keeps Behavioural → How it works → backward swipe inside the carousel", () => {
    const result = wheel(
      resetHomeGestureState({ ...CAROUSEL_CONTEXT, activeSlide: 1 }),
      { deltaX: -60, activeSlide: 1 },
    );
    expect(result.nextSlide).toBe(0);
    expect(result.action).toBeNull();
    expect(result.preventDefault).toBe(true);
  });

  it("suppresses same-direction momentum until the stream resets", () => {
    const moved = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaX: 60,
      activeSlide: 0,
      now: 10,
    });
    const momentum = wheel(moved.state, {
      deltaX: 90,
      activeSlide: 1,
      now: 40,
    });
    const fresh = wheel(momentum.state, {
      deltaX: 60,
      activeSlide: 1,
      now: 40 + WHEEL_GESTURE_QUIET_MS,
    });

    expect(momentum.nextSlide).toBeNull();
    expect(momentum.state.cooldown).toBe(true);
    expect(fresh.nextSlide).toBe(2);
  });

  it("ignores a small bounce and accepts an immediate deliberate reversal", () => {
    const moved = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaX: 60,
      activeSlide: 0,
      now: 10,
    });
    const bounce = wheel(moved.state, {
      deltaX: -8,
      activeSlide: 1,
      now: 30,
    });
    const reverse = wheel(bounce.state, {
      deltaX: -24,
      activeSlide: 1,
      now: 45,
    });

    expect(bounce.nextSlide).toBeNull();
    expect(reverse.nextSlide).toBe(0);
  });

  it("buffers a strong reversal while the current slide is locked", () => {
    const moved = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaX: 60,
      activeSlide: 0,
      now: 10,
    });
    const lockedReverse = wheel(moved.state, {
      deltaX: -44,
      activeSlide: 1,
      transitionLocked: true,
      now: 40,
    });

    expect(lockedReverse.nextSlide).toBeNull();
    expect(lockedReverse.state.pendingDirection).toBe(-1);
    expect(lockedReverse.preventDefault).toBe(true);
  });

  it("resets accumulation and consumes movement at both boundaries", () => {
    const beforeFirst = wheel(
      resetHomeGestureState(CAROUSEL_CONTEXT),
      { deltaX: -60, activeSlide: 0 },
    );
    const afterLast = wheel(
      resetHomeGestureState({ ...CAROUSEL_CONTEXT, activeSlide: 2 }),
      { deltaX: 60, activeSlide: 2 },
    );

    expect(beforeFirst.nextSlide).toBeNull();
    expect(beforeFirst.state.totalX).toBe(0);
    expect(beforeFirst.state.cooldown).toBe(true);
    expect(afterLast.nextSlide).toBeNull();
    expect(afterLast.state.totalX).toBe(0);
    expect(afterLast.state.cooldown).toBe(true);
  });

  it("allows upward exit only from Slide 1 at the scroll top", () => {
    const fromFirst = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaY: -50,
      activeSlide: 0,
      activeScrollTop: 0,
    });
    const fromSecond = wheel(
      resetHomeGestureState({ ...CAROUSEL_CONTEXT, activeSlide: 1 }),
      {
        deltaY: -50,
        activeSlide: 1,
        activeScrollTop: 0,
      },
    );
    const scrolledFirst = wheel(resetHomeGestureState(CAROUSEL_CONTEXT), {
      deltaY: -50,
      activeSlide: 0,
      activeScrollTop: 20,
    });

    expect(fromFirst.action).toBe("return-to-hero");
    expect(fromSecond.action).toBeNull();
    expect(fromSecond.preventDefault).toBe(false);
    expect(scrolledFirst.action).toBeNull();
  });

  it("recognizes the equivalent touch exit only from a top-starting gesture", () => {
    expect(hasReturnToHeroTouchIntent(8, 70, true)).toBe(true);
    expect(hasReturnToHeroTouchIntent(8, 70, false)).toBe(false);
    expect(hasReturnToHeroTouchIntent(70, 24, true)).toBe(false);
    expect(hasReturnToHeroWheelIntent(4, -28, 0)).toBe(true);
  });

  it("unlocks only from the active slide's own transform transition", () => {
    expect(shouldUnlockCarouselTransition(1, 1, "transform", true)).toBe(true);
    expect(shouldUnlockCarouselTransition(0, 1, "transform", true)).toBe(false);
    expect(shouldUnlockCarouselTransition(1, 1, "opacity", true)).toBe(false);
    expect(shouldUnlockCarouselTransition(1, 1, "transform", false)).toBe(false);
  });
});

describe("home interaction wiring", () => {
  it("keeps slide gestures route-neutral and cleans every native listener", () => {
    const homeGestures = readFileSync(
      "components/home/useHomeExperienceGestures.ts",
      "utf8",
    );
    const carouselGestures = readFileSync(
      "components/home/useCarouselGestures.ts",
      "utf8",
    );
    const carousel = readFileSync(
      "components/home/SynthesisCarousel.tsx",
      "utf8",
    );

    for (const source of [homeGestures, carouselGestures, carousel]) {
      expect(source).not.toMatch(/router\.(push|replace|back)/);
      expect(source).not.toMatch(/history\.(pushState|replaceState|back)/);
    }
    expect(homeGestures).toContain('passive: false, capture: true');
    expect(homeGestures).toContain(
      'removeEventListener("wheel", onWheel, true)',
    );
    expect(carouselGestures).toContain(
      'removeEventListener("touchmove", onTouchMove)',
    );
  });

  it("wires hero wheel and Explore button entry to Slide 1", () => {
    const experience = readFileSync(
      "components/home/SynthesisHomeExperience.tsx",
      "utf8",
    );
    expect(experience).toContain("useHomeExperienceGestures({");
    expect(experience).toContain("openCarousel: () => openCarousel(0)");
    expect(experience).toContain("onExplore={() => openCarousel(0)}");
  });

  it("preserves arrows, indicators, keyboard control, focus, and explicit exit", () => {
    const carousel = readFileSync(
      "components/home/SynthesisCarousel.tsx",
      "utf8",
    );
    expect(carousel).toContain('event.key === "ArrowLeft"');
    expect(carousel).toContain('event.key === "ArrowRight"');
    expect(carousel).toContain('event.key === "Home"');
    expect(carousel).toContain('event.key === "End"');
    expect(carousel).toContain("focusActiveHeading");
    expect(carousel).toContain("Back to landing");
    expect(carousel).toContain("activeSlide === 0");
    expect(carousel).toContain('aria-label="Back to landing"');
    expect(carousel).toContain("<CarouselControls");
  });

  it("preserves orbit motion and neutralizes it for reduced motion", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    expect(styles).toMatch(
      /\.home-carousel__slide\s*\{[^}]*transform 460ms cubic-bezier\(\.16, 1, \.3, 1\)/s,
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.home-carousel__slide[\s\S]*?transition-duration: \.01ms !important;/,
    );
  });
});
