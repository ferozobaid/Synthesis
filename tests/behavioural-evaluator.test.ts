import { describe, it, expect } from "vitest";
import {
  coerceScore,
  evaluateBehavioural,
  heuristicEvaluation,
  scoreDimensions,
} from "@/lib/behavioural/evaluator";
import { mockAnswerBank } from "@/lib/__mocks__/fixtures";
import type { AnswerBankEntry } from "@/lib/types";

const bank = mockAnswerBank();
const prepared: AnswerBankEntry =
  bank.find((b) => b.id.startsWith("tell_me_about_a_time_you_led")) ?? bank[0];

const STRONG =
  "During my final-year consulting project, our team's churn model was unstable two weeks before the deadline. As team lead, I was responsible for getting us back on track. I organized a 45-minute reset, reassigned work by strength, and I rebuilt the model with a simpler logistic regression baseline using Python. As a result, we delivered on time and identified three churn drivers explaining 62% of at-risk accounts, and the client adopted our onboarding redesign.";
const MEDIUM =
  "I led a team project that was going badly. I reorganized how we worked and we fixed the model. In the end it went fine and we delivered the project.";
const WEAK = "We had some issues but it worked out okay I think.";

describe("behavioural evaluator (mock heuristic)", () => {
  it("produces varied, ordered scores across different inputs (not constant)", async () => {
    const strong = await evaluateBehavioural("q", STRONG, prepared);
    const medium = await evaluateBehavioural("q", MEDIUM, prepared);
    const weak = await evaluateBehavioural("q", WEAK, prepared);

    expect(new Set([strong.overall, medium.overall, weak.overall]).size).toBeGreaterThanOrEqual(2);
    expect(strong.overall).toBeGreaterThan(weak.overall);
    expect(strong.overall).toBeGreaterThanOrEqual(medium.overall);
    expect(medium.overall).toBeGreaterThanOrEqual(weak.overall);
  });

  it("is deterministic — identical input yields identical output", () => {
    expect(heuristicEvaluation("q", STRONG, prepared)).toEqual(heuristicEvaluation("q", STRONG, prepared));
    expect(scoreDimensions(STRONG, prepared)).toEqual(scoreDimensions(STRONG, prepared));
  });

  it("returns the BehaviouralScore shape: scores 1..5, overall 1..5", async () => {
    const ev = await evaluateBehavioural("q", STRONG, prepared);
    expect(ev.dimension_scores.length).toBeGreaterThanOrEqual(4);
    for (const d of ev.dimension_scores) {
      expect(d.score).toBeGreaterThanOrEqual(1);
      expect(d.score).toBeLessThanOrEqual(5);
      expect(typeof d.justification).toBe("string");
    }
    expect(ev.overall).toBeGreaterThanOrEqual(1);
    expect(ev.overall).toBeLessThanOrEqual(5);
  });

  it("scores specificity higher for a numeric, named answer than a vague one", () => {
    const s = scoreDimensions(STRONG, prepared).specificity as number;
    const w = scoreDimensions(WEAK, prepared).specificity as number;
    expect(s).toBeGreaterThan(w);
  });

  it("marks key-point coverage 'not applicable' when no prepared answer was retrieved", async () => {
    expect(scoreDimensions(STRONG, null).key_point_coverage).toBeNull();

    const ev = await evaluateBehavioural("q", STRONG, null);
    const dims = ev.dimension_scores.map((d) => d.dimension);
    expect(dims).not.toContain("Key-point coverage");
    expect(ev.improvements.join(" ")).toMatch(/wasn't scored|no close match/i);
  });

  it("includes key-point coverage when a prepared answer is present", () => {
    const dims = heuristicEvaluation("q", STRONG, prepared).dimension_scores.map((d) => d.dimension);
    expect(dims).toContain("Key-point coverage");
  });

  it("names a missing STAR element in feedback for an incomplete answer", () => {
    const ev = heuristicEvaluation("q", WEAK, prepared);
    expect(ev.improvements.length).toBeGreaterThan(0);
    expect(ev.improvements.join(" ").toLowerCase()).toMatch(/situation|task|action|result/);
  });

  it("rewards a quantified result over a qualitative one on the impact dimension", () => {
    const quantified =
      "I was responsible for the rollout. I built the dashboard, and as a result we cut reporting time by 30% across 12 teams.";
    const qualitative =
      "I was responsible for the rollout. I built the dashboard, and as a result the team was happier and things improved.";
    expect((scoreDimensions(quantified, prepared).impact as number)).toBeGreaterThan(
      scoreDimensions(qualitative, prepared).impact as number,
    );
  });

  it("does not credit a quantified result when the numbers are only in the setup", () => {
    // Numbers appear only in the situation; the outcome is qualitative.
    const setupNumbersOnly =
      "Two weeks before our 4-person team's deadline things were going badly. I was responsible for the fix. I reorganised the work, and in the end it worked out fine.";
    expect(scoreDimensions(setupNumbersOnly, prepared).impact as number).toBeLessThanOrEqual(3);
  });

  it("scores STAR structure higher for a complete answer than an incomplete one", () => {
    const complete =
      "During my internship the data pipeline kept failing before each release. I was responsible for its stability. I rebuilt the retry logic and added monitoring, and as a result failures dropped sharply.";
    const incomplete = "We fixed the pipeline and it got better.";
    expect((scoreDimensions(complete, prepared).star_structure as number)).toBeGreaterThan(
      scoreDimensions(incomplete, prepared).star_structure as number,
    );
  });
});

describe("behavioural evaluator (real-mode coercion — F2: key-point coverage N/A)", () => {
  // A simulated raw Haiku response that (incorrectly) includes Key-point coverage even when
  // no prepared answer was retrieved. Scores chosen so the all-5 mean (2.6) differs from the
  // remaining-4 mean (2.0), proving `overall` is recomputed rather than taken from the model.
  const rawWithCoverage = () => ({
    dimension_scores: [
      { dimension: "STAR structure", score: 2, justification: "thin" },
      { dimension: "Specificity / evidence", score: 2, justification: "generic" },
      { dimension: "Ownership", score: 2, justification: "mixed" },
      { dimension: "Impact / result", score: 2, justification: "no outcome" },
      { dimension: "Key-point coverage", score: 5, justification: "n/a" },
    ],
    overall: 2.6, // the model's coverage-inclusive overall
    covered_key_points: [],
    missed_key_points: [],
    strengths: [],
    improvements: ["Add a concrete number."],
  });

  it("drops Key-point coverage from a coerced score when no prepared answer matched", () => {
    const ev = coerceScore(rawWithCoverage(), "why this role?", "an answer", null);
    const dims = ev.dimension_scores.map((d) => d.dimension);
    expect(dims).not.toContain("Key-point coverage");
    expect(dims.some((d) => d.toLowerCase().replace(/[^a-z]/g, "").includes("keypoint"))).toBe(false);
    expect(ev.dimension_scores).toHaveLength(4);
  });

  it("recomputes overall from the remaining dimensions, ignoring the model's coverage-inclusive overall", () => {
    const ev = coerceScore(rawWithCoverage(), "q", "an answer", null);
    expect(ev.overall).toBe(2); // mean of remaining [2,2,2,2]
    expect(ev.overall).not.toBe(2.6); // not the model's all-5 overall
  });

  it("keeps the 'not scored' coverage note when no prepared answer matched", () => {
    const ev = coerceScore(rawWithCoverage(), "q", "an answer", null);
    expect(ev.improvements.join(" ")).toMatch(/wasn't scored|no close match/i);
  });

  it("is robust to alternate coverage labels (e.g. key_point_coverage)", () => {
    const raw = rawWithCoverage();
    raw.dimension_scores[4].dimension = "key_point_coverage";
    const ev = coerceScore(raw, "q", "an answer", null);
    expect(ev.dimension_scores.some((d) => d.dimension.toLowerCase().includes("key"))).toBe(false);
    expect(ev.dimension_scores).toHaveLength(4);
  });

  it("keeps Key-point coverage (and trusts the model's overall) when a prepared answer is present", () => {
    const ev = coerceScore(rawWithCoverage(), "q", "an answer", prepared);
    const dims = ev.dimension_scores.map((d) => d.dimension);
    expect(dims).toContain("Key-point coverage");
    expect(ev.dimension_scores).toHaveLength(5);
    expect(ev.overall).toBe(2.6);
  });
});
