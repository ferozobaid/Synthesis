import { describe, it, expect } from "vitest";
import { aggregateScore } from "@/lib/fsm/case-scoring";
import beautify from "@/context/cases/beautify.json";
import type { CaseRecord, CaseSessionState, CaseTurn } from "@/lib/types";

const c = beautify as unknown as CaseRecord;

const STRONG_INTRO =
  "We're being asked one core question: would retraining most of Beautify's in-store consultants into virtual social-media advisors be profitable? Two things drive it — first, shoppers are moving online and consultants sit idle; second, the retraining investment must pay back within a reasonable horizon while protecting the brand and retail relationships.";
const STRONG_FRAMEWORK =
  "I'd structure this around five factors. First, the retailer response. Second, the competitor response. Third, our consultants' current capabilities. Fourth, the brand-image risk. Fifth, the underlying economics of retraining cost versus incremental revenue. My hypothesis is the economics will dominate, so I'd size them first.";
const STRONG_QUANT =
  "Payback is the upfront investment over annual profit. Incremental revenue is €130M, minus €10M costs is €120M, minus €2.5M depreciation is €117.5M. So €150M ÷ €117.5M ≈ 1.28 years. The exhibit shows virtual try-on lifts conversion most and cuts returns.";
const STRONG_REC =
  "My recommendation is to proceed with a phased rollout. The payback is about 1.28 years, and the exhibit shows virtual try-on drives the most conversion while cutting returns. So I'd prioritize that capability, pilot in two markets, and share economics with retail partners.";

function buildSession(overrides: Partial<CaseSessionState> = {}): CaseSessionState {
  const history: CaseTurn[] = [
    { role: "candidate", stage: "intro", text: STRONG_INTRO },
    { role: "candidate", stage: "framework", text: STRONG_FRAMEWORK },
    { role: "candidate", stage: "data_reveal", text: STRONG_QUANT },
    { role: "candidate", stage: "recommendation", text: STRONG_REC },
  ];
  return {
    id: "s",
    user_id: "u",
    case_id: "beautify",
    fsm_state: "scoring",
    history,
    stage_attempts: {},
    hints_used: {},
    exhibits_revealed: [],
    complete: true,
    ...overrides,
  };
}

describe("case scoring aggregation", () => {
  it("produces all 5 rubric dimensions with an overall in range", () => {
    const sc = aggregateScore(c, buildSession());
    expect(sc.dimension_scores).toHaveLength(5);
    expect(sc.dimension_scores.map((d) => d.dimension).sort()).toEqual([
      "communication",
      "hypothesis",
      "quant",
      "structure",
      "synthesis",
    ]);
    expect(sc.overall).toBeGreaterThanOrEqual(1);
    expect(sc.overall).toBeLessThanOrEqual(5);
  });

  it("caps the quant dimension when the level-3 hint was needed at the quant stage", () => {
    const capped = aggregateScore(c, buildSession({ hints_used: { data_reveal: 3 } }));
    const quant = capped.dimension_scores.find((d) => d.dimension === "quant")!;
    expect(quant.score).toBeLessThanOrEqual(3);
    // feedback references the specific stage that needed help
    expect(capped.improvements.join(" ")).toContain("data_reveal");
  });

  it("uncapped quant scores strictly higher than capped quant", () => {
    const base = aggregateScore(c, buildSession());
    const capped = aggregateScore(c, buildSession({ hints_used: { data_reveal: 3 } }));
    const q1 = base.dimension_scores.find((d) => d.dimension === "quant")!.score;
    const q2 = capped.dimension_scores.find((d) => d.dimension === "quant")!.score;
    expect(q1).toBeGreaterThan(q2);
  });

  it("rewards a final recommendation anchored on the numbers and the exhibit", () => {
    const sc = aggregateScore(c, buildSession());
    expect(sc.strengths.join(" ").toLowerCase()).toContain("recommendation");
  });

  it("stays well-formed even on a thin session", () => {
    const thin = aggregateScore(c, buildSession({ history: [{ role: "candidate", stage: "intro", text: "Not sure." }] }));
    expect(thin.dimension_scores).toHaveLength(5);
    expect(thin.overall).toBeGreaterThanOrEqual(1);
    expect(thin.overall).toBeLessThanOrEqual(5);
  });
});
