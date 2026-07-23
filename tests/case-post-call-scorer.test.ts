import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
} from "@anthropic-ai/sdk";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, completeWithMetadata: completeMock };
});

import {
  CASE_POST_CALL_OUTPUT_SCHEMA,
  CASE_POST_CALL_VALIDATION_PATHS,
  CASE_POST_CALL_VALIDATION_REASONS,
  CASE_POST_CALL_VALIDATION_RECEIVED_TYPES,
  parseCasePostCallModelScores,
  scoreCasePostCall,
  validateCasePostCallModelProposal,
} from "@/lib/voice/case-post-call-scorer";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  mapCaseTranscript,
  type MappedCaseTranscript,
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
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function completion(
  text: string,
  overrides: Partial<{
    stopReason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "pause_turn" | "refusal" | null;
    inputTokens: number;
    outputTokens: number;
  }> = {},
) {
  return {
    text,
    stopReason: "end_turn" as const,
    inputTokens: 321,
    outputTokens: 654,
    ...overrides,
  };
}

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

function addAssistantNumericInput(
  mapped: MappedCaseTranscript,
  stage: (typeof CASE_REPORT_STAGES)[number],
  text: string,
) {
  const turn = mapped.turns.find((candidate) =>
    candidate.role === "assistant" && candidate.stage === stage,
  );
  if (!turn) throw new Error(`Missing ${stage} assistant turn.`);
  turn.text = `${turn.text} ${text}`;
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

function proposalObject(
  rows: Array<{ dimension: string; score: number | null }> = validRows(),
  overrides: Record<string, unknown> = {},
): Record<string, any> {
  return JSON.parse(qualitativeProposal(rows, overrides));
}

const PROSE_FIELDS = [
  "dimensionRationale",
  "overallSummary",
  "strengths",
  "improvements",
  "stageFeedback",
  "frameworkOutline",
  "recommendationOutline",
  "quantitativeAssessment",
] as const;

type ProseField = (typeof PROSE_FIELDS)[number];

function replaceProseField(
  proposal: Record<string, any>,
  field: ProseField,
  text: string,
): void {
  switch (field) {
    case "dimensionRationale":
      proposal.dimensionScores[0].rationale = text;
      return;
    case "overallSummary":
      proposal.overallSummary = text;
      return;
    case "strengths":
      proposal.strengths = [text];
      return;
    case "improvements":
      proposal.improvements = [text];
      return;
    case "stageFeedback":
      proposal.stageFeedback = [{ stage: "framework", kind: "strength", text }];
      return;
    case "frameworkOutline":
      proposal.improvedFrameworkOutline = [text];
      return;
    case "recommendationOutline":
      proposal.improvedRecommendationOutline = [text];
      return;
    case "quantitativeAssessment":
      proposal.quantitativeAssessment = text;
  }
}

function proseFieldValues(
  proposal: Record<string, any>,
  field: ProseField,
): string[] {
  switch (field) {
    case "dimensionRationale":
      return [proposal.dimensionScores[0].rationale];
    case "overallSummary":
      return [proposal.overallSummary];
    case "strengths":
      return proposal.strengths;
    case "improvements":
      return proposal.improvements;
    case "stageFeedback":
      return proposal.stageFeedback.map((item: Record<string, string>) => item.text);
    case "frameworkOutline":
      return proposal.improvedFrameworkOutline;
    case "recommendationOutline":
      return proposal.improvedRecommendationOutline;
    case "quantitativeAssessment":
      return [proposal.quantitativeAssessment];
  }
}

function expectValidationIssue(
  raw: unknown,
  mapped: MappedCaseTranscript,
  expectedPath: (typeof CASE_POST_CALL_VALIDATION_PATHS)[number],
  expectedReason: (typeof CASE_POST_CALL_VALIDATION_REASONS)[number],
  expectedType?: (typeof CASE_POST_CALL_VALIDATION_RECEIVED_TYPES)[number],
) {
  const result = validateCasePostCallModelProposal(
    raw,
    mapped,
    getVoiceLlmCaseRecord(AIRPORT)!,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected proposal validation to fail.");
  expect(CASE_POST_CALL_VALIDATION_PATHS).toContain(result.issue.path);
  expect(CASE_POST_CALL_VALIDATION_REASONS).toContain(result.issue.reason);
  expect(result.issue).toMatchObject({
    path: expectedPath,
    reason: expectedReason,
    ...(expectedType ? { receivedType: expectedType } : {}),
  });
  if (result.issue.receivedType !== undefined) {
    expect(CASE_POST_CALL_VALIDATION_RECEIVED_TYPES).toContain(
      result.issue.receivedType,
    );
  }
  expect(Object.keys(result.issue).sort()).toEqual(
    expectedType
      ? ["path", "reason", "receivedType"]
      : ["path", "reason"],
  );
  return result.issue;
}

function anthropicApiError(
  ErrorClass: typeof AuthenticationError | typeof NotFoundError | typeof BadRequestError,
  status: 400 | 401 | 404,
  type: "invalid_request_error" | "authentication_error" | "not_found_error",
) {
  return new ErrorClass(
    status as never,
    { error: { type, message: "PRIVATE provider-controlled error content" } },
    "PRIVATE provider-controlled error content",
    new Headers(),
    type,
  );
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
  completeMock.mockResolvedValueOnce(completion(modelOutput));
  const actual = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mappedFullTranscript());
  expect(completeMock).toHaveBeenCalledTimes(1);
  expect(actual.ok).toBe(true);
  expect(expected.ok).toBe(true);
  if (!actual.ok || !expected.ok) return;
  expect(actual.report).toEqual(expected.report);
  expect(actual.scorerOutcome).toBe("deterministic_fallback");
  expect(actual.failureCategory).toBe("schema_validation_error");
  if (actual.ok) {
    expect(actual.report.partial).toBe(false);
    expect(actual.report.score.overall).not.toBeNull();
  }
}

beforeEach(() => {
  completeMock.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

afterEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal()));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0][1]).toMatchObject({
      model: "claude-haiku-4-5",
      temperature: 0,
      timeoutMs: 60_000,
      maxRetries: 0,
      outputSchema: CASE_POST_CALL_OUTPUT_SCHEMA,
    });
    const schema = completeMock.mock.calls[0][1].outputSchema as any;
    expect(schema.properties.dimensionScores).toMatchObject({
      minItems: 5,
      maxItems: 5,
    });
    expect(schema.properties.dimensionScores.items.properties.rationale.maxLength)
      .toBe(360);
    expect(schema.properties.dimensionScores.items.properties.score).toMatchObject({
      type: ["integer", "null"],
      minimum: 1,
      maximum: 5,
    });
    expect(schema.properties.dimensionScores.items.properties.rationale.description)
      .toContain("Do not include numbers");
    expect(schema.properties.overallSummary.maxLength).toBe(480);
    expect(schema.properties.overallSummary.description)
      .toContain("no numbers");
    expect(schema.properties.quantitativeAssessment.maxLength).toBe(480);
    expect(schema.properties.quantitativeAssessment.description)
      .toContain("never include protected final answers");
    expect(schema.properties.strengths).toMatchObject({
      maxItems: 4,
      items: { maxLength: 320 },
    });
    expect(schema.properties.improvements).toMatchObject({
      maxItems: 4,
      items: { maxLength: 320 },
    });
    expect(schema.properties.stageFeedback).toMatchObject({
      maxItems: 12,
      items: {
        properties: {
          text: { maxLength: 320 },
        },
      },
    });
    expect(schema.properties.improvedFrameworkOutline).toMatchObject({
      maxItems: 4,
      items: { maxLength: 320 },
    });
    expect(schema.properties.improvedRecommendationOutline).toMatchObject({
      maxItems: 4,
      items: { maxLength: 320 },
    });
    const prompt = JSON.parse(completeMock.mock.calls[0][0]);
    expect(prompt.outputRules.allReports).toEqual(expect.arrayContaining([
      expect.stringContaining("exactly five dimension entries"),
      expect.stringContaining("Use null only in a partial report"),
      expect.stringContaining("rationale must be concise and no more than 360 characters"),
      expect.stringContaining("overallSummary must be no more than 480 characters"),
      expect.stringContaining("quantitativeAssessment must be no more than 480 characters"),
      expect.stringContaining("no more than 4 strengths"),
      expect.stringContaining("no more than 12 stageFeedback entries"),
      expect.stringContaining("no more than 320 characters"),
      expect.stringContaining("Dimension rationales must be entirely qualitative"),
      expect.stringContaining("only prose field that may discuss numbers"),
      expect.stringContaining("protected expected answers or hidden calculations"),
      expect.stringContaining("original candidate-specific coaching"),
    ]));
    expect(prompt.outputRules.partialReport).toEqual(expect.arrayContaining([
      expect.stringContaining("rationale may be an empty string"),
      expect.stringContaining("empty strengths and improvements arrays"),
      expect.stringContaining("empty framework outline array"),
      expect.stringContaining("empty recommendation outline array"),
      expect.stringContaining("neither Data reveal nor Pressure test"),
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.modelDiagnostic).toEqual({
      httpStatus: null,
      anthropicErrorType: null,
      stopReason: "end_turn",
      inputTokens: 321,
      outputTokens: 654,
      validationPath: null,
      validationReason: null,
      validationReceivedType: null,
    });
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

  it("keeps the safe Haiku report when one observed stage-feedback item overlaps", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const mapped = mappedFullTranscript();
    const copiedCandidateText = mapped.turns.find(
      (turn) => turn.role === "candidate" && turn.stage === "framework",
    )!.text;
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: copiedCandidateText,
      }],
    })));

    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
    expect(result.report.score.summary).toContain("worked through the case");
    expect(result.report.score.improved_framework_outline).toHaveLength(2);
    expect(result.report.score.stage_feedback).toContainEqual({
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    });
    expect(JSON.stringify(result.report)).not.toContain(copiedCandidateText);
    expect(JSON.stringify(result.modelDiagnostic)).not.toContain(copiedCandidateText);
  });

  it("recovers a protected-number stage-feedback item through the one-call model result", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const mapped = mappedFullTranscript();
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: "The framework nailed the protected SAR 4,240,000 daily revenue answer.",
      }],
    })));

    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
    expect(result.modelDiagnostic).toMatchObject({
      validationPath: null,
      validationReason: null,
      validationReceivedType: null,
    });
    // The overlapping item is replaced with deterministic stage feedback.
    expect(result.report.score.stage_feedback).toContainEqual({
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    });
    // Structured dimension scores survive the prose recovery untouched.
    expect(result.report.score.dimension_scores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows());
    // The protected value never reaches the report, diagnostics, or logs.
    expect(JSON.stringify(result.report)).not.toContain("4,240,000");
    expect(JSON.stringify(result.modelDiagnostic)).not.toContain("4,240,000");
  });

  it.each(PROSE_FIELDS)(
    "keeps the model-backed report when candidate overlap occurs in %s",
    async (field) => {
      process.env.SYNTHESIS_USE_MOCKS = "false";
      const mapped = mappedFullTranscript();
      const copiedCandidateText = mapped.turns.find(
        (turn) => turn.role === "candidate" && turn.stage === "framework",
      )!.text;
      const proposal = proposalObject();
      replaceProseField(proposal, field, copiedCandidateText);
      completeMock.mockResolvedValueOnce(completion(JSON.stringify(proposal)));

      const result = await scoreCasePostCall(
        getVoiceLlmCaseRecord(AIRPORT)!,
        mapped,
      );

      expect(completeMock).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.scorerOutcome).toBe("model");
      expect(result.failureCategory).toBeNull();
      expect(result.modelDiagnostic).toMatchObject({
        validationPath: null,
        validationReason: null,
        validationReceivedType: null,
      });
      expect(result.report.score.dimension_scores.map(({ dimension, score }) => ({
        dimension,
        score,
      }))).toEqual(validRows());
      expect(JSON.stringify(result.report)).not.toContain(copiedCandidateText);
      expect(JSON.stringify(result.modelDiagnostic)).not.toContain(copiedCandidateText);
      if (field !== "overallSummary") {
        expect(result.report.score.summary).toContain("worked through the case");
      }
      if (field !== "strengths") {
        expect(result.report.score.strengths).toContain(
          "The response connected commercial reasoning with practical execution considerations.",
        );
      }
      if (field !== "improvements") {
        expect(result.report.score.improvements).toContain(
          "Make the leading hypothesis more explicit before beginning detailed analysis.",
        );
      }
    },
  );

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
    expect(result.failureCategory).toBe("unknown_model_error");
    expect(result.report.score.summary).toContain("complete case sequence");
  });

  it("scores only sufficiently observed dimensions in a partial qualitative report", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const rows = EXPECTED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: dimension === "structure" || dimension === "communication" ? 3 : null,
    }));
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(rows)));

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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      dimensionScores: rows,
    })));

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

  it("applies the same field recovery policy to observed partial-report coaching", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const mapped = mappedStages(["framework"]);
    const copiedCandidateText = mapped.turns.find(
      (turn) => turn.role === "candidate",
    )!.text;
    const rows = EXPECTED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: dimension === "structure" || dimension === "communication" ? 4 : null,
      rationale: dimension === "structure" || dimension === "communication"
        ? "Safe model rationale that is discarded by the partial-report scope."
        : "",
    }));
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      dimensionScores: rows,
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: copiedCandidateText,
      }],
      improvedFrameworkOutline: [
        "Safe Haiku framework coaching remains available.",
        copiedCandidateText,
      ],
    })));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mapped,
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
    expect(result.report.partial).toBe(true);
    expect(result.report.score.dimension_scores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(rows.map(({ dimension, score }) => ({ dimension, score })));
    expect(result.report.score.stage_feedback).toEqual([{
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    }]);
    expect(result.report.score.improved_framework_outline).toEqual([
      "Safe Haiku framework coaching remains available.",
    ]);
    expect(JSON.stringify(result.report)).not.toContain(copiedCandidateText);
  });

  it("lists only answered stages in a multi-stage partial dimension rationale", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal()));

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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal()));

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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal()));

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

  it("replaces a copied summary without discarding the safe Haiku report", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const copied = "For framework, I would structure the evidence, test a hypothesis, quantify the result, and synthesize an answer.";
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      overallSummary: copied,
    })));
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
    expect(result.report.score.summary).toBe(
      "The interview covered the complete case sequence and provides enough evidence for an overall assessment.",
    );
    expect(result.report.score.dimension_scores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows());
    expect(result.report.score.strengths).toEqual([
      "The response connected commercial reasoning with practical execution considerations.",
    ]);
    expect(JSON.stringify(result.report)).not.toContain(copied);
  });

  it("excludes Recommendation coaching when Recommendation was not answered", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      stageFeedback: [
        { stage: "framework", kind: "strength", text: "The observed framework was logically organized." },
        { stage: "recommendation", kind: "improvement", text: "Missing-stage recommendation criticism." },
      ],
      improvedRecommendationOutline: ["Missing-stage recommendation coaching."],
    })));
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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      improvedFrameworkOutline: ["Missing-stage framework coaching."],
      stageFeedback: [
        { stage: "analysis", kind: "strength", text: "The observed analysis considered practical tradeoffs." },
      ],
    })));
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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal()));
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
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      stageFeedback: [
        { stage: "framework", kind: "strength", text: "Observed framework feedback retained." },
        { stage: "recommendation", kind: "improvement", text: "Missing recommendation feedback discarded." },
      ],
    })));
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

describe("Case post-call proposal validation diagnostics", () => {
  it("classifies representative structural failures with allowlisted metadata", () => {
    expectValidationIssue(
      null,
      mappedFullTranscript(),
      "root",
      "wrong_type",
      "null",
    );

    const missing = proposalObject();
    delete missing.overallSummary;
    expectValidationIssue(
      missing,
      mappedFullTranscript(),
      "overallSummary",
      "missing_required_field",
    );

    const unexpected = proposalObject();
    unexpected.privateModelField = "must not be retained";
    expectValidationIssue(
      unexpected,
      mappedFullTranscript(),
      "root",
      "unexpected_field",
    );

    expectValidationIssue(
      proposalObject(validRows(), { dimensionScores: "not-an-array" }),
      mappedFullTranscript(),
      "dimensionScores",
      "wrong_type",
      "string",
    );

    const wrongRationaleType = proposalObject();
    wrongRationaleType.dimensionScores[0].rationale = { private: true };
    expectValidationIssue(
      wrongRationaleType,
      mappedFullTranscript(),
      "dimensionScores.item.rationale",
      "wrong_type",
      "object",
    );

    expectValidationIssue(
      proposalObject(validRows(), {
        strengths: Array(5).fill("Structurally excessive feedback."),
      }),
      mappedFullTranscript(),
      "strengths",
      "wrong_count",
      "array",
    );

    expectValidationIssue(
      new Proxy(proposalObject(), {
        ownKeys() {
          throw new Error("PRIVATE unexpected validation failure");
        },
      }),
      mappedFullTranscript(),
      "root",
      "unknown_validation_error",
    );
  });

  it("returns only allowlisted path, reason, and received-type metadata", () => {
    const privateModelValue = "PRIVATE-MODEL-TEXT-MUST-NOT-BE-RETAINED";
    const proposal = proposalObject();
    proposal.overallSummary = { privateModelValue };

    const issue = expectValidationIssue(
      proposal,
      mappedFullTranscript(),
      "overallSummary",
      "wrong_type",
      "object",
    );

    expect(JSON.stringify(issue)).not.toContain(privateModelValue);
    expect(JSON.stringify(issue)).not.toContain("privateModelValue");
  });

  it("accepts an empty partial rationale only when its score is null", () => {
    const proposal = proposalObject();
    proposal.dimensionScores = EXPECTED_DIMENSIONS.map((dimension) => ({
      dimension,
      score: dimension === "structure" || dimension === "communication" ? 3 : null,
      rationale: dimension === "structure" || dimension === "communication"
        ? "The observed response was organized and concise."
        : "",
    }));

    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.dimensionScores.filter((item) => item.score === null)
      .every((item) => item.rationale === "")).toBe(true);
  });

  it("replaces an empty rationale in a full report", () => {
    const proposal = proposalObject();
    proposal.dimensionScores[0].rationale = "";
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.dimensionScores[0]).toEqual({
      dimension: "structure",
      score: 4,
      rationale: "Structure was a demonstrated strength across the observed stages.",
    });
    expect(result.proposal.dimensionScores.slice(1).map((item) => item.rationale))
      .toEqual(Array(4).fill(
        "The observed response demonstrated a clear and decision-focused approach.",
      ));
  });

  it("permits an empty quantitative assessment when no quantitative stage was answered", () => {
    const proposal = proposalObject(validRows(), { quantitativeAssessment: "" });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework", "analysis"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.quantitativeAssessment).toBe("");
  });

  it("replaces an empty quantitative assessment when a quantitative stage was answered", () => {
    const proposal = proposalObject(validRows(), { quantitativeAssessment: "" });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["data_reveal"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.quantitativeAssessment).toBe(
      "The quantitative approach was clear and connected the calculations to the business decision.",
    );
  });

  it("discards missing-stage feedback before wording-safety validation", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [
        {
          stage: "framework",
          kind: "strength",
          text: "The observed framework was logically organized.",
        },
        {
          stage: "recommendation",
          kind: "improvement",
          text: "The protected result is 128 and this text must be discarded.",
        },
      ],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([
      {
        stage: "framework",
        kind: "strength",
        text: "The observed framework was logically organized.",
      },
    ]);
  });

  it("discards malformed feedback for a valid unanswered stage", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{ stage: "recommendation" }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([]);
  });

  it("ignores unexpected fields on feedback for a valid unanswered stage", () => {
    const privateDiscardedField = "PRIVATE-UNANSWERED-STAGE-FIELD";
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "recommendation",
        unexpected: privateDiscardedField,
      }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([]);
    expect(JSON.stringify(result.proposal)).not.toContain(privateDiscardedField);
  });

  it("ignores an invalid kind on feedback for a valid unanswered stage", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "recommendation",
        kind: "private_invalid_kind",
        text: "This discarded text cannot reach the candidate.",
      }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([]);
  });

  it("replaces candidate-overlap feedback for an answered stage without rejecting the proposal", () => {
    const mapped = mappedStages(["framework"]);
    const copiedCandidateText = mapped.turns.find(
      (turn) => turn.role === "candidate",
    )!.text;
    const proposal = proposalObject(validRows(), {
      stageFeedback: [
        {
          stage: "framework",
          kind: "strength",
          text: copiedCandidateText,
        },
      ],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mapped,
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([{
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    }]);
    expect(JSON.stringify(result.proposal)).not.toContain(copiedCandidateText);
  });

  it("replaces protected-reference overlap feedback for an answered stage", () => {
    const protectedReference =
      "Pain-point-led, MECE structure tailored to the airport before proposing AI tools.";
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: protectedReference,
      }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([{
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    }]);
    expect(JSON.stringify(result.proposal)).not.toContain(protectedReference);
  });

  it("replaces qualitative numeric feedback for an answered stage", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: "The framework covered 9 clear areas.",
      }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([{
      stage: "framework",
      kind: "strength",
      text: "Structure was a relative strength.",
    }]);
  });

  it("omits recoverable optional stage prose when no deterministic item applies", () => {
    const proposal = proposalObject(validRows(3), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
        text: "",
      }],
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stageFeedback).toEqual([]);
    expect(result.proposal.dimensionScores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows(3));
    expect(result.proposal.overallSummary).toContain("worked through the case");
  });

  it("still rejects malformed feedback for an answered stage", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "framework",
        kind: "strength",
      }],
    });
    expectValidationIssue(
      proposal,
      mappedStages(["framework"]),
      "stageFeedback",
      "missing_required_field",
    );
  });

  it("does not let an invalid stage identifier bypass validation", () => {
    const proposal = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "private_unknown_stage",
        kind: "private_invalid_kind",
      }],
    });
    expectValidationIssue(
      proposal,
      mappedStages(["framework"]),
      "stageFeedback",
      "invalid_enum",
      "string",
    );
  });

  it("preserves full-report feedback validation", () => {
    const invalidKind = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "recommendation",
        kind: "private_invalid_kind",
        text: "This field remains invalid in a full report.",
      }],
    });
    expectValidationIssue(
      invalidKind,
      mappedFullTranscript(),
      "stageFeedback",
      "invalid_enum",
      "string",
    );

    const unexpectedField = proposalObject(validRows(), {
      stageFeedback: [{
        stage: "recommendation",
        kind: "strength",
        text: "This field remains structurally validated in a full report.",
        unexpected: true,
      }],
    });
    expectValidationIssue(
      unexpectedField,
      mappedFullTranscript(),
      "stageFeedback",
      "unexpected_field",
    );
  });

  it("does not retain discarded feedback in model diagnostics", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const privateDiscardedContent = "PRIVATE-DISCARDED-FEEDBACK-CONTENT-128";
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      stageFeedback: [{
        stage: "recommendation",
        kind: "private_invalid_kind",
        text: privateDiscardedContent,
        unexpected: { privateDiscardedContent },
      }],
    })));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedStages(["framework"]),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.modelDiagnostic).toMatchObject({
      validationPath: null,
      validationReason: null,
      validationReceivedType: null,
    });
    expect(JSON.stringify(result.modelDiagnostic)).not.toContain(privateDiscardedContent);
    expect(JSON.stringify(result.report)).not.toContain(privateDiscardedContent);
  });

  it("discards all out-of-scope partial content before validating its prose", () => {
    const privateModelValue = "PRIVATE-MISSING-STAGE-OUTLINE";
    const proposal = proposalObject(validRows(), {
      strengths: { privateModelValue },
      improvements: { privateModelValue },
      improvedRecommendationOutline: [{ privateModelValue }],
      quantitativeAssessment: { privateModelValue },
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedStages(["framework"]),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.strengths).toEqual([]);
    expect(result.proposal.improvements).toEqual([]);
    expect(result.proposal.improvedRecommendationOutline).toEqual([]);
    expect(result.proposal.quantitativeAssessment).toBe("");
    expect(JSON.stringify(result.proposal)).not.toContain(privateModelValue);
  });

  const recoverableReasons = [
    "candidate_overlap",
    "protected_reference_overlap",
    "too_long",
    "empty",
    "qualitative_numeric_wording",
  ] as const;

  it.each(PROSE_FIELDS.flatMap((field) =>
    recoverableReasons
      .filter((reason) =>
        field !== "quantitativeAssessment" ||
        reason !== "qualitative_numeric_wording"
      )
      .map((reason) => ({ field, reason }))
  ))(
    "recovers $reason only within $field and preserves all structured scores",
    ({ field, reason }) => {
      const mapped = mappedFullTranscript();
      const candidateText = mapped.turns.find(
        (turn) => turn.role === "candidate" && turn.stage === "framework",
      )!.text;
      const sourceText = reason === "candidate_overlap"
        ? candidateText
        : reason === "protected_reference_overlap"
          ? "Pain-point-led, MECE structure tailored to the airport before proposing AI tools."
          : reason === "too_long"
            ? "x".repeat(600)
            : reason === "empty"
              ? ""
              : "The coaching referenced nine distinct themes.";
      const proposal = proposalObject();
      proposal.overallSummary = "Safe Haiku summary content remains available.";
      proposal.strengths = ["Safe Haiku strength content remains available."];
      proposal.improvements = ["Safe Haiku improvement content remains available."];
      replaceProseField(proposal, field, sourceText);

      const result = validateCasePostCallModelProposal(
        proposal,
        mapped,
        getVoiceLlmCaseRecord(AIRPORT)!,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.proposal.dimensionScores.map(({ dimension, score }) => ({
        dimension,
        score,
      }))).toEqual(validRows());
      expect(proseFieldValues(result.proposal, field).every(Boolean)).toBe(true);
      if (sourceText) {
        expect(JSON.stringify(result.proposal)).not.toContain(sourceText);
      }
      if (field !== "overallSummary") {
        expect(result.proposal.overallSummary).toBe(
          "Safe Haiku summary content remains available.",
        );
      }
      if (field !== "strengths") {
        expect(result.proposal.strengths).toContain(
          "Safe Haiku strength content remains available.",
        );
      }
      if (field !== "improvements") {
        expect(result.proposal.improvements).toContain(
          "Safe Haiku improvement content remains available.",
        );
      }
    },
  );

  it.each([
    "strengths",
    "improvements",
    "stageFeedback",
    "frameworkOutline",
    "recommendationOutline",
  ] as const)(
    "preserves safe sibling entries when one %s item is recoverable",
    (field) => {
      const mapped = mappedFullTranscript();
      const copiedCandidateText = mapped.turns.find(
        (turn) => turn.role === "candidate" && turn.stage === "framework",
      )!.text;
      const firstSafe = "First safe Haiku coaching item remains available.";
      const secondSafe = "Second safe Haiku coaching item remains available.";
      const proposal = proposalObject();
      if (field === "stageFeedback") {
        proposal.stageFeedback = [
          { stage: "framework", kind: "strength", text: firstSafe },
          { stage: "framework", kind: "strength", text: copiedCandidateText },
          { stage: "analysis", kind: "improvement", text: secondSafe },
        ];
      } else {
        replaceProseField(proposal, field, copiedCandidateText);
        const key = field === "frameworkOutline"
          ? "improvedFrameworkOutline"
          : field === "recommendationOutline"
            ? "improvedRecommendationOutline"
            : field;
        proposal[key] = [firstSafe, copiedCandidateText, secondSafe];
      }

      const result = validateCasePostCallModelProposal(
        proposal,
        mapped,
        getVoiceLlmCaseRecord(AIRPORT)!,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const retained = proseFieldValues(result.proposal, field);
      expect(retained).toContain(firstSafe);
      expect(retained).toContain(secondSafe);
      expect(retained).not.toContain(copiedCandidateText);
      expect(result.proposal.dimensionScores.map(({ dimension, score }) => ({
        dimension,
        score,
      }))).toEqual(validRows());
    },
  );

  it("keeps exact dimension count, enum, uniqueness, and score checks", () => {
    expectValidationIssue(
      proposalObject(validRows().slice(0, 4)),
      mappedFullTranscript(),
      "dimensionScores.count",
      "wrong_count",
      "array",
    );

    const duplicate = validRows();
    duplicate[2] = { dimension: "hypothesis_driven_thinking", score: 4 } as any;
    expectValidationIssue(
      proposalObject(duplicate),
      mappedFullTranscript(),
      "dimensionScores.item.dimension",
      "duplicate_dimension",
      "string",
    );

    const unknown = validRows();
    unknown[2] = { dimension: "private_unknown_dimension", score: 4 } as any;
    expectValidationIssue(
      proposalObject(unknown),
      mappedFullTranscript(),
      "dimensionScores.item.dimension",
      "invalid_enum",
      "string",
    );

    const invalidScore = validRows();
    invalidScore[0] = { dimension: "structure", score: 6 };
    expectValidationIssue(
      proposalObject(invalidScore),
      mappedFullTranscript(),
      "dimensionScores.item.score",
      "invalid_score",
      "number",
    );

    const wrongScoreType = validRows() as Array<{ dimension: string; score: any }>;
    wrongScoreType[0] = { dimension: "structure", score: "4" };
    expectValidationIssue(
      proposalObject(wrongScoreType),
      mappedFullTranscript(),
      "dimensionScores.item.score",
      "wrong_type",
      "string",
    );
  });

  it("preserves the full-report structural contract while recovering empty prose", () => {
    const valid = validateCasePostCallModelProposal(
      proposalObject(),
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(valid.ok).toBe(true);

    const emptyProse = validateCasePostCallModelProposal(
      proposalObject(validRows(), { improvedFrameworkOutline: [] }),
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(emptyProse.ok).toBe(true);
    if (!emptyProse.ok) return;
    expect(emptyProse.proposal.improvedFrameworkOutline).toEqual([
      "Restate the decision and define the success criteria.",
      "Organize the problem into distinct commercial, operational, and execution questions.",
      "State the leading hypothesis and identify the analyses needed to test it.",
    ]);

    expectValidationIssue(
      proposalObject(validRows(), { improvedFrameworkOutline: "not-an-array" }),
      mappedFullTranscript(),
      "frameworkOutline",
      "wrong_type",
      "string",
    );
  });

  it.each([
    ["digits", "The response referenced 9 commercial levers."],
    ["number words", "The response referenced nine commercial levers."],
    ["percentages", "The response referenced 7 percent growth."],
    ["currencies", "The response referenced $50 of value."],
    ["dimension-score wording", "The response merits nine out of ten."],
    ["stage-count wording", "The response covered nine stages."],
  ])("replaces %s in qualitative dimension rationales", (_label, rationale) => {
    const proposal = proposalObject();
    proposal.dimensionScores[0].rationale = rationale;
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.dimensionScores[0].rationale).toBe(
      "Structure was a demonstrated strength across the observed stages.",
    );
    expect(result.proposal.dimensionScores.slice(1).map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows().slice(1));
    expect(result.proposal.overallSummary).toContain("worked through the case");
  });

  it.each([
    ["overallSummary", (proposal: Record<string, any>) => { proposal.overallSummary = "The response covered 9 stages."; }],
    ["strengths", (proposal: Record<string, any>) => { proposal.strengths = ["The response used 9 clear ideas."]; }],
    ["improvements", (proposal: Record<string, any>) => { proposal.improvements = ["Add 9 clearer hypotheses."]; }],
    ["stageFeedback", (proposal: Record<string, any>) => { proposal.stageFeedback = [{ stage: "framework", kind: "strength", text: "The framework had 9 clear areas." }]; }],
    ["frameworkOutline", (proposal: Record<string, any>) => { proposal.improvedFrameworkOutline = ["Start with 9 workstreams."]; }],
    ["recommendationOutline", (proposal: Record<string, any>) => { proposal.improvedRecommendationOutline = ["Name 9 implementation risks."]; }],
  ])("replaces numerical claims only within qualitative %s", (_label, mutate) => {
    const proposal = proposalObject();
    mutate(proposal);
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.proposal)).not.toMatch(
      /9 stages|9 clear ideas|9 clearer hypotheses|9 clear areas|9 workstreams|9 implementation risks/,
    );
    expect(result.proposal.dimensionScores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows());
    if (_label !== "overallSummary") {
      expect(result.proposal.overallSummary).toContain("worked through the case");
    }
  });

  const PROTECTED_ANSWER_PROSE =
    "The protected total daily retail revenue was SAR 4,240,000.";

  it("keeps protected numerical answer leakage fatal in quantitativeAssessment", () => {
    const proposal = proposalObject();
    replaceProseField(proposal, "quantitativeAssessment", PROTECTED_ANSWER_PROSE);
    expectValidationIssue(
      proposal,
      mappedFullTranscript(),
      "quantitativeAssessment",
      "unsafe_numeric_claim",
      "string",
    );
  });

  it.each(PROSE_FIELDS.filter((field) => field !== "quantitativeAssessment"))(
    "recovers protected numerical answer leakage in the qualitative field %s",
    (field) => {
      const proposal = proposalObject();
      replaceProseField(proposal, field, PROTECTED_ANSWER_PROSE);

      const result = validateCasePostCallModelProposal(
        proposal,
        mappedFullTranscript(),
        getVoiceLlmCaseRecord(AIRPORT)!,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The single affected field is replaced with safe deterministic prose;
      // the protected value never reaches candidate-visible output.
      expect(proseFieldValues(result.proposal, field).every(Boolean)).toBe(true);
      expect(JSON.stringify(result.proposal)).not.toContain(PROTECTED_ANSWER_PROSE);
      expect(JSON.stringify(result.proposal)).not.toContain("4,240,000");
      // Structured dimension scores are untouched by prose recovery.
      expect(result.proposal.dimensionScores.map(({ dimension, score }) => ({
        dimension,
        score,
      }))).toEqual(validRows());
    },
  );

  it("keeps structured dimension scores independent from prose recovery", () => {
    const result = validateCasePostCallModelProposal(
      proposalObject(validRows(4)),
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.dimensionScores.map((item) => item.score)).toEqual([4, 4, 4, 4, 4]);
  });

  it("accepts candidate-stated numbers in the quantitative assessment", () => {
    const mapped = mappedFullTranscript();
    const candidate = mapped.turns.find((turn) =>
      turn.role === "candidate" && turn.stage === "data_reveal",
    )!;
    candidate.text = "I would use 777 passengers as the starting assumption.";
    const proposal = proposalObject(validRows(), {
      quantitativeAssessment: "The assessment used the candidate-stated 777-passenger assumption.",
    });
    const result = validateCasePostCallModelProposal(proposal, mapped, getVoiceLlmCaseRecord(AIRPORT)!);
    expect(result.ok).toBe(true);
  });

  it("accepts candidate-visible opening numbers in the quantitative assessment", () => {
    const proposal = proposalObject(validRows(), {
      quantitativeAssessment: "The assessment connected the stated 25 percent starting share to the case objective.",
    });
    const result = validateCasePostCallModelProposal(
      proposal,
      mappedFullTranscript(),
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts canonical equivalents of spoken data-reveal and pressure-test inputs", () => {
    const mapped = mappedFullTranscript();
    addAssistantNumericInput(mapped, "data_reveal", "The baseline includes 60,000 international passengers.");
    addAssistantNumericInput(mapped, "pressure_test", "Consider a five percentage point conversion improvement.");
    const proposal = proposalObject(validRows(), {
      quantitativeAssessment: "The assessment used sixty thousand international passengers and a 5 percent conversion improvement.",
    });
    const result = validateCasePostCallModelProposal(proposal, mapped, getVoiceLlmCaseRecord(AIRPORT)!);
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported, protected final-answer, and hidden-derived numbers", () => {
    const caseRecord = getVoiceLlmCaseRecord(AIRPORT)!;
    const mapped = mappedFullTranscript();
    for (const quantitativeAssessment of [
      "The assessment used 999 passengers.",
      "The assessment reached 4,240,000 in daily revenue.",
      "The assessment calculated 24,000 buyers.",
    ]) {
      const proposal = proposalObject(validRows(), { quantitativeAssessment });
      expectValidationIssue(
        proposal,
        mapped,
        "quantitativeAssessment",
        "unsafe_numeric_claim",
        "string",
      );
      expect(caseRecord.quant?.answer).toContain("4,240,000");
    }
  });

  it("applies the same grounded numeric policy to partial quantitative assessments", () => {
    const mapped = mappedStages(["data_reveal"]);
    addAssistantNumericInput(mapped, "data_reveal", "The baseline includes 60,000 international passengers.");
    const accepted = validateCasePostCallModelProposal(
      proposalObject(validRows(), {
        quantitativeAssessment: "The assessment used sixty thousand international passengers.",
      }),
      mapped,
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(accepted.ok).toBe(true);

    expectValidationIssue(
      proposalObject(validRows(), { quantitativeAssessment: "The assessment used 999 passengers." }),
      mapped,
      "quantitativeAssessment",
      "unsafe_numeric_claim",
      "string",
    );
  });

  it("keeps a grounded quantitative assessment through the one-call model result", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const mapped = mappedFullTranscript();
    addAssistantNumericInput(mapped, "data_reveal", "The baseline includes 60,000 international passengers.");
    completeMock.mockResolvedValueOnce(completion(qualitativeProposal(validRows(), {
      quantitativeAssessment: "The assessment used sixty thousand international passengers.",
    })));

    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.report.score.quantitative_assessment).toContain("sixty thousand");
  });

  it("shortens otherwise-safe model text without changing dimensions or scores", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const rationaleSentence =
      "Observed reasoning stayed focused and linked each conclusion to its supporting logic.";
    const overlongRationale = Array(8).fill(rationaleSentence).join(" ");
    const summaryPhrase =
      "Observed business reasoning maintained coherent direction across the discussion";
    const overlongSummary = Array(12).fill(summaryPhrase).join(" ");
    const quantitativePhrase =
      "Observed calculation reasoning connected the stated approach with its business implication";
    const overlongQuantitativeAssessment = Array(12)
      .fill(quantitativePhrase)
      .join(" ");
    const proposal = proposalObject(validRows(), {
      overallSummary: overlongSummary,
      quantitativeAssessment: overlongQuantitativeAssessment,
    });
    proposal.dimensionScores[0].rationale = overlongRationale;
    completeMock.mockResolvedValueOnce(completion(JSON.stringify(proposal)));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();

    const structure = result.report.score.dimension_scores[0];
    expect(structure.dimension).toBe("structure");
    expect(structure.score).toBe(4);
    expect(structure.justification.length).toBeLessThanOrEqual(360);
    expect(structure.justification.endsWith(".")).toBe(true);
    expect(overlongRationale.startsWith(structure.justification)).toBe(true);

    expect(result.report.score.summary.length).toBeLessThanOrEqual(480);
    expect(overlongSummary.startsWith(result.report.score.summary)).toBe(true);
    expect(overlongSummary[result.report.score.summary.length]).toBe(" ");

    const quantitative = result.report.score.quantitative_assessment!;
    expect(quantitative.length).toBeLessThanOrEqual(480);
    expect(overlongQuantitativeAssessment.startsWith(quantitative)).toBe(true);
    expect(overlongQuantitativeAssessment[quantitative.length]).toBe(" ");
    expect(result.report.score.dimension_scores.map(({ dimension, score }) => ({
      dimension,
      score,
    }))).toEqual(validRows());
  });

  it("replaces unsafe source text instead of letting truncation repair it", () => {
    const mapped = mappedFullTranscript();
    const copiedCandidateText = mapped.turns.find(
      (turn) => turn.role === "candidate",
    )!.text;
    const safeTail = Array(10)
      .fill("Additional coaching language remains beyond the configured boundary")
      .join(" ");
    const proposal = proposalObject();
    proposal.dimensionScores[0].rationale = `${copiedCandidateText} ${safeTail}`;

    const result = validateCasePostCallModelProposal(
      proposal,
      mapped,
      getVoiceLlmCaseRecord(AIRPORT)!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.dimensionScores[0].rationale).toBe(
      "Structure was a demonstrated strength across the observed stages.",
    );
    expect(JSON.stringify(result.proposal)).not.toContain(copiedCandidateText);
  });

  it("attaches safe validation metadata without retaining rejected model content", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    const privateModelValue = "PRIVATE-REJECTED-MODEL-CONTENT";
    completeMock.mockResolvedValueOnce(completion(JSON.stringify(proposalObject(
      validRows(),
      { overallSummary: { privateModelValue } },
    ))));

    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.failureCategory).toBe("schema_validation_error");
    expect(result.modelDiagnostic).toMatchObject({
      validationPath: "overallSummary",
      validationReason: "wrong_type",
      validationReceivedType: "object",
    });
    expect(JSON.stringify(result.modelDiagnostic)).not.toContain(privateModelValue);
    expect(JSON.stringify(result.report)).not.toContain(privateModelValue);
  });
});

describe("Case post-call safe model failure classification", () => {
  async function expectFailure(
    expected: string,
    arrange: () => void,
  ) {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    arrange();
    const result = await scoreCasePostCall(
      getVoiceLlmCaseRecord(AIRPORT)!,
      mappedFullTranscript(),
    );
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return null;
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe(expected);
    expect(result.report.partial).toBe(false);
    return result;
  }

  it("classifies a missing API key without exposing the thrown message", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const secret = "sk-ant-private-candidate-fragment";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expectFailure("missing_api_key", () => {
      completeMock.mockRejectedValueOnce(new Error(secret));
    });
    expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain(secret);
    info.mockRestore();
    error.mockRestore();
  });

  it("classifies an Anthropic authentication error with safe metadata", async () => {
    const result = await expectFailure("authentication_error", () => {
      completeMock.mockRejectedValueOnce(anthropicApiError(
        AuthenticationError,
        401,
        "authentication_error",
      ));
    });
    expect(result?.modelDiagnostic).toEqual({
      httpStatus: 401,
      anthropicErrorType: "authentication_error",
      stopReason: null,
      inputTokens: null,
      outputTokens: null,
      validationPath: null,
      validationReason: null,
      validationReceivedType: null,
    });
  });

  it("classifies an unavailable model", async () => {
    const result = await expectFailure("model_not_found", () => {
      completeMock.mockRejectedValueOnce(anthropicApiError(
        NotFoundError,
        404,
        "not_found_error",
      ));
    });
    expect(result?.modelDiagnostic.httpStatus).toBe(404);
    expect(result?.modelDiagnostic.anthropicErrorType).toBe("not_found_error");
  });

  it("uses the extended one-call contract and still falls back safely on timeout", async () => {
    const result = await expectFailure("timeout", () => {
      completeMock.mockRejectedValueOnce(new APIConnectionTimeoutError());
    });
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0]?.[1]).toMatchObject({
      model: "claude-haiku-4-5",
      timeoutMs: 60_000,
      maxRetries: 0,
    });
    expect(result?.report.score.summary).toContain("complete case sequence");
  });

  it("classifies an SDK network error", async () => {
    await expectFailure("network_error", () => {
      completeMock.mockRejectedValueOnce(new APIConnectionError({
        message: "PRIVATE network path",
      }));
    });
  });

  it("classifies other Anthropic API failures as provider errors", async () => {
    const result = await expectFailure("provider_error", () => {
      completeMock.mockRejectedValueOnce(anthropicApiError(
        BadRequestError,
        400,
        "invalid_request_error",
      ));
    });
    expect(result?.modelDiagnostic).toMatchObject({
      httpStatus: 400,
      anthropicErrorType: "invalid_request_error",
    });
  });

  it("classifies an unrecognized thrown error without logging its content", async () => {
    const secret = "PRIVATE serialized transcript and prompt";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expectFailure("unknown_model_error", () => {
      completeMock.mockRejectedValueOnce(new Error(secret));
    });
    expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain(secret);
    info.mockRestore();
    error.mockRestore();
  });

  it("classifies a max-token structured response before parsing", async () => {
    const result = await expectFailure("max_tokens", () => {
      completeMock.mockResolvedValueOnce(completion("{", {
        stopReason: "max_tokens",
        inputTokens: 900,
        outputTokens: 1_800,
      }));
    });
    expect(result?.modelDiagnostic).toMatchObject({
      stopReason: "max_tokens",
      inputTokens: 900,
      outputTokens: 1_800,
    });
  });

  it("classifies a refusal response before parsing", async () => {
    const result = await expectFailure("refusal", () => {
      completeMock.mockResolvedValueOnce(completion("refusal content", {
        stopReason: "refusal",
      }));
    });
    expect(result?.modelDiagnostic.stopReason).toBe("refusal");
  });

  it("classifies JSON extraction and parsing failures", async () => {
    await expectFailure("malformed_json", () => {
      completeMock.mockResolvedValueOnce(completion("not structured JSON"));
    });
  });

  it("classifies locally invalid proposals as schema validation failures", async () => {
    await expectFailure("schema_validation_error", () => {
      completeMock.mockResolvedValueOnce(completion(JSON.stringify({
        unexpected: true,
      })));
    });
  });
});
