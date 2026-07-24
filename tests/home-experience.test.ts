import { describe, expect, it } from "vitest";
import {
  clampSlide,
  dragThreshold,
  hasHorizontalWheelIntent,
  homeExperienceReducer,
  INITIAL_HOME_EXPERIENCE,
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
    expect(hasHorizontalWheelIntent(12, 10)).toBe(false);
  });
});
