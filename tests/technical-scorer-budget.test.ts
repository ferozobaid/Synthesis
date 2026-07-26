import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, completeWithMetadata: completeMock };
});

import { scoreQuestionBankPostCall } from "@/lib/voice/case-question-bank-scorer";
import { scoreTechnicalCasePostCall } from "@/lib/voice/case-technical-post-call-scorer";
import {
  TECHNICAL_QUESTION_BANK_MAX_TOKENS,
  TECHNICAL_SCORER_MAX_TOKENS,
  TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS,
  technicalScorerMaxTokens,
} from "@/lib/voice/technical-scorer-budget";
import {
  mapQuestionBankTranscript,
  questionAnchorManifest,
} from "@/lib/voice/question-bank-transcript";
import { mapCaseTranscript, caseStageAnchorManifest } from "@/lib/voice/case-transcript";
import {
  CASE_VOICE_QUESTION_ANCHOR_VERSION,
  CASE_VOICE_STAGE_ANCHOR_VERSION,
} from "@/lib/voice/case-native-config";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import { MODEL_IDS } from "@/lib/types";
import { TECHNICAL_DIMENSIONS } from "@/lib/voice/case-technical-dimensions";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";

const clickstreamRecord = getVoiceLlmCaseRecord(CLICKSTREAM)!;
const stageManifest = caseStageAnchorManifest(CLICKSTREAM, CASE_VOICE_STAGE_ANCHOR_VERSION)!;

const ANSWER =
  "I would land raw events in a durable log, run streaming sessionization with watermarks, and publish idempotent Gold aggregates keyed by event id so retries cannot double count anything downstream.";
const WEAK = "I would just use a database and query it.";

let ordinal = 0;
function turn(role: "assistant" | "candidate", text: string): NormalizedVoiceTranscriptTurn {
  return { role, text, ordinal: ordinal++ };
}

function clickstreamMapped(stageCount = 6, answer = ANSWER) {
  ordinal = 0;
  const stages = ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"] as const;
  const transcript: NormalizedVoiceTranscriptTurn[] = [];
  for (const stage of stages.slice(0, stageCount)) {
    transcript.push(turn("assistant", stageManifest.anchors[stage]));
    transcript.push(turn("candidate", answer));
  }
  return mapCaseTranscript(CLICKSTREAM, CASE_VOICE_STAGE_ANCHOR_VERSION, transcript)!;
}

function bankMapped(caseId: string, count = 5, answer = ANSWER) {
  ordinal = 0;
  const manifest = questionAnchorManifest(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
  const transcript: NormalizedVoiceTranscriptTurn[] = [];
  for (const id of manifest.order.slice(0, count)) {
    transcript.push(turn("assistant", `${manifest.anchors[id]} Please walk me through it.`));
    transcript.push(turn("candidate", answer));
  }
  return {
    mapped: mapQuestionBankTranscript(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION, transcript)!,
    order: manifest.order,
  };
}

function completion(json: unknown, overrides: Record<string, unknown> = {}) {
  return {
    text: JSON.stringify(json),
    stopReason: "end_turn",
    inputTokens: 4_997,
    outputTokens: 2_100,
    ...overrides,
  };
}

/** A complete, schema-valid technical_system_design proposal. */
function systemDesignProposal(justification: string) {
  return {
    dimensionScores: TECHNICAL_DIMENSIONS.map((dimension) => ({
      dimension,
      score: 4,
      rationale: justification,
    })),
    overallSummary: "A defensible streaming design with clear correctness handling.",
    strengths: ["Named a durable buffer before processing."],
    improvements: ["Quantify the windowing choice more explicitly."],
    stageFeedback: [
      { stage: "framework", kind: "strength", text: "Clear end-to-end dataflow." },
    ],
    improvedPipelineOutline: ["Producers", "Durable log", "Stream processing", "Serving"],
    improvedOperationsOutline: ["State the architecture", "Name the trade-off"],
    scaleReliabilityAssessment: "Tied throughput and latency targets to the processing layer.",
  };
}

function bankProposal(order: readonly string[], justification: string) {
  return {
    questionScores: order.map((id) => ({
      questionId: id,
      score: 4,
      justification,
    })),
  };
}

beforeEach(() => {
  completeMock.mockReset();
  process.env.SYNTHESIS_USE_MOCKS = "false";
});
afterEach(() => {
  delete process.env.SYNTHESIS_USE_MOCKS;
});

/** The maxTokens actually sent on the single model call. */
function sentMaxTokens(): number {
  expect(completeMock).toHaveBeenCalledTimes(1);
  return completeMock.mock.calls[0][1].maxTokens as number;
}
function sentModel(): string {
  return completeMock.mock.calls[0][1].model as string;
}

describe("1–2. technical evaluators use their new technical budgets", () => {
  it("technical_system_design sends its technical budget", async () => {
    completeMock.mockResolvedValue(completion(systemDesignProposal("Well reasoned and specific.")));
    await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    expect(sentMaxTokens()).toBe(TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS);
    expect(TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS).toBe(3_200);
  });

  it("technical_question_bank sends its technical budget", async () => {
    const { mapped, order } = bankMapped(DA_ROUND);
    completeMock.mockResolvedValue(completion(bankProposal(order, "Clear and well reasoned answer.")));
    await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DA_ROUND)!, mapped);
    expect(sentMaxTokens()).toBe(TECHNICAL_QUESTION_BANK_MAX_TOKENS);
    expect(TECHNICAL_QUESTION_BANK_MAX_TOKENS).toBe(3_200);
  });

  it("both budgets exceed the 1800-token ceiling that caused the observed fallback", () => {
    expect(technicalScorerMaxTokens("technical_system_design")).toBeGreaterThan(1_800);
    expect(technicalScorerMaxTokens("technical_question_bank")).toBeGreaterThan(1_800);
  });

  it("keeps Claude Haiku as the model for both technical paths", async () => {
    completeMock.mockResolvedValue(completion(systemDesignProposal("Well reasoned and specific.")));
    await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    expect(sentModel()).toBe(MODEL_IDS.default);
    expect(MODEL_IDS.default).toBe("claude-haiku-4-5");
  });
});

describe("3–4. untouched scorers keep their existing budgets", () => {
  it("the consulting case scorer still requests 1800 output tokens", () => {
    const src = readFileSync(join(process.cwd(), "lib/voice/case-post-call-scorer.ts"), "utf8");
    expect(src.includes("maxTokens: 1_800")).toBe(true);
    // It is not routed through the technical budget module.
    expect(src.includes("technical-scorer-budget")).toBe(false);
  });

  it("the Behavioural scorer is not routed through the technical budget module", () => {
    const src = readFileSync(join(process.cwd(), "lib/behavioural/runner.ts"), "utf8");
    expect(src.includes("technical-scorer-budget")).toBe(false);
  });

  it("only the two technical evaluators have a technical budget", () => {
    expect(Object.keys(TECHNICAL_SCORER_MAX_TOKENS).sort()).toEqual([
      "technical_question_bank",
      "technical_system_design",
    ]);
  });
});

describe("5–8. complete valid reports are accepted without fallback", () => {
  it("a complete Clickstream report is accepted as a model result", async () => {
    completeMock.mockResolvedValue(completion(systemDesignProposal("Specific, evidence-based reasoning.")));
    const result = await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
  });

  it("a valid Data Analyst report is accepted as a model result", async () => {
    const { mapped, order } = bankMapped(DA_ROUND);
    completeMock.mockResolvedValue(completion(bankProposal(order, "Clear and well reasoned answer.")));
    const result = await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DA_ROUND)!, mapped);
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("model");
    expect(result.failureCategory).toBeNull();
  });

  it("a valid Data Engineer report is accepted as a model result", async () => {
    const { mapped, order } = bankMapped(DE_ROUND);
    completeMock.mockResolvedValue(completion(bankProposal(order, "Clear and well reasoned answer.")));
    const result = await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DE_ROUND)!, mapped);
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("model");
  });

  it("strong, partial, and weak Clickstream reports all validate", async () => {
    const cases: Array<[string, ReturnType<typeof clickstreamMapped>]> = [
      ["strong", clickstreamMapped(6, ANSWER)],
      ["partial", clickstreamMapped(3, ANSWER)],
      ["weak", clickstreamMapped(6, WEAK)],
    ];
    for (const [, mapped] of cases) {
      completeMock.mockReset();
      completeMock.mockResolvedValue(
        completion(systemDesignProposal("Reasoning was present but under-specified.")),
      );
      const result = await scoreTechnicalCasePostCall(clickstreamRecord, mapped);
      if (!result.ok) throw new Error("expected ok");
      expect(result.scorerOutcome).toBe("model");
      expect(sentMaxTokens()).toBe(TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS);
    }
  });

  it("strong, partial, and weak question-bank reports all validate", async () => {
    for (const [count, answer] of [[5, ANSWER], [2, ANSWER], [5, WEAK]] as const) {
      completeMock.mockReset();
      const { mapped, order } = bankMapped(DA_ROUND, count, answer);
      completeMock.mockResolvedValue(completion(bankProposal(order, "Reasoning was partly complete.")));
      const result = await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DA_ROUND)!, mapped);
      if (!result.ok) throw new Error("expected ok");
      expect(result.scorerOutcome).toBe("model");
      expect(sentMaxTokens()).toBe(TECHNICAL_QUESTION_BANK_MAX_TOKENS);
    }
  });
});

describe("9–10. unsafe results still fall back safely", () => {
  it("a real max_tokens stop still falls back deterministically (system design)", async () => {
    completeMock.mockResolvedValue(
      completion(systemDesignProposal("Truncated."), { stopReason: "max_tokens", outputTokens: 3_200 }),
    );
    const result = await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("max_tokens");
    expect(result.report.score.dimension_scores.length).toBeGreaterThan(0);
  });

  it("a real max_tokens stop still falls back deterministically (question bank)", async () => {
    const { mapped, order } = bankMapped(DE_ROUND);
    completeMock.mockResolvedValue(
      completion(bankProposal(order, "Truncated."), { stopReason: "max_tokens" }),
    );
    const result = await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DE_ROUND)!, mapped);
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("max_tokens");
  });

  it("malformed JSON still falls back deterministically", async () => {
    completeMock.mockResolvedValue({
      text: "not json at all",
      stopReason: "end_turn",
      inputTokens: 10,
      outputTokens: 20,
    });
    const result = await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("malformed_json");
  });

  it("schema-invalid output still falls back deterministically", async () => {
    completeMock.mockResolvedValue(completion({ dimensionScores: "wrong type" }));
    const result = await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("schema_validation_error");
  });

  it("a refusal still falls back deterministically", async () => {
    const { mapped, order } = bankMapped(DA_ROUND);
    completeMock.mockResolvedValue(
      completion(bankProposal(order, "Refused."), { stopReason: "refusal" }),
    );
    const result = await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DA_ROUND)!, mapped);
    if (!result.ok) throw new Error("expected ok");
    expect(result.failureCategory).toBe("refusal");
  });
});

describe("structured fallback logging", () => {
  it("logs evaluator, model, budget, stop reason, usage, and model-vs-fallback", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    completeMock.mockResolvedValue(
      completion(systemDesignProposal("Truncated."), { stopReason: "max_tokens", outputTokens: 3_200 }),
    );
    await scoreTechnicalCasePostCall(clickstreamRecord, clickstreamMapped());
    const entry = info.mock.calls.find((call) => call[0] === "[technical-scorer] model-call");
    expect(entry).toBeDefined();
    expect(entry![1]).toMatchObject({
      evaluatorType: "technical_system_design",
      caseId: CLICKSTREAM,
      model: MODEL_IDS.default,
      maxTokenBudget: TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS,
      stopReason: "max_tokens",
      inputTokens: 4_997,
      outputTokens: 3_200,
      result: "deterministic_fallback",
      failureCategory: "max_tokens",
    });
    info.mockRestore();
  });

  it("logs a successful model result too, so budgets are observable in production", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { mapped, order } = bankMapped(DA_ROUND);
    completeMock.mockResolvedValue(completion(bankProposal(order, "Clear and well reasoned answer.")));
    await scoreQuestionBankPostCall(getVoiceLlmCaseRecord(DA_ROUND)!, mapped);
    const entry = info.mock.calls.find((call) => call[0] === "[technical-scorer] model-call");
    expect(entry![1]).toMatchObject({
      evaluatorType: "technical_question_bank",
      maxTokenBudget: TECHNICAL_QUESTION_BANK_MAX_TOKENS,
      result: "model",
      failureCategory: null,
    });
    info.mockRestore();
  });
});
