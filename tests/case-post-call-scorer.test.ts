import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, complete: completeMock };
});

import {
  parseCasePostCallModelScores,
  scoreCasePostCall,
} from "@/lib/voice/case-post-call-scorer";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  mapCaseTranscript,
} from "@/lib/voice/case-transcript";
import { CASE_VOICE_STAGE_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { normalizeVoiceTranscript } from "@/lib/voice/transcript";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";

const AIRPORT = "airport_profitability";
const EXPECTED_DIMENSIONS = [
  "structure",
  "hypothesis_driven_thinking",
  "quantitative_reasoning",
  "synthesis",
  "communication",
] as const;

function mappedFullTranscript() {
  const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript(CASE_REPORT_STAGES.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    {
      role: "user",
      message: `For ${stage}, I would structure the evidence, test a hypothesis, quantify the result, and synthesize an answer.`,
    },
  ]));
  return mapCaseTranscript(
    AIRPORT,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: normalized.truncated },
  )!;
}

function mappedPartialTranscript() {
  const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript([
    { role: "assistant", message: manifest.anchors.framework },
    { role: "user", message: "I would structure the decision around commercial value, feasibility, and execution risk." },
  ]);
  return mapCaseTranscript(
    AIRPORT,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: false },
  )!;
}

function mappedStages(stages: Array<(typeof CASE_REPORT_STAGES)[number]>) {
  const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript(stages.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    { role: "user", message: `I would address the observed ${stage} question with clear business reasoning.` },
  ]));
  return mapCaseTranscript(
    AIRPORT,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: false },
  )!;
}

function qualitativeProposal(
  rows: Array<{ dimension: string; score: number | null }> = validRows(),
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    dimensionScores: rows.map((row) => ({
      ...row,
      rationale: "The observed response demonstrated a clear and decision-focused approach.",
    })),
    overallSummary: "The candidate worked through the case coherently and maintained a clear decision focus.",
    strengths: ["The response connected commercial reasoning with practical execution considerations."],
    improvements: ["Make the leading hypothesis more explicit before beginning detailed analysis."],
    stageFeedback: [
      { stage: "framework", kind: "strength", text: "The observed framework was logically organized." },
      { stage: "analysis", kind: "improvement", text: "The observed analysis could state the hypothesis earlier." },
    ],
    improvedFrameworkOutline: [
      "Define the decision and success criteria.",
      "Separate commercial attractiveness, operational feasibility, and execution risk.",
    ],
    improvedRecommendationOutline: [
      "Lead with the decision and supporting rationale.",
      "Close with risks, mitigation, and a concrete next step.",
    ],
    quantitativeAssessment: "The quantitative reasoning was clear and connected to the business implication.",
    ...overrides,
  });
}

function validRows(score = 4) {
  return EXPECTED_DIMENSIONS.map((dimension) => ({ dimension, score }));
}

async function deterministicReport() {
  process.env.SYNTHESIS_USE_MOCKS = "true";
  const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mappedFullTranscript());
  expect(result.ok).toBe(true);
  return result;
}

async function expectDeterministicFallback(modelOutput: string) {
  const expected = await deterministicReport();
  process.env.SYNTHESIS_USE_MOCKS = "false";
  completeMock.mockResolvedValueOnce(modelOutput);
  const actual = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mappedFullTranscript());
  expect(completeMock).toHaveBeenCalledTimes(1);
  expect(actual.ok).toBe(true);
  expect(expected.ok).toBe(true);
  if (!actual.ok || !expected.ok) return;
  expect(actual.report).toEqual(expected.report);
  expect(actual.scorerOutcome).toBe("deterministic_fallback");
  if (actual.ok) {
    expect(actual.report.partial).toBe(false);
    expect(actual.report.score.overall).not.toBeNull();
  }
}

beforeEach(() => {
  completeMock.mockReset();
});

afterEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("Case post-call exact model dimension contract", () => {
  it("accepts exactly the five unique required dimensions", () => {
    expect(parseCasePostCallModelScores({ dimensionScores: validRows() })).toEqual({
      structure: 4,
      hypothesis_driven_thinking: 4,
      quantitative_reasoning: 4,
      synthesis: 4,
      communication: 4,
    });
  });

  it("rejects a missing dimension and uses the deterministic fallback", async () => {
    await expectDeterministicFallback(qualitativeProposal(validRows().slice(0, 4)));
  });

  it("rejects duplicate dimensions and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[2] = { dimension: "hypothesis_driven_thinking", score: 5 } as any;
    await expectDeterministicFallback(qualitativeProposal(rows));
  });

  it("rejects unknown dimensions and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[2] = { dimension: "commercial_magic", score: 5 } as any;
    await expectDeterministicFallback(qualitativeProposal(rows));
  });

  it("rejects invalid scores and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[0] = { dimension: "structure", score: 6 };
    await expectDeterministicFallback(qualitativeProposal(rows));
  });

  it("uses exactly one Haiku call and preserves the qualitative proposal", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal());

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0][1]).toMatchObject({
      model: "claude-haiku-4-5",
      temperature: 0,
      maxRetries: 0,
      outputSchema: expect.objectContaining({ type: "object" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.report.partial).toBe(false);
    expect(result.report.score.dimension_scores).toHaveLength(5);
    expect(result.report.score.dimension_scores[0].justification).toBe(
      "The observed response demonstrated a clear and decision-focused approach.",
    );
    expect(result.report.score.summary).toContain("worked through the case");
    expect(result.report.score.improved_framework_outline).toHaveLength(2);
    expect(result.report.score.improved_recommendation_outline).toHaveLength(2);
    expect(result.report.score.quantitative_assessment).toContain("business implication");
  });

  it("uses the deterministic candidate-safe fallback when Haiku fails", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockRejectedValueOnce(new Error("provider failure with private content"));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("model_error");
    expect(result.report.score.summary).toContain("complete case sequence");
  });

  it("scores only sufficiently observed dimensions in a partial qualitative report", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const rows = EXPECTED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: dimension === "structure" || dimension === "communication" ? 3 : null,
    }));
    completeMock.mockResolvedValueOnce(qualitativeProposal(rows));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedPartialTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.partial).toBe(true);
    expect(result.report.score.overall).toBeNull();
    expect(result.report.score.dimension_scores.filter((item) => item.score !== null)
      .map((item) => item.dimension)).toEqual(["structure", "communication"]);
  });

  it("discards model-authored partial rationales and never describes a missing Recommendation", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const rows = EXPECTED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: dimension === "structure" || dimension === "communication" ? 3 : null,
      rationale: "MODEL-AUTHORED rationale praising the missing Recommendation.",
    }));
    completeMock.mockResolvedValueOnce(qualitativeProposal(validRows(), {
      dimensionScores: rows,
    }));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    const rationales = result.report.score.dimension_scores.map((item) => item.justification);
    expect(rationales).not.toContain("MODEL-AUTHORED rationale praising the missing Recommendation.");
    expect(rationales.every((rationale) => !/recommendation/i.test(rationale))).toBe(true);
    expect(result.report.score.dimension_scores.find(
      (item) => item.dimension === "structure",
    )?.justification).toBe(
      "This dimension was assessed from the observed Framework response.",
    );
  });

  it("lists only answered stages in a multi-stage partial dimension rationale", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal());

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework", "analysis"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const communication = result.report.score.dimension_scores.find(
      (item) => item.dimension === "communication",
    );
    expect(communication?.justification).toBe(
      "This dimension was assessed from the observed Framework and Analysis responses.",
    );
    expect(communication?.justification).not.toMatch(/Data reveal|Pressure test|Recommendation/);
  });

  it("limits a partial quantitative rationale to an answered Data reveal calculation", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal());

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["data_reveal"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quantitative = result.report.score.dimension_scores.find(
      (item) => item.dimension === "quantitative_reasoning",
    );
    expect(quantitative?.score).not.toBeNull();
    expect(quantitative?.justification).toBe(
      "This dimension was assessed from the observed Data reveal calculation.",
    );
    expect(quantitative?.justification).not.toContain("Pressure test");
  });

  it("leaves a partial dimension unscored when none of its stages were answered", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal());

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["analysis"]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const structure = result.report.score.dimension_scores.find(
      (item) => item.dimension === "structure",
    );
    expect(structure?.score).toBeNull();
    expect(structure?.justification).toBe(
      "Structure could not be scored from the observed interview stages.",
    );
  });

  it("rejects qualitative output that reproduces candidate transcript text", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const copied = "For framework, I would structure the evidence, test a hypothesis, quantify the result, and synthesize an answer.";
    completeMock.mockResolvedValueOnce(qualitativeProposal(validRows(), {
      overallSummary: copied,
    }));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(JSON.stringify(result.report)).not.toContain(copied);
  });

  it("excludes Recommendation coaching when Recommendation was not answered", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal(validRows(), {
      stageFeedback: [
        { stage: "framework", kind: "strength", text: "The observed framework was logically organized." },
        { stage: "recommendation", kind: "improvement", text: "Missing-stage recommendation criticism." },
      ],
      improvedRecommendationOutline: ["Missing-stage recommendation coaching."],
    }));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.score.improved_recommendation_outline).toBeNull();
    expect(JSON.stringify(result.report.score)).not.toContain("Missing-stage recommendation");
  });

  it("excludes Framework coaching when Framework was not answered", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal(validRows(), {
      improvedFrameworkOutline: ["Missing-stage framework coaching."],
      stageFeedback: [
        { stage: "analysis", kind: "strength", text: "The observed analysis considered practical tradeoffs." },
      ],
    }));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["analysis"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.score.improved_framework_outline).toBeNull();
    expect(JSON.stringify(result.report.score)).not.toContain("Missing-stage framework");
  });

  it("excludes quantitative feedback when neither quantitative stage was answered", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal());
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework", "analysis"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.score.quantitative_assessment).toBeNull();
  });

  it("discards missing-stage model feedback while retaining observed-stage feedback", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(qualitativeProposal(validRows(), {
      stageFeedback: [
        { stage: "framework", kind: "strength", text: "Observed framework feedback retained." },
        { stage: "recommendation", kind: "improvement", text: "Missing recommendation feedback discarded." },
      ],
    }));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.score.strengths).toEqual(["Observed framework feedback retained."]);
    expect(result.report.score.improvements).toEqual([]);
    expect(JSON.stringify(result.report.score)).not.toContain("Missing recommendation feedback");
  });

  it("keeps deterministic partial fallback feedback within answered stages", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockRejectedValueOnce(new Error("model unavailable"));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["analysis"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.report.score.stage_feedback.every((item) => item.stage === "analysis")).toBe(true);
    expect(result.report.score.improved_framework_outline).toBeNull();
    expect(result.report.score.improved_recommendation_outline).toBeNull();
    expect(result.report.score.quantitative_assessment).toBeNull();
  });
});
