import { describe, expect, it } from "vitest";
import { resolveRevealState } from "@/components/ui/useRevealOnScroll";

describe("resolveRevealState", () => {
  it("renders visible when IntersectionObserver is unsupported", () => {
    expect(resolveRevealState(false, false, false)).toBe(true);
    expect(resolveRevealState(false, true, false)).toBe(true);
  });

  it("renders visible under reduced motion", () => {
    expect(resolveRevealState(true, true, false)).toBe(true);
  });

  it("hides only pre-intersection with IO available and motion allowed", () => {
    expect(resolveRevealState(true, false, false)).toBe(false);
    expect(resolveRevealState(true, false, true)).toBe(true);
  });
});
