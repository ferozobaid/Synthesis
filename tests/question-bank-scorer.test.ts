import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, completeWithMetadata: completeMock };
});

import { scoreQuestionBankPostCall } from "@/lib/voice/case-question-bank-scorer";
import {
  mapQuestionBankTranscript,
  questionAnchorManifest,
} from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import { getQuestionBank } from "@/lib/voice/question-bank";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

const CASE_ID = "data_analyst_technical_round";
const VERSION = CASE_VOICE_QUESTION_ANCHOR_VERSION;
const manifest = questionAnchorManifest(CASE_ID, VERSION)!;
const ORDER = manifest.order;
const caseRecord = getVoiceLlmCaseRecord(CASE_ID)!;
const bank = getQuestionBank("data_analyst");

const STRONG_Q1 =
  "First I filter valid orders and identify the order level input grain, then I join customers safely and calculate revenue and distinct customers by month and region, and finally I reconcile the totals with a duplicate check to validate the result carefully before publishing anything at all.";
const WEAK = "Count the order rows.";
const GENERIC =
  "I would look at the data carefully and reason through the main tradeoffs before deciding on a concrete approach that fits the business need here.";

let ordinal = 0;
function turn(role: "assistant" | "candidate", text: string): NormalizedVoiceTranscriptTurn {
  return { role, text, ordinal: ordinal++ };
}
function buildMapped(answers: Record<string, string | null>) {
  ordinal = 0;
  const transcript: NormalizedVoiceTranscriptTurn[] = [];
  for (const id of ORDER) {
    transcript.push(turn("assistant", `${manifest.anchors[id]} Please walk me through it.`));
    transcript.push(turn("candidate", answers[id] ?? "okay"));
  }
  return mapQuestionBankTranscript(CASE_ID, VERSION, transcript)!;
}
function completion(json: unknown) {
  return { text: JSON.stringify(json), stopReason: "end_turn", inputTokens: 10, outputTokens: 20 };
}

beforeEach(() => {
  completeMock.mockReset();
});
afterEach(() => {
  delete process.env.SYNTHESIS_USE_MOCKS;
});

describe("question-bank scorer — deterministic (mock mode)", () => {
  beforeEach(() => {
    process.env.SYNTHESIS_USE_MOCKS = "true";
  });

  it("ranks a strong answer above a weak answer and never calls the model", async () => {
    const mapped = buildMapped({
      [ORDER[0]]: STRONG_Q1,
      [ORDER[1]]: WEAK,
      [ORDER[2]]: GENERIC,
      [ORDER[3]]: GENERIC,
      [ORDER[4]]: GENERIC,
    });
    const result = await scoreQuestionBankPostCall(caseRecord, mapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("mock_mode");
    expect(completeMock).not.toHaveBeenCalled();
    const byId = new Map(result.report.score.dimension_scores.map((d) => [d.dimension, d.score]));
    expect(byId.get(ORDER[0])!).toBeGreaterThan(byId.get(ORDER[1])!);
    expect(result.report.score.dimension_scores).toHaveLength(5);
  });

  it("scores every question from its target elements independently of any probe", async () => {
    // A rich answer covering all target elements scores higher than a vague one,
    // even though probes never fire in this transcript.
    const covered = buildMapped({ [ORDER[0]]: STRONG_Q1, [ORDER[1]]: GENERIC, [ORDER[2]]: GENERIC, [ORDER[3]]: GENERIC, [ORDER[4]]: GENERIC });
    const vague = buildMapped({ [ORDER[0]]: "I am not really certain how to handle this one at all", [ORDER[1]]: GENERIC, [ORDER[2]]: GENERIC, [ORDER[3]]: GENERIC, [ORDER[4]]: GENERIC });
    const a = await scoreQuestionBankPostCall(caseRecord, covered);
    const b = await scoreQuestionBankPostCall(caseRecord, vague);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    const scoreOf = (r: typeof a, id: string) =>
      (r as Extract<typeof a, { ok: true }>).report.score.dimension_scores.find((d) => d.dimension === id)!.score!;
    expect(scoreOf(a, ORDER[0])).toBeGreaterThan(scoreOf(b, ORDER[0]));
  });

  it("computes an equally weighted overall when every question is answered", async () => {
    const mapped = buildMapped(Object.fromEntries(ORDER.map((id) => [id, GENERIC])));
    const result = await scoreQuestionBankPostCall(caseRecord, mapped);
    if (!result.ok) throw new Error("expected ok");
    const scores = result.report.score.dimension_scores.map((d) => d.score!);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(result.report.partial).toBe(false);
    expect(result.report.score.overall).toBeCloseTo(Math.round(mean * 10) / 10, 6);
  });

  it("produces a safe partial report (overall null, unanswered = null) rather than dropping", async () => {
    const mapped = buildMapped({ [ORDER[0]]: GENERIC, [ORDER[1]]: GENERIC, [ORDER[2]]: GENERIC, [ORDER[3]]: GENERIC, [ORDER[4]]: null });
    const result = await scoreQuestionBankPostCall(caseRecord, mapped);
    if (!result.ok) throw new Error("expected ok");
    expect(result.report.partial).toBe(true);
    expect(result.report.score.overall).toBeNull();
    const last = result.report.score.dimension_scores.find((d) => d.dimension === ORDER[4]);
    expect(last?.score).toBeNull();
  });

  it("returns a hard empty_transcript failure only when no question was answered", async () => {
    const mapped = buildMapped(Object.fromEntries(ORDER.map((id) => [id, "okay"])));
    const result = await scoreQuestionBankPostCall(caseRecord, mapped);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failureCode).toBe("empty_transcript");
  });
});

describe("question-bank scorer — model mode", () => {
  beforeEach(() => {
    process.env.SYNTHESIS_USE_MOCKS = "false";
  });

  const allAnswered = () => buildMapped(Object.fromEntries(ORDER.map((id) => [id, GENERIC])));

  it("uses model scores as-is for answered questions (accepts defensible alternatives)", async () => {
    const scores = [5, 4, 3, 2, 1];
    completeMock.mockResolvedValue(
      completion({
        questionScores: ORDER.map((id, i) => ({ questionId: id, score: scores[i], justification: "Clear and well reasoned answer." })),
      }),
    );
    const result = await scoreQuestionBankPostCall(caseRecord, allAnswered());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("model");
    expect(result.report.score.dimension_scores.map((d) => d.score)).toEqual(scores);
    expect(result.report.score.overall).toBeCloseTo(3, 6);
  });

  it("strips answer-key leakage from a model justification (keeps candidate-safe fallback)", async () => {
    const leaked = bank.questions[0].answer_key.strong_answer_outline[0];
    completeMock.mockResolvedValue(
      completion({
        questionScores: ORDER.map((id, i) => ({
          questionId: id,
          score: 4,
          justification: i === 0 ? leaked : "Clear and well reasoned answer.",
        })),
      }),
    );
    const result = await scoreQuestionBankPostCall(caseRecord, allAnswered());
    if (!result.ok) throw new Error("expected ok");
    const row = result.report.score.dimension_scores.find((d) => d.dimension === ORDER[0])!;
    expect(row.justification).not.toContain("requested date range and valid statuses");
    expect(row.justification).not.toBe(leaked);
  });

  it("falls back deterministically on malformed model JSON", async () => {
    completeMock.mockResolvedValue({ text: "not json at all", stopReason: "end_turn", inputTokens: 1, outputTokens: 1 });
    const result = await scoreQuestionBankPostCall(caseRecord, allAnswered());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("malformed_json");
    expect(result.report.score.dimension_scores).toHaveLength(5);
  });

  it("falls back deterministically on a schema-invalid proposal (wrong question count)", async () => {
    completeMock.mockResolvedValue(
      completion({ questionScores: [{ questionId: ORDER[0], score: 4, justification: "ok" }] }),
    );
    const result = await scoreQuestionBankPostCall(caseRecord, allAnswered());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.failureCategory).toBe("schema_validation_error");
  });

  it("falls back deterministically when the model call throws", async () => {
    completeMock.mockRejectedValue(new Error("boom"));
    const result = await scoreQuestionBankPostCall(caseRecord, allAnswered());
    if (!result.ok) throw new Error("expected ok");
    expect(result.scorerOutcome).toBe("deterministic_fallback");
    expect(result.report.score.dimension_scores).toHaveLength(5);
  });
});
