import { describe, it, expect } from "vitest";
import {
  CASE_DIMENSIONS,
  emphasisFor,
  evaluateResponse,
  heuristicEvaluation,
  isStrong,
  scoreDimensions,
} from "@/lib/fsm/case-evaluator";
import {
  assessCaseFramework,
  frameworkProbeObjectiveAnswered,
} from "@/lib/fsm/case-framework";
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
const COMPLETE_FRAMEWORK =
  "I would organize the analysis into external attractiveness and internal feasibility. Externally, I would assess customer demand, digital adoption, competitor activity, and retailer channel dynamics. Internally, I would assess brand fit, customer experience, technology and data capability, consultant training, and the operating model. I would then test financial viability through upfront investment, recurring costs, productivity, incremental sales, margins, payback, and downside risk.";

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

  it("accepts complete Framework coverage even without an explicit hypothesis", () => {
    const evaluation = heuristicEvaluation(c, "framework", COMPLETE_FRAMEWORK);
    const lowHypothesis = {
      ...evaluation,
      dimension_scores: evaluation.dimension_scores.map((dimension) =>
        dimension.dimension === "structure"
          ? { ...dimension, score: 4 }
          : dimension.dimension === "hypothesis"
            ? { ...dimension, score: 1 }
            : dimension),
    };

    expect(isStrong(lowHypothesis, "framework", c)).toBe(false);
    expect(isStrong(lowHypothesis, "framework", c, COMPLETE_FRAMEWORK)).toBe(true);
  });

  it.each([
    COMPLETE_FRAMEWORK,
    "My three areas are financial returns and break-even, Beautify's people, systems and brand readiness, and then shoppers, rivals and sales channels.",
  ])("semantically accepts organized Framework synonyms: %s", (answer) => {
    const assessment = assessCaseFramework(c, answer);

    expect(assessment.accepted).toBe(true);
    expect(assessment.missingGroups).toEqual([]);
  });

  it("advances a strong but imperfectly MECE Framework with refinement feedback", () => {
    const assessment = assessCaseFramework(
      c,
      "I would use three partly overlapping areas: market demand and retailers, our brand and operating capabilities, and investment costs versus sales, margins and payback.",
    );

    expect(assessment.accepted).toBe(true);
    expect(assessment.refinementNeeded).toBe(true);
  });

  it("does not accept an organized list containing only one keyword per group", () => {
    const assessment = assessCaseFramework(
      c,
      "Three branches: demand; technology; costs.",
    );

    expect(assessment.organized).toBe(true);
    expect(assessment.substantive).toBe(false);
    expect(assessment.accepted).toBe(false);
    expect(assessment.nextProbeObjective?.id).toBe("framework:depth");
  });

  it("keeps an incomplete Framework weak and identifies the next objective", () => {
    const assessment = assessCaseFramework(
      c,
      "I would structure two areas around customer demand and competitor activity, then investment cost and payback.",
    );

    expect(assessment.accepted).toBe(false);
    expect(assessment.nextProbeObjective?.id).toBe("framework:group:internal");
  });

  it("recognizes an answered organization probe without requiring new concepts", () => {
    const assessment = assessCaseFramework(c, COMPLETE_FRAMEWORK);
    const objective = {
      id: "framework:organization",
      stage: "framework" as const,
      prompt: "Separate the external and internal branches.",
      acknowledgement: "you already separated the external and internal branches",
      requiredGroupId: null,
      coveredConcepts: assessment.coveredConcepts,
    };

    expect(frameworkProbeObjectiveAnswered(objective, assessment)).toBe(true);
  });

  it("uses Diconsa's authored concept configuration without Beautify wording", () => {
    const answer =
      "I would structure three branches: benefits to rural recipients through access, travel time and security; benefits to government, the bank and Diconsa through lower administrative cost and store traffic; and operational feasibility including capacity, fraud and decentralized control risk.";
    const assessment = assessCaseFramework(dc, answer);

    expect(assessment.accepted).toBe(true);
    expect(assessment.coveredGroups).toEqual([
      "benefits to the rural population",
      "benefits to government, the bank, and Diconsa",
      "operational feasibility and risk",
    ]);
  });

  it("keeps an incomplete Diconsa Framework weak with an authored targeted probe", () => {
    const assessment = assessCaseFramework(
      dc,
      "I would structure two branches: rural-recipient access and travel time; operational feasibility, capacity and fraud risk.",
    );

    expect(assessment.accepted).toBe(false);
    expect(assessment.nextProbeObjective?.id).toBe("framework:group:institutions");
    expect(assessment.nextProbeObjective?.prompt).toContain("government, the bank, or Diconsa");
  });

  it("does not apply the semantic override without a case configuration", () => {
    const unknownCase = { ...c, id: "unknown-case" };
    const evaluation = heuristicEvaluation(c, "framework", COMPLETE_FRAMEWORK);
    const belowLegacyThreshold = {
      ...evaluation,
      dimension_scores: evaluation.dimension_scores.map((dimension) =>
        dimension.dimension === "structure"
          ? { ...dimension, score: 4 }
          : dimension.dimension === "hypothesis"
            ? { ...dimension, score: 1 }
            : dimension),
    };

    expect(assessCaseFramework(unknownCase, COMPLETE_FRAMEWORK)).toMatchObject({
      configured: false,
      accepted: false,
    });
    expect(isStrong(
      belowLegacyThreshold,
      "framework",
      unknownCase,
      COMPLETE_FRAMEWORK,
    )).toBe(false);
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
