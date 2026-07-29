import { describe, it, expect } from "vitest";
import { minMax, combine } from "@/scripts/validation/rank";

describe("code-validation family-score blending", () => {
  it("minMax scales to 0..1 and collapses all-equal maps to 0.5", () => {
    expect(minMax({ a: 10, b: 20, c: 30 })).toEqual({ a: 0, b: 0.5, c: 1 });
    expect(minMax({ a: 7, b: 7 })).toEqual({ a: 0.5, b: 0.5 });
  });

  it("combine min-max normalizes each arm before weighting", () => {
    // structured favours a; embeddings favours c. Equal weight → b (middling in both) loses to the extremes.
    const c = combine({ a: 100, b: 50, c: 0 }, { a: 0, b: 0.5, c: 1 }, 0.5);
    expect(c.a).toBeCloseTo(0.5);
    expect(c.b).toBeCloseTo(0.5);
    expect(c.c).toBeCloseTo(0.5);
    // Weight fully on structured preserves the normalized structured map.
    const s = combine({ a: 100, b: 50, c: 0 }, { a: 0, b: 0.5, c: 1 }, 1);
    expect(s).toEqual({ a: 1, b: 0.5, c: 0 });
  });

  it("combine tolerates arms with missing keys", () => {
    const c = combine({ a: 1 }, { b: 1 }, 0.5);
    expect(c).toEqual({ a: 0.25, b: 0.25 });
  });
});
