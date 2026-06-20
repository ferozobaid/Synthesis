import { describe, it, expect } from "vitest";
import { rankDesc, minMax, combine, top1, inTopK } from "@/scripts/validation/rank";

describe("validation rank helpers", () => {
  it("rankDesc orders by score desc, ties broken by family name", () => {
    const r = rankDesc({ b: 0.5, a: 0.9, c: 0.5 });
    expect(r.map((x) => x.family)).toEqual(["a", "b", "c"]); // a highest; b before c on tie
  });

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
    // Weight fully on structured → ranking follows structured.
    const s = combine({ a: 100, b: 50, c: 0 }, { a: 0, b: 0.5, c: 1 }, 1);
    expect(top1(rankDesc(s))).toBe("a");
  });

  it("combine tolerates arms with missing keys", () => {
    const c = combine({ a: 1 }, { b: 1 }, 0.5);
    expect(top1(rankDesc(c))).not.toBeNull();
  });

  it("top1 and inTopK read a ranking correctly", () => {
    const ranked = rankDesc({ a: 0.9, b: 0.8, c: 0.7, d: 0.1 });
    expect(top1(ranked)).toBe("a");
    expect(inTopK(ranked, "c", 3)).toBe(true);
    expect(inTopK(ranked, "d", 3)).toBe(false);
    expect(top1([])).toBeNull();
  });
});
