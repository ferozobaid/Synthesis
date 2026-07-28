import { describe, expect, it } from "vitest";
import {
  DEFAULT_READINESS_STATE,
  MAX_RECORDED_OUTCOME_IDS,
  applyCaseOutcome,
  caseReadinessStatusLine,
  hydrateCaseOutcomes,
  hydrateInterviewSource,
  hydrateReadinessState,
  interviewSourceKind,
  interviewSourceLabel,
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
 * The real reducer ReadinessProvider.recordCaseOutcome delegates to — exercised
 * directly rather than mirrored, so the test cannot drift from the implementation.
 */
const record = applyCaseOutcome;

/** The unchanged overallReadiness formula, so both tracks can be proven to reach it. */
function overall(state: ReadinessState): number | null {
  const parts = [state.fit, state.behavioural, state.case].filter((m) => m.score != null);
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((acc, m) => acc + (m.score ?? 0), 0) / parts.length);
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
      expect(state.case.statusLine).toBe("Strategy case · full report");
      expect(state.interviewSource).toEqual({
        kind: "strategy", caseId: STRATEGY, provisional: false, completedAt: 1_000,
      });
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

  describe("technical interviews count toward Interview Readiness", () => {
    it("a technical outcome updates Interview Readiness", () => {
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 90 }),
      );
      expect(state.caseOutcomes[TECHNICAL].latestScore).toBe(90);
      expect(state.case.status).toBe("done");
      expect(state.case.score).toBe(90);
    });

    it("both tracks reach Overall Readiness through state.case", () => {
      const seeded: ReadinessState = {
        ...DEFAULT_READINESS_STATE,
        fit: { status: "done", score: 60, updatedAt: 1 },
        behavioural: { status: "done", score: 60, updatedAt: 1 },
      };
      expect(overall(seeded)).toBe(60);

      // Strategy lifts the average...
      const afterStrategy = record(seeded, attempt({ score: 90 }));
      expect(overall(afterStrategy)).toBe(70);

      // ...and so does a technical round, through the same module.
      const afterTechnical = record(
        seeded,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 90, outcomeId: "t-1" }),
      );
      expect(overall(afterTechnical)).toBe(70);
    });

    it("the latest unique interview replaces the previous track, either direction", () => {
      // Strategy first, then technical takes over.
      let state = record(DEFAULT_READINESS_STATE, attempt({ score: 70, completedAt: 1_000 }));
      expect(state.case.score).toBe(70);
      expect(state.interviewSource?.kind).toBe("strategy");

      state = record(
        state,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical",
          score: 40, outcomeId: "t-1", completedAt: 2_000,
        }),
      );
      // Latest wins — not the highest, and not an average of 70 and 40.
      expect(state.case.score).toBe(40);
      expect(state.interviewSource?.kind).toBe("data_analyst_technical");

      // Technical first, then strategy takes over.
      state = record(
        state,
        attempt({ score: 55, outcomeId: "s-2", completedAt: 3_000 }),
      );
      expect(state.case.score).toBe(55);
      expect(state.interviewSource?.kind).toBe("strategy");
    });

    it("records provenance for every recognised interview kind", () => {
      const kinds: [string, string][] = [
        ["airport_profitability", "strategy"],
        ["data_analyst_technical_round", "data_analyst_technical"],
        ["data_engineer_technical_round", "data_engineer_technical"],
        ["data_engineer_clickstream", "clickstream_system_design"],
      ];
      kinds.forEach(([caseId, expected], index) => {
        const track = caseId.startsWith("data_") ? "technical" : "strategy";
        const state = record(
          DEFAULT_READINESS_STATE,
          attempt({ caseId, caseTrack: track as "strategy" | "technical", outcomeId: `k-${index}` }),
        );
        expect(state.interviewSource, caseId).toEqual({
          kind: expected, caseId, provisional: false, completedAt: 1_000,
        });
        expect(state.case.statusLine, caseId).toContain(
          interviewSourceLabel(expected as never),
        );
      });
    });

    it("falls back to a generic technical kind for an unrecognised technical case", () => {
      expect(interviewSourceKind("some_future_round", "technical")).toBe("technical");
      expect(interviewSourceKind("some_future_case", "strategy")).toBe("strategy");
    });

    it("marks a provisional technical result as provisional", () => {
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ caseId: TECHNICAL, caseTrack: "technical", score: 45, partial: true }),
      );
      expect(state.case.statusLine).toContain("provisional");
      expect(state.interviewSource?.provisional).toBe(true);
    });

    it("an out-of-order older interview records history but does not displace readiness", () => {
      let state = record(DEFAULT_READINESS_STATE, attempt({ score: 80, completedAt: 5_000 }));
      state = record(
        state,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical",
          score: 20, outcomeId: "t-old", completedAt: 1_000,
        }),
      );
      // History is kept...
      expect(state.caseOutcomes[TECHNICAL].latestScore).toBe(20);
      // ...but the more recent interview still owns readiness.
      expect(state.case.score).toBe(80);
      expect(state.interviewSource?.kind).toBe("strategy");
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

  describe("authoritative completion ordering", () => {
    /** Server ISO instants: the Strategy case genuinely finished FIRST. */
    const STRATEGY_DONE = "2026-07-27T10:00:00.000Z";
    const TECHNICAL_DONE = "2026-07-27T10:30:00.000Z";

    it("the native adapter carries the server completedAt into the outcome", () => {
      const outcome = completedCaseOutcome(report({ completedAt: STRATEGY_DONE }));
      expect(outcome?.completedAt).toBe(Date.parse(STRATEGY_DONE));
    });

    it("a native report with no completedAt yields null, never a wall-clock stand-in", () => {
      // Null — explicitly not "roughly now", which is what made a delayed old
      // report look newest before this fix.
      expect(completedCaseOutcome(report({ completedAt: null }))?.completedAt).toBeNull();
      expect(completedCaseOutcome(report({ completedAt: undefined }))?.completedAt).toBeNull();
      expect(completedCaseOutcome(report({ completedAt: "not-a-date" }))?.completedAt).toBeNull();
      // And the per-case history keeps it unknown rather than inventing a time.
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ outcomeId: "no-time", completedAt: null }),
      );
      expect(state.caseOutcomes[STRATEGY].lastCompletedAt).toBeNull();
    });

    it("an older native report recovered AFTER a newer technical result cannot displace it", () => {
      // The technical round finished at 10:30 and was recorded first.
      let state = record(
        DEFAULT_READINESS_STATE,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical", score: 88,
          outcomeId: "t-live", completedAt: Date.parse(TECHNICAL_DONE),
        }),
      );
      expect(state.case.score).toBe(88);

      // The strategy report finished at 10:00 but is only recovered from
      // localStorage now — arriving last, yet genuinely older.
      const recovered = completedCaseOutcome(
        report({ completedAt: STRATEGY_DONE, outcomeId: "s-recovered" }),
      )!;
      state = record(state, {
        caseId: recovered.caseId,
        caseTrack: recovered.caseTrack,
        score: 31,
        partial: recovered.partial,
        outcomeId: recovered.outcomeId,
        completedAt: recovered.completedAt,
      });

      // Its own history is recorded...
      expect(state.caseOutcomes[STRATEGY].latestScore).toBe(31);
      expect(state.caseOutcomes[STRATEGY].attemptCount).toBe(1);
      // ...but Interview Readiness still belongs to the newer technical round.
      expect(state.case.score).toBe(88);
      expect(state.interviewSource?.kind).toBe("data_analyst_technical");
      expect(state.interviewSource?.completedAt).toBe(Date.parse(TECHNICAL_DONE));
    });

    it("a late-arriving older custom-LLM result also cannot displace a newer one", () => {
      let state = record(
        DEFAULT_READINESS_STATE,
        attempt({ score: 75, outcomeId: "s-new", completedAt: Date.parse(TECHNICAL_DONE) }),
      );
      state = record(
        state,
        attempt({
          caseId: "gcc_premium_gym_market_entry", score: 20,
          outcomeId: "s-old", completedAt: Date.parse(STRATEGY_DONE),
        }),
      );
      expect(state.caseOutcomes["gcc_premium_gym_market_entry"].latestScore).toBe(20);
      expect(state.case.score).toBe(75);
    });

    it("a genuinely newer result does replace the incumbent, in both directions", () => {
      // Technical incumbent, newer Strategy wins.
      let state = record(
        DEFAULT_READINESS_STATE,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical", score: 90,
          outcomeId: "t-a", completedAt: Date.parse(STRATEGY_DONE),
        }),
      );
      state = record(
        state,
        attempt({ score: 44, outcomeId: "s-a", completedAt: Date.parse(TECHNICAL_DONE) }),
      );
      expect(state.case.score).toBe(44);
      expect(state.interviewSource?.kind).toBe("strategy");

      // Strategy incumbent, newer Technical wins.
      state = record(
        state,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical", score: 61,
          outcomeId: "t-b", completedAt: Date.parse(TECHNICAL_DONE) + 60_000,
        }),
      );
      expect(state.case.score).toBe(61);
      expect(state.interviewSource?.kind).toBe("data_analyst_technical");
    });

    it("a legacy outcome without completedAt may initialize readiness but never overwrite it", () => {
      // Nothing yet: a legacy result is better than no readiness at all.
      let state = record(
        DEFAULT_READINESS_STATE,
        attempt({ score: 50, outcomeId: "legacy-1", completedAt: null }),
      );
      expect(state.case.score).toBe(50);
      expect(state.interviewSource?.completedAt).toBeNull();

      // A timestamped result takes over from the unknown-time incumbent.
      state = record(
        state,
        attempt({
          caseId: TECHNICAL, caseTrack: "technical", score: 66,
          outcomeId: "t-known", completedAt: Date.parse(STRATEGY_DONE),
        }),
      );
      expect(state.case.score).toBe(66);

      // A second legacy result can no longer displace a known-time incumbent.
      state = record(
        state,
        attempt({
          caseId: "gcc_premium_gym_market_entry", score: 99,
          outcomeId: "legacy-2", completedAt: null,
        }),
      );
      expect(state.caseOutcomes["gcc_premium_gym_market_entry"].latestScore).toBe(99);
      expect(state.case.score).toBe(66);
      expect(state.interviewSource?.kind).toBe("data_analyst_technical");
    });

    it("duplicate outcomeIds stay no-ops regardless of completedAt", () => {
      const first = record(DEFAULT_READINESS_STATE, attempt({ completedAt: 5_000 }));
      // Same id replayed with a LATER timestamp must still change nothing.
      const again = record(first, attempt({ completedAt: 9_999 }));
      expect(again).toBe(first);
      expect(again.caseOutcomes[STRATEGY].attemptCount).toBe(1);
      expect(again.interviewSource?.completedAt).toBe(5_000);
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
      // A blob predating provenance simply has none; the score is never lost.
      expect(state.interviewSource).toBeNull();
      // Existing module results survive untouched.
      expect(state.fit.score).toBe(74);
      expect(state.behavioural.score).toBe(68);
      expect(state.case.score).toBe(55);
      expect(state.target.role).toBe("Data Analyst");
    });

    it("round-trips interview provenance and rejects malformed provenance", () => {
      const state = record(
        DEFAULT_READINESS_STATE,
        attempt({ caseId: TECHNICAL, caseTrack: "technical" }),
      );
      const rehydrated = hydrateReadinessState(JSON.parse(JSON.stringify(state)));
      expect(rehydrated.interviewSource).toEqual(state.interviewSource);

      expect(hydrateInterviewSource(undefined)).toBeNull();
      expect(hydrateInterviewSource({ kind: "nope", caseId: "x" })).toBeNull();
      expect(hydrateInterviewSource({ kind: "strategy" })).toBeNull();
      // Provenance written before completedAt propagation hydrates as unknown.
      expect(hydrateInterviewSource({ kind: "strategy", caseId: "x" })).toEqual({
        kind: "strategy", caseId: "x", provisional: false, completedAt: null,
      });
      expect(
        hydrateInterviewSource({ kind: "strategy", caseId: "x", completedAt: 42 }),
      ).toEqual({ kind: "strategy", caseId: "x", provisional: false, completedAt: 42 });
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
