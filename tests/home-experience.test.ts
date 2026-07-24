import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  clampSlide,
  dragThreshold,
  hasHorizontalWheelIntent,
  hasReturnToHeroTouchIntent,
  hasReturnToHeroWheelIntent,
  homeExperienceReducer,
  INITIAL_HOME_EXPERIENCE,
  INITIAL_WHEEL_GESTURE,
  reduceWheelGesture,
  shouldUnlockCarouselTransition,
  WHEEL_GESTURE_QUIET_MS,
} from "@/components/home/homeExperienceState";

describe("home experience state", () => {
  it("opens a requested slide through the carousel transition", () => {
    const transitioning = homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
      type: "OPEN_CAROUSEL",
      slide: 1,
    });
    expect(transitioning).toEqual({
      experience: "transitioning-to-carousel",
      activeSlide: 1,
    });
    expect(homeExperienceReducer(transitioning, { type: "FINISH_TRANSITION" })).toEqual({
      experience: "carousel",
      activeSlide: 1,
    });
  });

  it("ignores conflicting actions during an experience transition", () => {
    const transitioning = homeExperienceReducer(INITIAL_HOME_EXPERIENCE, {
      type: "OPEN_CAROUSEL",
      slide: 0,
    });
    expect(
      homeExperienceReducer(transitioning, { type: "OPEN_CAROUSEL", slide: 2 }),
    ).toBe(transitioning);
    expect(homeExperienceReducer(transitioning, { type: "RETURN_TO_HERO" })).toBe(
      transitioning,
    );
  });

  it("returns from carousel to the hero cleanly", () => {
    const carousel = { experience: "carousel" as const, activeSlide: 2 as const };
    const returning = homeExperienceReducer(carousel, { type: "RETURN_TO_HERO" });
    expect(returning.experience).toBe("transitioning-to-hero");
    expect(homeExperienceReducer(returning, { type: "FINISH_TRANSITION" })).toEqual({
      experience: "hero",
      activeSlide: 2,
    });
  });

  it("clamps slide navigation to the three valid positions", () => {
    expect(clampSlide(-4)).toBe(0);
    expect(clampSlide(1)).toBe(1);
    expect(clampSlide(9)).toBe(2);
  });
});

describe("home carousel gesture decisions", () => {
  it("uses a bounded viewport-relative drag threshold", () => {
    expect(dragThreshold(320)).toBe(48);
    expect(dragThreshold(1000)).toBe(80);
    expect(dragThreshold(2400)).toBe(96);
  });

  it("requires clear horizontal wheel intent", () => {
    expect(hasHorizontalWheelIntent(40, 10)).toBe(true);
    expect(hasHorizontalWheelIntent(10, 40)).toBe(false);
    expect(hasHorizontalWheelIntent(12, 10)).toBe(true);
  });

  it("recognizes an upward trackpad gesture only at the top of a slide", () => {
    expect(hasReturnToHeroWheelIntent(4, -28, 0)).toBe(true);
    expect(hasReturnToHeroWheelIntent(4, -28, 18)).toBe(false);
    expect(hasReturnToHeroWheelIntent(4, 28, 0)).toBe(false);
    expect(hasReturnToHeroWheelIntent(30, -18, 0)).toBe(false);
  });

  it("recognizes a touch pull-down return only when the gesture starts at the top", () => {
    expect(hasReturnToHeroTouchIntent(8, 70, true)).toBe(true);
    expect(hasReturnToHeroTouchIntent(8, 70, false)).toBe(false);
    expect(hasReturnToHeroTouchIntent(8, -70, true)).toBe(false);
    expect(hasReturnToHeroTouchIntent(70, 24, true)).toBe(false);
  });

  it("unlocks only from the active slide's own transform transition", () => {
    expect(shouldUnlockCarouselTransition(1, 1, "transform", true)).toBe(true);
    expect(shouldUnlockCarouselTransition(0, 1, "transform", true)).toBe(false);
    expect(shouldUnlockCarouselTransition(1, 1, "opacity", true)).toBe(false);
    expect(shouldUnlockCarouselTransition(1, 1, "transform", false)).toBe(false);
  });

  it("advances forward through slide 2 to slide 3", () => {
    const first = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 32,
      deltaY: 2,
      now: 10,
      activeSlide: 1,
      locked: false,
    });
    const second = reduceWheelGesture(first.state, {
      deltaX: 30,
      deltaY: 1,
      now: 30,
      activeSlide: 1,
      locked: false,
    });

    expect(first.nextSlide).toBeNull();
    expect(second.nextSlide).toBe(2);
    expect(second.preventDefault).toBe(true);
  });

  it("recognizes diagonal trackpad streams in both directions", () => {
    const forward = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 54,
      deltaY: 38,
      now: 10,
      activeSlide: 0,
      locked: false,
    });
    const backward = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: -54,
      deltaY: 38,
      now: 10,
      activeSlide: 2,
      locked: false,
    });

    expect(forward.nextSlide).toBe(1);
    expect(backward.nextSlide).toBe(1);
  });

  it("navigates backward immediately after the completed forward transition", () => {
    const forward = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 60,
      deltaY: 0,
      now: 10,
      activeSlide: 1,
      locked: false,
    });
    const whileLocked = reduceWheelGesture(forward.state, {
      deltaX: 24,
      deltaY: 0,
      now: 30,
      activeSlide: 2,
      locked: true,
    });
    const reverse = reduceWheelGesture(whileLocked.state, {
      deltaX: -60,
      deltaY: 0,
      now: 45,
      activeSlide: 2,
      locked: false,
    });

    expect(whileLocked.nextSlide).toBeNull();
    expect(reverse.nextSlide).toBe(1);
  });

  it("suppresses same-direction momentum until the wheel stream resets", () => {
    const moved = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 60,
      deltaY: 0,
      now: 10,
      activeSlide: 0,
      locked: false,
    });
    const momentum = reduceWheelGesture(moved.state, {
      deltaX: 90,
      deltaY: 0,
      now: 40,
      activeSlide: 1,
      locked: false,
    });
    const freshGesture = reduceWheelGesture(momentum.state, {
      deltaX: 60,
      deltaY: 0,
      now: 40 + WHEEL_GESTURE_QUIET_MS,
      activeSlide: 1,
      locked: false,
    });

    expect(momentum.nextSlide).toBeNull();
    expect(freshGesture.nextSlide).toBe(2);
  });

  it("ignores a small direction bounce but accepts a deliberate reversal", () => {
    const moved = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 60,
      deltaY: 0,
      now: 10,
      activeSlide: 0,
      locked: false,
    });
    const bounce = reduceWheelGesture(moved.state, {
      deltaX: -8,
      deltaY: 0,
      now: 30,
      activeSlide: 1,
      locked: false,
    });
    const reverse = reduceWheelGesture(bounce.state, {
      deltaX: -24,
      deltaY: 0,
      now: 45,
      activeSlide: 1,
      locked: false,
    });

    expect(bounce.nextSlide).toBeNull();
    expect(reverse.nextSlide).toBe(0);
  });

  it("resets accumulation at the first and last slide boundaries", () => {
    const beforeFirst = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: -60,
      deltaY: 0,
      now: 10,
      activeSlide: 0,
      locked: false,
    });
    const afterLast = reduceWheelGesture(INITIAL_WHEEL_GESTURE, {
      deltaX: 60,
      deltaY: 0,
      now: 10,
      activeSlide: 2,
      locked: false,
    });

    expect(beforeFirst.nextSlide).toBeNull();
    expect(beforeFirst.state.totalX).toBe(0);
    expect(afterLast.nextSlide).toBeNull();
    expect(afterLast.state.totalX).toBe(0);
  });
});

describe("home carousel interaction styling", () => {
  it("releases card transforms after entry and restores the nested hover reactions", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(
      /\.home-carousel__slide\.is-active \.home-module-card\s*\{[^}]*animation:[^;]*backwards;/s,
    );
    expect(styles).toContain(
      ".home-module-card:hover .home-module-card__glyph",
    );
    expect(styles).toContain(".home-module-card:hover::after");
    expect(styles).toContain(".home-module-card:hover > strong");
  });

  it("uses the quicker slide transition and wires the return gesture to the hero", () => {
    const styles = readFileSync("app/globals.css", "utf8");
    const carousel = readFileSync("components/home/SynthesisCarousel.tsx", "utf8");
    const experience = readFileSync(
      "components/home/SynthesisHomeExperience.tsx",
      "utf8",
    );

    expect(styles).toMatch(
      /\.home-carousel__slide\s*\{[^}]*transform 460ms cubic-bezier\(\.16, 1, \.3, 1\)/s,
    );
    expect(carousel).toContain("returnToHero: onReturnToHero");
    expect(experience).toContain("onReturnToHero={returnToHero}");
  });
});
