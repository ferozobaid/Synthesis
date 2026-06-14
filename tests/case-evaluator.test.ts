import { describe, it, expect } from "vitest";
import {
  CASE_DIMENSIONS,
  emphasisFor,
  evaluateResponse,
  heuristicEvaluation,
  isStrong,
  scoreDimensions,
} from "@/lib/fsm/case-evaluator";
import beautify from "@/context/cases/beautify.json";
import diconsa from "@/context/cases/diconsa.json";
import type { CaseRecord } from "@/lib/types";

const c = beautify as unknown as CaseRecord;
const dc = diconsa as unknown as CaseRecord;

const STRONG_FRAMEWORK =
  "I'd structure this around five factors. First, the retailer response — how partners like Sephora react to direct beautify.com sales. Second, the competitor response and whether rivals already offer virtual assistants. Third, our consultants' current capabilities and whether we retrain or hire. Fourth, the brand-image risk of hundreds of advisors posting. Fifth, the underlying economics of retraining cost versus incremental revenue. My hypothesis is the economics will dominate, so I'd want to size them first.";
const MEDIUM_FRAMEWORK =
  "I'd look at three areas: the retailer response, our competitors, and the internal economics of retraining.";
const WEAK_FRAMEWORK = "Um, maybe we look at costs.";

describe("case evaluator (mock heuristic)", () => {
  it("produces varied, ordered scores across different inputs (not constant)", async () => {
    const strong = await evaluateResponse(c, "framework", STRONG_FRAMEWORK);
    const medium = await evaluateResponse(c, "framework", MEDIUM_FRAMEWORK);
    const weak = await evaluateResponse(c, "framework", WEAK_FRAMEWORK);

    expect(new Set([strong.overall, medium.overall, weak.overall]).size).toBeGreaterThanOrEqual(2);
    expect(strong.overall).toBeGreaterThan(medium.overall);
    expect(medium.overall).toBeGreaterThanOrEqual(weak.overall);
    expect(strong.overall).toBeGreaterThan(weak.overall);
  });

  it("is deterministic — identical input yields identical scores", () => {
    expect(scoreDimensions(STRONG_FRAMEWORK)).toEqual(scoreDimensions(STRONG_FRAMEWORK));
    expect(heuristicEvaluation(c, "framework", STRONG_FRAMEWORK)).toEqual(
      heuristicEvaluation(c, "framework", STRONG_FRAMEWORK),
    );
  });

  it("returns the shared Evaluation shape: module=case, 5 dims, all 1..5", async () => {
    const ev = await evaluateResponse(c, "framework", STRONG_FRAMEWORK);
    expect(ev.module).toBe("case");
    expect(ev.dimension_scores).toHaveLength(CASE_DIMENSIONS.length);
    for (const d of ev.dimension_scores) {
      expect(d.score).toBeGreaterThanOrEqual(1);
      expect(d.score).toBeLessThanOrEqual(5);
    }
    expect(typeof ev.overall).toBe("number");
  });

  it("judges a strong, structured, numeric answer as strong and a vague one as weak", async () => {
    const strong = await evaluateResponse(c, "framework", STRONG_FRAMEWORK);
    const weak = await evaluateResponse(c, "framework", WEAK_FRAMEWORK);
    expect(isStrong(strong, "framework", c)).toBe(true);
    expect(isStrong(weak, "framework", c)).toBe(false);
  });

  it("scores quantitative answers high on the quant dimension", () => {
    const quantAnswer =
      "Incremental revenue is €130M, minus €10M costs is €120M, minus €2.5M depreciation is €117.5M, so €150M ÷ €117.5M ≈ 1.28 years.";
    expect(scoreDimensions(quantAnswer).quant).toBeGreaterThanOrEqual(4);
    expect(scoreDimensions(WEAK_FRAMEWORK).quant).toBeLessThanOrEqual(2);
  });

  it("forces the quant dimension at each case's own quant stage", () => {
    // Beautify computes payback at data_reveal; Diconsa computes savings at analysis.
    expect(emphasisFor(c, "data_reveal")).toContain("quant");
    expect(emphasisFor(dc, "analysis")).toContain("quant");
  });
});
