import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, completeWithMetadata: completeMock };
});

import {
  TECHNICAL_CASE_POST_CALL_OUTPUT_SCHEMA,
  TECHNICAL_DIMENSIONS,
  candidateSafeTechnicalCasePostCallScore,
  scoreTechnicalCasePostCall,
} from "@/lib/voice/case-technical-post-call-scorer";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  mapCaseTranscript,
} from "@/lib/voice/case-transcript";
import { CASE_VOICE_STAGE_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { normalizeVoiceTranscript } from "@/lib/voice/transcript";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";

const DATA_ENGINEER = "data_engineer_clickstream";
const CASE_RECORD = getVoiceLlmCaseRecord(DATA_ENGINEER)!;

function completion(text: string, stopReason: "end_turn" | "max_tokens" | "refusal" = "end_turn") {
  return { text, stopReason, inputTokens: 200, outputTokens: 400 };
}

function mappedFullTranscript(candidateText = "generic response") {
  const manifest = caseStageAnchorManifest(DATA_ENGINEER, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript(CASE_REPORT_STAGES.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    { role: "user", message: candidateText },
  ]));
  return mapCaseTranscript(
    DATA_ENGINEER,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: normalized.truncated },
  )!;
}

function mappedPartialTranscript() {
  const manifest = caseStageAnchorManifest(DATA_ENGINEER, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript([
    { role: "assistant", message: manifest.anchors.framework },
    { role: "user", message: "I would ingest through a load balancer into Kafka, then process with Flink into S3 and a warehouse." },
  ]);
  return mapCaseTranscript(
    DATA_ENGINEER,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: false },
  )!;
}

function validRows(score = 4) {
  return TECHNICAL_DIMENSIONS.map((dimension) => ({ dimension, score }));
}

function proposal(rows = validRows(), overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    dimensionScores: rows.map((row) => ({
      ...row,
      rationale: "The observed response demonstrated a clear and defensible architecture.",
    })),
    overallSummary: "The candidate worked through the pipeline design coherently.",
    strengths: ["Reasoned clearly about durability and correctness guarantees."],
    improvements: ["Make the backfill mechanism more concrete."],
    stageFeedback: [
      { stage: "framework", kind: "strength", text: "The high-level design was well organized." },
      { stage: "analysis", kind: "improvement", text: "The ETL/ELT trade-off could be stated earlier." },
    ],
    improvedPipelineOutline: [
      "Name every stage of the lifecycle: ingestion, buffering, processing, storage, serving.",
    ],
    improvedOperationsOutline: [
      "Describe a concrete backfill mechanism for logic changes.",
    ],
    scaleReliabilityAssessment: "The scale and reliability reasoning connected clearly to the stated throughput.",
    ...overrides,
  });
}

const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  completeMock.mockReset();
  process.env.SYNTHESIS_USE_MOCKS = "true";
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

afterEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
  if (ORIGINAL_ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
});

describe("scoreTechnicalCasePostCall — mock mode (deterministic heuristic)", () => {
  it("scores a strong, keyword-rich transcript higher than a weak one on the same dimensions", async () => {
    const strong = mappedFullTranscript(
      "I would ingest via a schema registry, buffer in Kafka, process with Flink using tumbling and session windows, " +
      "watermark for late data, deduplicate on event id, partition S3 by date and hour, and land exactly-once Gold tables " +
      "in a warehouse while monitoring consumer lag and data drift, with a batch backfill job for logic changes.",
    );
    const weak = mappedFullTranscript("I would use a database and some processing, that should work fine I think.");
    const strongResult = await scoreTechnicalCasePostCall(CASE_RECORD, strong);
    const weakResult = await scoreTechnicalCasePostCall(CASE_RECORD, weak);
    expect(strongResult.ok).toBe(true);
    expect(weakResult.ok).toBe(true);
    if (!strongResult.ok || !weakResult.ok) throw new Error("unreachable");
    expect(strongResult.report.score.overall).not.toBeNull();
    const strongAvg = strongResult.report.score.dimension_scores.reduce((s, d) => s + (d.score ?? 0), 0);
    const weakAvg = weakResult.report.score.dimension_scores.reduce((s, d) => s + (d.score ?? 0), 0);
    expect(strongAvg).toBeGreaterThan(weakAvg);
  });

  it("returns a partial report with null scores for unobserved dimensions", async () => {
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedPartialTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.report.partial).toBe(true);
    const unobserved = result.report.score.dimension_scores.find((d) => d.dimension === "observability_operations");
    expect(unobserved?.score).toBeNull();
  });

  it("fails closed on an empty transcript", async () => {
    const manifest = caseStageAnchorManifest(DATA_ENGINEER, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const normalized = normalizeVoiceTranscript([{ role: "assistant", message: manifest.openingAnchor }]);
    const mapped = mapCaseTranscript(DATA_ENGINEER, CASE_VOICE_STAGE_ANCHOR_VERSION, normalized.turns)!;
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mapped);
    expect(result).toEqual({ ok: false, failureCode: "empty_transcript" });
  });
});

describe("scoreTechnicalCasePostCall — model mode", () => {
  it("uses a valid model proposal for a full report", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(proposal()));
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scorerOutcome).toBe("model");
    expect(result.report.score.dimension_scores).toHaveLength(TECHNICAL_DIMENSIONS.length);
    expect(result.report.score.overall).toBe(4);
  });

  it("passes the technical (10-dimension) schema to completeWithMetadata, not the consulting one", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(proposal()));
    await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    const opts = completeMock.mock.calls[0][1];
    expect(opts.outputSchema).toBe(TECHNICAL_CASE_POST_CALL_OUTPUT_SCHEMA);
  });

  it("falls back to the deterministic heuristic on malformed JSON without throwing", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion("not json"));
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("malformed_json");
  });

  it("falls back to the deterministic heuristic on a schema-invalid proposal (wrong dimension count)", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(proposal(validRows().slice(0, 5))));
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("schema_validation_error");
  });

  it("falls back to the deterministic heuristic when the model call throws (network/provider failure)", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockRejectedValueOnce(new Error("network down"));
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.report.score.dimension_scores.length).toBe(TECHNICAL_DIMENSIONS.length);
  });

  it("does not require an exact reference tool name to accept a proposal (accepts a defensible alternative)", async () => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
    completeMock.mockResolvedValueOnce(completion(proposal(validRows(5), {
      overallSummary: "The candidate proposed an equally defensible alternative architecture using different tools.",
    })));
    const result = await scoreTechnicalCasePostCall(CASE_RECORD, mappedFullTranscript());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scorerOutcome).toBe("model");
    expect(result.report.score.overall).toBe(5);
  });
});

describe("candidateSafeTechnicalCasePostCallScore", () => {
  it("never leaks a distinctive candidate transcript sentence or the protected reference notes", () => {
    const distinctive = "The purple zeppelin architecture belongs only to my private transcript.";
    const score = {
      overall: 4,
      dimension_scores: TECHNICAL_DIMENSIONS.map((dimension) => ({
        dimension,
        score: 4,
        justification: distinctive,
        evidence: distinctive,
      })),
      summary: distinctive,
      strengths: [distinctive],
      improvements: [distinctive],
      next_focus: [distinctive],
      stage_feedback: [],
      improved_framework_outline: [distinctive],
      improved_recommendation_outline: [distinctive],
      quantitative_assessment: distinctive,
    };
    const safe = candidateSafeTechnicalCasePostCallScore(score, [
      { role: "candidate", text: distinctive, ordinal: 0 },
    ], CASE_RECORD);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(distinctive);
    expect(safe.dimension_scores.every((d) => !("evidence" in d) || d.evidence === null)).toBe(true);
  });

  it("scopes partial-report feedback to only answered stages", () => {
    const score = {
      overall: null,
      dimension_scores: TECHNICAL_DIMENSIONS.map((dimension) => ({
        dimension,
        score: dimension === "pipeline_design" ? 4 : null,
        justification: "n/a",
        evidence: null,
      })),
      summary: "n/a",
      strengths: ["Unscoped model praise must not be projected."],
      improvements: ["Unscoped model criticism must not be projected."],
      next_focus: [],
      stage_feedback: [
        { stage: "framework" as const, kind: "strength" as const, text: "Observed framework feedback retained." },
        { stage: "recommendation" as const, kind: "improvement" as const, text: "Missing recommendation feedback discarded." },
      ],
      improved_framework_outline: ["Observed framework coaching retained."],
      improved_recommendation_outline: ["Missing recommendation coaching discarded."],
      quantitative_assessment: "Missing quantitative feedback discarded.",
    };
    const safe = candidateSafeTechnicalCasePostCallScore(score, [], CASE_RECORD, {
      partial: true,
      answeredStages: ["framework"],
    });
    expect(safe.strengths).toEqual(["Observed framework feedback retained."]);
    expect(safe.improved_recommendation_outline).toBeNull();
    expect(safe.quantitative_assessment).toBeNull();
    expect(JSON.stringify(safe)).not.toContain("Missing recommendation");
    expect(JSON.stringify(safe)).not.toContain("Unscoped model");
  });
});
