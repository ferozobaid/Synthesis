import { describe, expect, it, vi } from "vitest";
import {
  appendNativeCaseVoiceTranscript,
  caseVoiceCallStartContract,
  nativeCaseReportPollingReady,
  nativeCaseVoiceTranscriptLine,
  shouldPreserveNativeCaseReportAfterStartFailure,
  startCaseVoiceSdkCall,
  VAPI_CASE_DURATION_SAFETY_BUFFER_SECONDS,
  vapiMaxDurationSeconds,
  type CaseBootstrap,
  type NativeCaseBootstrap,
} from "@/components/CaseVoiceInterview";
import {
  fetchNativeCaseReport,
  completedCaseOutcome,
  nativeCaseReportPresentation,
  nativeCaseReportStatusMessage,
  nativeCaseReportSupportingMessage,
  readPendingNativeCaseReport,
  writePendingNativeCaseReport,
  type NativeCaseReportProjection,
  type PendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";
import {
  NATIVE_CASE_LIVE_STAGE_LABELS,
  advanceNativeCaseLiveProgress,
  endNativeCaseLiveProgress,
  initialNativeCaseLiveProgress,
  nativeCaseLiveElapsedMilliseconds,
} from "@/lib/voice/case-native-live";
import { CASE_VOICE_STAGE_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { caseStageAnchorManifest } from "@/lib/voice/case-transcript";

const nativeBootstrap: NativeCaseBootstrap = {
  architecture: "vapi_native",
  sessionId: "native-session-1",
  assistantId: "server-owned-airport-assistant",
  reportToken: "browser-only-report-token",
  reportStatus: "pending",
  caseId: "airport_profitability",
  caseTitle: "Airport Profitability",
  maxDurationSeconds: 900,
};

const pending: PendingNativeCaseReport = {
  sessionId: nativeBootstrap.sessionId,
  assistantId: nativeBootstrap.assistantId,
  reportToken: nativeBootstrap.reportToken,
  caseId: nativeBootstrap.caseId,
  caseTitle: nativeBootstrap.caseTitle,
  createdAt: 100,
};
const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function report(
  overrides: Partial<NativeCaseReportProjection> = {},
): NativeCaseReportProjection {
  return {
    status: "pending",
    caseId: "airport_profitability",
    caseTitle: "Airport Profitability",
    partial: null,
    observedStages: [],
    missingStages: [],
    score: null,
    outcomeId: "outcome-fixture",
    failureCode: null,
    ...overrides,
  };
}

describe("native Case Voice client start contract", () => {
  it("uses the server-returned assistant and passes only sessionId and caseId", () => {
    const contract = caseVoiceCallStartContract(nativeBootstrap, "deprecated-custom-assistant");

    expect(contract).toEqual({
      assistantId: "server-owned-airport-assistant",
      overrides: {
        // Vapi's outer safety limit is the 900s Synthesis deadline plus the
        // buffer — never the bare server-authoritative duration.
        maxDurationSeconds: 1080,
        variableValues: {
          sessionId: "native-session-1",
          caseId: "airport_profitability",
        },
      },
    });
    expect(JSON.stringify(contract)).not.toContain(nativeBootstrap.reportToken);
  });

  it("buffers the outer Vapi limit by exactly the safety constant for both a 900s and a 1200s case", () => {
    expect(VAPI_CASE_DURATION_SAFETY_BUFFER_SECONDS).toBe(180);
    expect(vapiMaxDurationSeconds(900)).toBe(1080);
    expect(vapiMaxDurationSeconds(1200)).toBe(1380);

    const fifteenMinuteCase: NativeCaseBootstrap = { ...nativeBootstrap, maxDurationSeconds: 900 };
    const twentyMinuteCase: NativeCaseBootstrap = {
      ...nativeBootstrap,
      caseId: "data_engineer_clickstream",
      maxDurationSeconds: 1200,
    };
    expect(
      caseVoiceCallStartContract(fifteenMinuteCase, "deprecated-custom-assistant").overrides
        .maxDurationSeconds,
    ).toBe(1080);
    expect(
      caseVoiceCallStartContract(twentyMinuteCase, "deprecated-custom-assistant").overrides
        .maxDurationSeconds,
    ).toBe(1380);
  });

  it("starts the Web SDK exactly once with the server-returned native contract", async () => {
    const start = vi.fn(async () => ({ id: "call-1" }));
    const contract = caseVoiceCallStartContract(nativeBootstrap, "deprecated-custom-assistant");

    await startCaseVoiceSdkCall({ start }, contract);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(contract.assistantId, contract.overrides);
    expect(JSON.stringify(start.mock.calls)).not.toContain(nativeBootstrap.reportToken);
  });

  it("preserves the native report capability when the Web SDK start rejects", async () => {
    const target = memoryStorage();
    const readinessCompletion = vi.fn();
    const customLlmStart = vi.fn();
    let inMemoryRecoveryCapability: PendingNativeCaseReport | null = pending;
    let capabilityWasPersistedBeforeStart = false;
    writePendingNativeCaseReport(pending, target);

    const start = vi.fn(async () => {
      capabilityWasPersistedBeforeStart =
        readPendingNativeCaseReport(101, target)?.reportToken === pending.reportToken;
      throw new Error("Native Vapi startup failed.");
    });
    const contract = caseVoiceCallStartContract(nativeBootstrap, "deprecated-custom-assistant");

    await expect(startCaseVoiceSdkCall({ start }, contract)).rejects.toThrow(
      "Native Vapi startup failed.",
    );
    if (!shouldPreserveNativeCaseReportAfterStartFailure(inMemoryRecoveryCapability)) {
      inMemoryRecoveryCapability = null;
      target.clear();
    }

    expect(capabilityWasPersistedBeforeStart).toBe(true);
    expect(readPendingNativeCaseReport(101, target)).toEqual(pending);
    expect(inMemoryRecoveryCapability).toEqual(pending);
    expect(readinessCompletion).not.toHaveBeenCalled();
    expect(customLlmStart).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(contract.assistantId, contract.overrides);
    expect(JSON.stringify(start.mock.calls)).not.toContain(nativeBootstrap.reportToken);
  });

  it("keeps the custom-LLM Vapi contract isolated and applies the buffered duration", () => {
    const custom: CaseBootstrap = {
      architecture: "custom_llm",
      sessionId: "custom-session-1",
      projectionToken: "projection-token-never-forwarded",
      openingPrompt: "Authored opening",
      caseId: "airport_profitability",
      caseTitle: "Airport Profitability",
      maxDurationSeconds: 900,
    };

    expect(caseVoiceCallStartContract(custom, "custom-assistant")).toEqual({
      assistantId: "custom-assistant",
      overrides: {
        // 900s server deadline + the 180s outer safety buffer, not the bare 900.
        maxDurationSeconds: 1080,
        variableValues: {
          sessionId: "custom-session-1",
          openingPrompt: "Authored opening",
          caseTitle: "Airport Profitability",
        },
        metadata: {
          sessionId: "custom-session-1",
          caseId: "airport_profitability",
        },
      },
    });

    const twentyMinuteCustom: CaseBootstrap = { ...custom, maxDurationSeconds: 1200 };
    expect(
      caseVoiceCallStartContract(twentyMinuteCustom, "custom-assistant").overrides
        .maxDurationSeconds,
    ).toBe(1380);
  });

  it("retains the report capability across call end and enables polling only afterward", () => {
    const target = memoryStorage();
    writePendingNativeCaseReport(pending, target);

    expect(nativeCaseReportPollingReady(null, true)).toBe(false);
    const afterEnd = pending;
    expect(nativeCaseReportPollingReady(afterEnd, false)).toBe(true);
    expect(readPendingNativeCaseReport(101, target)).toEqual(pending);
  });

  it("polls the protected report endpoint with the retained capability after end", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(report({ status: "processing" })), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const afterEnd = pending;
    expect(nativeCaseReportPollingReady(afterEnd, false)).toBe(true);

    await fetchNativeCaseReport(afterEnd!, fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/api/case/report/native-session-1", {
      headers: { "x-report-token": "browser-only-report-token" },
    });
  });

  it("retains final assistant and candidate transcript turns without partial duplicates", () => {
    const assistant = nativeCaseVoiceTranscriptLine({
      type: "transcript",
      transcriptType: "final",
      role: "assistant",
      transcript: "Are you ready?",
    }, 1)!;
    const candidate = nativeCaseVoiceTranscriptLine({
      type: 'transcript[transcriptType="final"]',
      role: "user",
      transcript: "Yes, I am ready.",
    }, 2)!;

    const transcript = appendNativeCaseVoiceTranscript(
      appendNativeCaseVoiceTranscript([], assistant),
      candidate,
    );
    expect(transcript.map((line) => line.text)).toEqual([
      "Are you ready?",
      "Yes, I am ready.",
    ]);
    expect(nativeCaseVoiceTranscriptLine({
      type: "transcript",
      transcriptType: "partial",
      role: "user",
      transcript: "Yes, I am",
    }, 3)).toBeNull();
    expect(appendNativeCaseVoiceTranscript(transcript, { ...candidate, sequence: 3 })).toBe(transcript);
  });
});

describe("native Case report status presentation", () => {
  it("distinguishes pending, processing, full, partial, and failed reports", () => {
    expect(nativeCaseReportStatusMessage(null)).toBe("Generating your personalized case report…");
    expect(nativeCaseReportStatusMessage(report({ status: "pending" })))
      .toBe("Generating your personalized case report…");
    expect(nativeCaseReportStatusMessage(report({ status: "processing" })))
      .toBe("Generating your personalized case report…");
    expect(nativeCaseReportSupportingMessage(null)).toBe("This usually takes a few moments.");
    expect(nativeCaseReportSupportingMessage(report({ status: "processing" })))
      .toBe("This usually takes a few moments.");
    expect(nativeCaseReportSupportingMessage(report({ status: "done" }))).toBeNull();
    expect(nativeCaseReportStatusMessage(report({ status: "done", partial: false }))).toContain("authoritative");
    expect(nativeCaseReportStatusMessage(report({ status: "done", partial: true }))).toContain("partial");
    expect(nativeCaseReportStatusMessage(report({ status: "failed" }))).toContain("could not be produced");
  });

  it("presents all five dimensions and qualitative feedback for a full report", () => {
    const score = {
      overall: 4.2,
      dimension_scores: [
        "structure",
        "hypothesis_driven_thinking",
        "quantitative_reasoning",
        "synthesis",
        "communication",
      ].map((dimension) => ({
        dimension,
        score: 4,
        justification: `${dimension} feedback`,
        evidence: null,
      })),
      summary: "A concise qualitative summary.",
      strengths: ["Clear commercial structure."],
      improvements: ["State the hypothesis earlier."],
      next_focus: ["Practice top-down synthesis."],
      stage_feedback: [],
      improved_framework_outline: ["Define the decision before structuring the drivers."],
      improved_recommendation_outline: ["Lead with the decision and close with next steps."],
      quantitative_assessment: "The calculations were clearly narrated and interpreted.",
    } as NativeCaseReportProjection["score"];
    const full = report({
      status: "done",
      partial: false,
      observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
      score,
    });
    const presentation = nativeCaseReportPresentation(full)!;

    expect(presentation.label).toBe("Case Report");
    expect(presentation.dimensions).toHaveLength(5);
    expect(presentation.summary).toContain("qualitative summary");
    expect(presentation.frameworkFeedback).toHaveLength(1);
    expect(presentation.quantitativeFeedback).toContain("calculations");
    expect(presentation.recommendationFeedback).toHaveLength(1);
    expect(presentation.nextPracticePriorities).toHaveLength(1);
    expect(presentation.readinessUpdated).toBe(true);
    expect(completedCaseOutcome(full)).not.toBeNull();
  });

  it("presents only observed feedback and missing stages for a partial report", () => {
    const partial = report({
      status: "done",
      partial: true,
      observedStages: ["clarification", "framework"],
      missingStages: ["analysis", "data_reveal", "pressure_test", "recommendation"],
      score: {
        overall: null,
        dimension_scores: [
          { dimension: "structure", score: 3, justification: "Observed structure.", evidence: null },
          { dimension: "synthesis", score: null, justification: "Unobserved synthesis.", evidence: null },
        ],
        summary: "This report reflects only observed stages.",
        strengths: ["The initial structure was assessable."],
        improvements: ["Complete the remaining case stages."],
        next_focus: ["Practice full case completion."],
        stage_feedback: [
          { stage: "framework", kind: "strength", text: "The initial structure was assessable." },
          { stage: "framework", kind: "improvement", text: "Make the observed structure more explicit." },
        ],
        improved_framework_outline: ["Clarify the decision and structure the drivers."],
        improved_recommendation_outline: null,
        quantitative_assessment: null,
      },
    });
    const presentation = nativeCaseReportPresentation(partial)!;

    expect(presentation.label).toBe("Partial Report");
    expect(presentation.overall).toBeNull();
    expect(presentation.dimensions.map((dimension) => dimension.dimension)).toEqual(["structure"]);
    expect(presentation.missingStages).toContain("Recommendation");
    expect(presentation.strengths).toContain("The initial structure was assessable.");
    expect(presentation.frameworkFeedback).not.toBeNull();
    expect(presentation.recommendationFeedback).toBeNull();
    expect(presentation.quantitativeFeedback).toBeNull();
    expect(presentation.readinessUpdated).toBe(false);
    // No overall score at all: nothing to record.
    expect(completedCaseOutcome(partial)).toBeNull();
  });

  it("defaults a legacy report payload without evaluatorType to the consulting section labels", () => {
    // Simulates a report record persisted before evaluatorType existed on the
    // wire, or an evaluatorType-less mock in an older client bundle. The field
    // is optional on NativeCaseReportProjection; the API never removed it.
    const legacyFull = report({
      status: "done",
      partial: false,
      observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
      score: {
        overall: 4,
        dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"]
          .map((dimension) => ({ dimension, score: 4, justification: "Observed.", evidence: null })),
        summary: "Legacy consulting summary.",
        strengths: ["Legacy strength."],
        improvements: ["Legacy improvement."],
        next_focus: ["Legacy focus."],
        stage_feedback: [],
        improved_framework_outline: ["Legacy framework coaching."],
        improved_recommendation_outline: ["Legacy recommendation coaching."],
        quantitative_assessment: "Legacy quantitative coaching.",
      },
      // evaluatorType intentionally omitted.
    });
    expect("evaluatorType" in legacyFull).toBe(false);

    const presentation = nativeCaseReportPresentation(legacyFull)!;

    expect(presentation).not.toBeNull();
    expect(presentation.frameworkFeedbackLabel).toBe("Framework feedback");
    expect(presentation.recommendationFeedbackLabel).toBe("Recommendation feedback");
    expect(presentation.quantitativeFeedbackLabel).toBe("Quantitative reasoning feedback");
    expect(presentation.dimensions).toHaveLength(5);
    expect(completedCaseOutcome(legacyFull)).not.toBeNull();
  });

  it("falls back to consulting labels for an unrecognized evaluatorType instead of crashing", () => {
    const garbage = report({
      status: "done",
      partial: false,
      evaluatorType: "some_future_evaluator_this_build_does_not_know_about",
      observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
      score: {
        overall: 3,
        dimension_scores: [],
        summary: "n/a",
        strengths: [],
        improvements: [],
        next_focus: [],
        stage_feedback: [],
        improved_framework_outline: null,
        improved_recommendation_outline: null,
        quantitative_assessment: null,
      },
    });

    expect(() => nativeCaseReportPresentation(garbage)).not.toThrow();
    const presentation = nativeCaseReportPresentation(garbage)!;
    expect(presentation.frameworkFeedbackLabel).toBe("Framework feedback");
    expect(presentation.recommendationFeedbackLabel).toBe("Recommendation feedback");
    expect(presentation.quantitativeFeedbackLabel).toBe("Quantitative reasoning feedback");
  });

  it("selects the technical section labels only for evaluatorType: technical_system_design", () => {
    const technical = report({
      status: "done",
      partial: false,
      caseId: "data_engineer_clickstream",
      caseTitle: "Clickstream Data Pipeline",
      evaluatorType: "technical_system_design",
      observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
      score: {
        overall: 4,
        dimension_scores: [{ dimension: "pipeline_design", score: 4, justification: "Observed.", evidence: null }],
        summary: "Technical summary.",
        strengths: [],
        improvements: [],
        next_focus: [],
        stage_feedback: [],
        improved_framework_outline: ["Pipeline coaching."],
        improved_recommendation_outline: ["Operations coaching."],
        quantitative_assessment: "Scale coaching.",
      },
    });
    const presentation = nativeCaseReportPresentation(technical)!;
    expect(presentation.frameworkFeedbackLabel).toBe("Pipeline design feedback");
    expect(presentation.recommendationFeedbackLabel).toBe("Operations & trade-off feedback");
    expect(presentation.quantitativeFeedbackLabel).toBe("Scale & reliability feedback");
  });
});

describe("native Case live stage progress and timer", () => {
  it("keeps the timer inactive through readiness and starts at the canonical case opening", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    let progress = initialNativeCaseLiveProgress();
    progress = advanceNativeCaseLiveProgress(
      progress,
      AIRPORT,
      { role: "assistant", text: "Are you ready to begin?" },
      1_000,
    );
    progress = advanceNativeCaseLiveProgress(
      progress,
      AIRPORT,
      { role: "user", text: "I'm ready." },
      2_000,
    );
    expect(progress.startedAt).toBeNull();
    expect(nativeCaseLiveElapsedMilliseconds(progress, 9_000)).toBe(0);

    progress = advanceNativeCaseLiveProgress(
      progress,
      AIRPORT,
      { role: "assistant", text: manifest.openingAnchor },
      10_000,
    );
    expect(progress.startedAt).toBe(10_000);
    expect(nativeCaseLiveElapsedMilliseconds(progress, 10_000)).toBe(0);

    const clarificationOnly = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      AIRPORT,
      { role: "assistant", text: manifest.anchors.clarification },
      12_000,
    );
    expect(clarificationOnly.startedAt).toBe(12_000);
  });

  it("does not restart the timer and freezes it when the call ends", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const started = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      AIRPORT,
      { role: "assistant", text: manifest.openingAnchor },
      1_000,
    );
    const rerendered = advanceNativeCaseLiveProgress(
      started,
      AIRPORT,
      { role: "assistant", text: manifest.anchors.clarification },
      5_000,
    );
    expect(rerendered.startedAt).toBe(1_000);

    const ended = endNativeCaseLiveProgress(rerendered, 8_000);
    expect(nativeCaseLiveElapsedMilliseconds(ended, 20_000)).toBe(7_000);
    expect(endNativeCaseLiveProgress(ended, 30_000).endedAt).toBe(8_000);
  });

  it("advances only from finalized assistant anchors and never from candidate speech", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const candidate = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      AIRPORT,
      { role: "user", text: manifest.anchors.framework },
      1_000,
    );
    expect(candidate.stageIndex).toBe(-1);

    const partial = nativeCaseVoiceTranscriptLine({
      type: "transcript",
      transcriptType: "partial",
      role: "assistant",
      transcript: manifest.anchors.framework,
    }, 1);
    expect(partial).toBeNull();

    const finalized = nativeCaseVoiceTranscriptLine({
      type: "transcript",
      transcriptType: "final",
      role: "assistant",
      transcript: manifest.anchors.framework,
    }, 1)!;
    expect(advanceNativeCaseLiveProgress(candidate, AIRPORT, finalized, 2_000).stageIndex).toBe(1);
  });

  it("preserves monotonic stage order when an earlier assistant anchor is repeated", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const pressureTest = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      AIRPORT,
      { role: "assistant", text: manifest.anchors.pressure_test },
      1_000,
    );
    const repeatedFramework = advanceNativeCaseLiveProgress(
      pressureTest,
      AIRPORT,
      { role: "assistant", text: manifest.anchors.framework },
      2_000,
    );
    expect(pressureTest.stageIndex).toBe(4);
    expect(repeatedFramework.stageIndex).toBe(4);
  });

  it("maps Airport and Gym anchors to the shared six-stage display", () => {
    const airport = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const gym = caseStageAnchorManifest(GYM, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const airportAnalysis = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      AIRPORT,
      { role: "assistant", text: airport.anchors.analysis },
      1_000,
    );
    const gymSizing = advanceNativeCaseLiveProgress(
      initialNativeCaseLiveProgress(),
      GYM,
      { role: "assistant", text: gym.anchors.data_reveal },
      1_000,
    );

    expect(NATIVE_CASE_LIVE_STAGE_LABELS[airportAnalysis.stageIndex]).toBe("Analysis");
    expect(NATIVE_CASE_LIVE_STAGE_LABELS[gymSizing.stageIndex]).toBe("Market sizing");
    expect(NATIVE_CASE_LIVE_STAGE_LABELS).toEqual([
      "Clarification",
      "Framework",
      "Analysis",
      "Market sizing",
      "Pressure test",
      "Recommendation",
    ]);
  });
});
