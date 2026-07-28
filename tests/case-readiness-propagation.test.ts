import { describe, expect, it } from "vitest";
import {
  DEFAULT_READINESS_STATE,
  MAX_RECORDED_OUTCOME_IDS,
  caseReadinessStatusLine,
  hydrateCaseOutcomes,
  hydrateReadinessState,
  mergeCaseOutcome,
  type CaseOutcome,
  type CompletedCaseOutcome,
  type ReadinessState,
} from "@/components/readiness-store";
import { completedCaseOutcome } from "@/components/CaseNativeVoiceInterview";
import { caseOutcomeSummary } from "@/components/CaseVoiceInterview";
import type { NativeCaseReportProjection } from "@/components/CaseNativeVoiceInterview";

const STRATEGY = "airport_profitability";
const TECHNICAL = "data_analyst_technical_round";

function attempt(overrides: Partial<CompletedCaseOutcome> = {}): CompletedCaseOutcome {
  return {
    caseId: STRATEGY,
    caseTrack: "strategy",
    score: 80,
    partial: false,
    outcomeId: "outcome-1",
    completedAt: 1_000,
    ...overrides,
  };
}

/**
 * Mirrors the reducer in ReadinessProvider.recordCaseOutcome so the propagation
 * contract is testable without mounting React.
 */
function record(state: ReadinessState, incoming: CompletedCaseOutcome): ReadinessState {
  const merged = mergeCaseOutcome(state.caseOutcomes[incoming.caseId], incoming);
  if (!merged) return state;
  const next: ReadinessState = {
    ...state,
    caseOutcomes: { ...state.caseOutcomes, [incoming.caseId]: merged },
  };
  if (merged.caseTrack !== "strategy") return next;
  return {
    ...next,
    case: {
      ...next.case,
      status: "done",
      score: merged.latestScore,
      statusLine: caseReadinessStatusLine(merged),
      updatedAt: merged.lastCompletedAt,
    },
  };
}

function report(overrides: Partial<NativeCaseReportProjection> = {}): NativeCaseReportProjection {
  return {
    status: "done",
    outcomeId: "outcome-report",
    caseId: STRATEGY,
    caseTrack: "strategy",
    caseTitle: "Airport Profitability",
    partial: false,
    observedStages: [],
    missingStages: [],
    score: {
      overall: 4,
      dimension_scores: [
        { dimension: "structure", score: 4, justification: "Observed.", evidence: null },
        { dimension: "synthesis", score: null, justification: "Not observed.", evidence: null },
      ],
      summary: "Summary.",
      strengths: [],
      improvements: [],
      next_focus: [],
      stage_feedback: [],
      improved_framework_outline: [],
      improved_recommendation_outline: [],
      quantitative_assessment: null,
    } as unknown as NativeCaseReportProjection["score"],
    failureCode: null,
    ...overrides,
  };
}

describe("case outcome recording", () => {
  describe("strategy readiness propagation", () => {
    it("a complete strategy report updates Case readiness", () => {
      const state = record(DEFAULT_READINESS_STATE, attempt());
      expect(state.case.status).toBe("done");
      expect(state.case.score).toBe(80);
      expect(state.case.statusLine).toBe("1 case · full report");
      expect(state.caseOutcomes[STRATEGY].latestScore).toBe(80);
    });

    it("a scored PARTIAL strategy report also updates readiness, marked provisional", () => {
      const state = record(DEFAULT_READINESS_STATE, attempt({ score: 55, partial: true }));
      expect(state.case.status).toBe("done");
      expect(state.case.score).toBe(55);
      expect(state.case.statusLine).toContain("provisional");
      expect(state.caseOutcomes[STRATEGY].latestWasPartial).toBe(true);
    });

    it("the case itself carries the persisted score for its own card", () => {
      const state = record(DEFAULT_READINESS_STATE, attempt({ score: 72 }));
      const summary = caseOutcomeSummary(state.caseOutcomes[STRATEGY]);
      expect(summary).toContain("Latest 72/100");
      expect(summary).toContain("1 attempt");
    });

    it("marks a provisional latest on the case card too", () => {
      const state = record(DEFAULT_READINESS_STATE, attempt({ score: 40, partial: true }));
      expect(caseOutcomeSummary(state.caseOutcomes[STRATEGY])).toContain("(provisional)");
    });
  });

  describe("technical separation", () => {
    it("persists a technical outcome without touching Strategy readiness", () => {
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 90 }),
      );
      expect(state.caseOutcomes[TECHNICAL].latestScore).toBe(90);
      // Strategy/Case readiness untouched.
      expect(state.case).toEqual(DEFAULT_READINESS_STATE.case);
      expect(state.case.score).toBeNull();
    });

    it("keeps a prior strategy readiness score unchanged when a technical round finishes", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ score: 70 }));
      const strategyReadiness = state.case;
      state = record(
        state,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 95, outcomeId: "outcome-t" }),
      );
      expect(state.case).toEqual(strategyReadiness);
      expect(state.caseOutcomes[TECHNICAL].latestScore).toBe(95);
    });

    it("exposes technical results through the same per-case contract", () => {
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 88 }),
      );
      expect(caseOutcomeSummary(state.caseOutcomes[TECHNICAL])).toContain("Latest 88/100");
    });
  });

  describe("idempotency", () => {
    it("repeated polling of the same outcomeId changes nothing at all", () => {
      const first = record(DEFAULT_READINESS_STATE, attempt());
      let state = first;
      for (let i = 0; i < 5; i++) state = record(state, attempt());
      // Same object identity: no re-render, no rewritten readiness, no new timestamp.
      expect(state).toBe(first);
      expect(state.caseOutcomes[STRATEGY].attemptCount).toBe(1);
      expect(state.case.updatedAt).toBe(first.case.updatedAt);
    });

    it("a duplicate of an OLDER attempt is also a no-op", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a", score: 60 }));
      state = record(state, attempt({ outcomeId: "b", score: 70, completedAt: 2_000 }));
      const afterTwo = state;
      // A late poll of the first attempt must not look like a third attempt.
      state = record(state, attempt({ outcomeId: "a", score: 60 }));
      expect(state).toBe(afterTwo);
      expect(state.caseOutcomes[STRATEGY].attemptCount).toBe(2);
    });

    it("a genuinely new attempt increments attemptCount exactly once", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a" }));
      state = record(state, attempt({ outcomeId: "b", score: 65, completedAt: 2_000 }));
      expect(state.caseOutcomes[STRATEGY].attemptCount).toBe(2);
      // Latest always follows the newest unique attempt, even when it is lower.
      expect(state.caseOutcomes[STRATEGY].latestScore).toBe(65);
      expect(state.case.score).toBe(65);
      expect(state.case.updatedAt).toBe(2_000);
    });

    it("bounds the recorded id history", () => {
      let outcome: CaseOutcome | null = null;
      for (let i = 0; i < MAX_RECORDED_OUTCOME_IDS + 5; i++) {
        outcome = mergeCaseOutcome(outcome ?? undefined, attempt({ outcomeId: `o-${i}` }));
      }
      expect(outcome!.recordedOutcomeIds).toHaveLength(MAX_RECORDED_OUTCOME_IDS);
      expect(outcome!.attemptCount).toBe(MAX_RECORDED_OUTCOME_IDS + 5);
    });
  });

  describe("best-score policy", () => {
    it("keeps the highest complete score across complete attempts", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a", score: 80 }));
      state = record(state, attempt({ outcomeId: "b", score: 60 }));
      expect(state.caseOutcomes[STRATEGY].bestScore).toBe(80);
      expect(state.caseOutcomes[STRATEGY].bestWasPartial).toBe(false);
      expect(state.caseOutcomes[STRATEGY].latestScore).toBe(60);
    });

    it("uses a partial best only while no complete attempt exists", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a", score: 50, partial: true }));
      expect(state.caseOutcomes[STRATEGY].bestScore).toBe(50);
      expect(state.caseOutcomes[STRATEGY].bestWasPartial).toBe(true);

      state = record(state, attempt({ outcomeId: "b", score: 70, partial: true }));
      expect(state.caseOutcomes[STRATEGY].bestScore).toBe(70);
      expect(state.caseOutcomes[STRATEGY].bestWasPartial).toBe(true);
    });

    it("the first complete attempt becomes best even when it scores LOWER than a partial", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a", score: 90, partial: true }));
      state = record(state, attempt({ outcomeId: "b", score: 55, partial: false }));
      expect(state.caseOutcomes[STRATEGY].bestScore).toBe(55);
      expect(state.caseOutcomes[STRATEGY].bestWasPartial).toBe(false);
    });

    it("a higher partial never displaces an existing complete best", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ outcomeId: "a", score: 60, partial: false }));
      state = record(state, attempt({ outcomeId: "b", score: 99, partial: true }));
      expect(state.caseOutcomes[STRATEGY].bestScore).toBe(60);
      expect(state.caseOutcomes[STRATEGY].bestWasPartial).toBe(false);
      // ...but latest still follows the newest attempt.
      expect(state.caseOutcomes[STRATEGY].latestScore).toBe(99);
      expect(state.caseOutcomes[STRATEGY].latestWasPartial).toBe(true);
    });
  });

  describe("report → outcome mapping (native and custom-LLM)", () => {
    it("accepts a complete report", () => {
      const outcome = completedCaseOutcome(report());
      expect(outcome).not.toBeNull();
      expect(outcome!.partial).toBe(false);
      expect(outcome!.caseTrack).toBe("strategy");
      expect(outcome!.outcomeId).toBe("outcome-report");
      // Unscored dimensions are dropped, never coerced to a number.
      expect(outcome!.score.dimension_scores).toHaveLength(1);
    });

    it("accepts a scored partial report", () => {
      const outcome = completedCaseOutcome(report({ partial: true }));
      expect(outcome).not.toBeNull();
      expect(outcome!.partial).toBe(true);
    });

    it("routes a technical report to the technical track", () => {
      const outcome = completedCaseOutcome(
        report({ caseId: TECHNICAL, caseTrack: "technical" }),
      );
      expect(outcome!.caseTrack).toBe("technical");
    });

    it("records nothing without a score, a status, or a stable identity", () => {
      expect(completedCaseOutcome(report({ status: "failed" }))).toBeNull();
      expect(completedCaseOutcome(report({ status: "processing" }))).toBeNull();
      expect(completedCaseOutcome(report({ score: null }))).toBeNull();
      expect(completedCaseOutcome(report({ outcomeId: null }))).toBeNull();
      expect(
        completedCaseOutcome(
          report({ score: { ...report().score!, overall: null } }),
        ),
      ).toBeNull();
    });
  });

  describe("legacy hydration", () => {
    it("hydrates a blob with no caseOutcomes without clearing existing scores", () => {
      const legacy = {
        target: { role: "Data Analyst", company: "Tenazx Inc", jdText: "JD", resumeText: "CV" },
        targetSource: "personalized",
        fit: { status: "done", score: 74, statusLine: "3 matched · 2 gaps" },
        behavioural: { status: "done", score: 68, statusLine: "13 answers scored" },
        case: { status: "done", score: 55, statusLine: "1 voice case · full report" },
      };
      const state = hydrateReadinessState(legacy);
      expect(state.caseOutcomes).toEqual({});
      // Existing module results survive untouched.
      expect(state.fit.score).toBe(74);
      expect(state.behavioural.score).toBe(68);
      expect(state.case.score).toBe(55);
      expect(state.target.role).toBe("Data Analyst");
    });

    it("round-trips a stored outcome map", () => {
      const state = record(DEFAULT_READINESS_STATE, attempt());
      const rehydrated = hydrateReadinessState(JSON.parse(JSON.stringify(state)));
      expect(rehydrated.caseOutcomes[STRATEGY]).toEqual(state.caseOutcomes[STRATEGY]);
      // A rehydrated duplicate is still a no-op.
      expect(mergeCaseOutcome(rehydrated.caseOutcomes[STRATEGY], attempt())).toBeNull();
    });

    it("drops malformed entries instead of poisoning the map", () => {
      expect(hydrateCaseOutcomes(undefined)).toEqual({});
      expect(hydrateCaseOutcomes("nope")).toEqual({});
      expect(
        hydrateCaseOutcomes({
          good: {
            caseId: "good", caseTrack: "strategy", latestScore: 50, bestScore: 50,
            attemptCount: 1, lastCompletedAt: 1, latestWasPartial: false,
            bestWasPartial: false, latestOutcomeId: "x", recordedOutcomeIds: ["x"],
          },
          missingTrack: { caseId: "missingTrack", latestOutcomeId: "y", attemptCount: 1 },
          badTrack: { caseId: "badTrack", caseTrack: "nope", latestOutcomeId: "z", attemptCount: 1 },
        }),
      ).toEqual({
        good: {
          caseId: "good", caseTrack: "strategy", latestScore: 50, bestScore: 50,
          attemptCount: 1, lastCompletedAt: 1, latestWasPartial: false,
          bestWasPartial: false, latestOutcomeId: "x", recordedOutcomeIds: ["x"],
        },
      });
    });

    it("backfills recordedOutcomeIds for an entry written before that field existed", () => {
      const hydrated = hydrateCaseOutcomes({
        c: {
          caseId: "c", caseTrack: "strategy", latestScore: 50, bestScore: 50,
          attemptCount: 1, lastCompletedAt: 1, latestWasPartial: false,
          bestWasPartial: false, latestOutcomeId: "only-id",
        },
      });
      expect(hydrated.c.recordedOutcomeIds).toEqual(["only-id"]);
      // ...so the known attempt is still deduplicated.
      expect(
        mergeCaseOutcome(hydrated.c, attempt({ caseId: "c", outcomeId: "only-id" })),
      ).toBeNull();
    });
  });

  describe("other modules are untouched", () => {
    it("leaves Fit and Behavioural readiness alone", () => {
      const seeded: ReadinessState = {
        ...DEFAULT_READINESS_STATE,
        fit: { status: "done", score: 74, statusLine: "3 matched · 2 gaps", updatedAt: 5 },
        behavioural: { status: "done", score: 68, statusLine: "5 answers scored", updatedAt: 6 },
      };
      const state = record(seeded, attempt());
      expect(state.fit).toEqual(seeded.fit);
      expect(state.behavioural).toEqual(seeded.behavioural);
    });
  });
});
