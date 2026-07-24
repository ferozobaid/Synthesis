import { describe, expect, it } from "vitest";
import {
  canConsumeHorizontalDelta,
  isDominantHorizontalGesture,
} from "@/components/ui/productGestureGuard";

describe("product page horizontal gesture guard", () => {
  it("blocks dominant horizontal trackpad streams but leaves vertical scrolling native", () => {
    expect(isDominantHorizontalGesture(42, 8)).toBe(true);
    expect(isDominantHorizontalGesture(-42, 8)).toBe(true);
    expect(isDominantHorizontalGesture(8, 42)).toBe(false);
    expect(isDominantHorizontalGesture(1, 0)).toBe(false);
  });

  it("allows a nested horizontal scroller while it has room in the gesture direction", () => {
    expect(
      canConsumeHorizontalDelta({
        scrollLeft: 40,
        scrollWidth: 500,
        clientWidth: 200,
        deltaX: 30,
      }),
    ).toBe(true);
    expect(
      canConsumeHorizontalDelta({
        scrollLeft: 40,
        scrollWidth: 500,
        clientWidth: 200,
        deltaX: -30,
      }),
    ).toBe(true);
  });

  it("blocks route swipes at nested-scroll boundaries", () => {
    expect(
      canConsumeHorizontalDelta({
        scrollLeft: 0,
        scrollWidth: 500,
        clientWidth: 200,
        deltaX: -30,
      }),
    ).toBe(false);
    expect(
      canConsumeHorizontalDelta({
        scrollLeft: 300,
        scrollWidth: 500,
        clientWidth: 200,
        deltaX: 30,
      }),
    ).toBe(false);
    expect(
      canConsumeHorizontalDelta({
        scrollLeft: 0,
        scrollWidth: 200,
        clientWidth: 200,
        deltaX: 30,
      }),
    ).toBe(false);
  });
});
