import { describe, expect, it, vi } from "vitest";
import {
  appendNativeCaseVoiceTranscript,
  caseVoiceCallStartContract,
  nativeCaseReportPollingReady,
  nativeCaseVoiceTranscriptLine,
  shouldPreserveNativeCaseReportAfterStartFailure,
  startCaseVoiceSdkCall,
  type CaseBootstrap,
  type NativeCaseBootstrap,
} from "@/components/CaseVoiceInterview";
import {
  fetchNativeCaseReport,
  fullAuthoritativeCaseScore,
  nativeCaseReportPresentation,
  nativeCaseReportStatusMessage,
  readPendingNativeCaseReport,
  writePendingNativeCaseReport,
  type NativeCaseReportProjection,
  type PendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";

const nativeBootstrap: NativeCaseBootstrap = {
  architecture: "vapi_native",
  sessionId: "native-session-1",
  assistantId: "server-owned-airport-assistant",
  reportToken: "browser-only-report-token",
  reportStatus: "pending",
  caseId: "airport_profitability",
  caseTitle: "Airport Profitability",
};

const pending: PendingNativeCaseReport = {
  sessionId: nativeBootstrap.sessionId,
  assistantId: nativeBootstrap.assistantId,
  reportToken: nativeBootstrap.reportToken,
  caseId: nativeBootstrap.caseId,
  caseTitle: nativeBootstrap.caseTitle,
  createdAt: 100,
};

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
        variableValues: {
          sessionId: "native-session-1",
          caseId: "airport_profitability",
        },
      },
    });
    expect(JSON.stringify(contract)).not.toContain(nativeBootstrap.reportToken);
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

  it("keeps the custom-LLM Vapi contract isolated and unchanged", () => {
    const custom: CaseBootstrap = {
      architecture: "custom_llm",
      sessionId: "custom-session-1",
      projectionToken: "projection-token-never-forwarded",
      openingPrompt: "Authored opening",
      caseId: "airport_profitability",
      caseTitle: "Airport Profitability",
    };

    expect(caseVoiceCallStartContract(custom, "custom-assistant")).toEqual({
      assistantId: "custom-assistant",
      overrides: {
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
    expect(nativeCaseReportStatusMessage(null)).toContain("Waiting");
    expect(nativeCaseReportStatusMessage(report({ status: "pending" }))).toContain("Waiting");
    expect(nativeCaseReportStatusMessage(report({ status: "processing" }))).toContain("processed");
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
    expect(fullAuthoritativeCaseScore(full)).not.toBeNull();
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
    expect(fullAuthoritativeCaseScore(partial)).toBeNull();
  });
});
