import { describe, expect, it } from "vitest";
import {
  ANSWER_MAX_CHARS_PER_TURN,
  ANSWER_MAX_TOTAL_CHARS,
  ANSWER_MAX_TURNS_PER_GROUP,
  candidateAnswerProjection,
  caseStageAnswerProjection,
  questionBankAnswerProjection,
} from "@/lib/voice/case-answer-projection";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";
const STAGE_VERSION = "case-stage-anchors-v1";
const QUESTION_VERSION = "technical-question-anchors-v1";

/** Build a transcript that walks `stepCount` steps, answering each one. */
function transcriptFor(
  caseId: string,
  stepCount: number,
  answerFor: (index: number) => string[] = (i) => [`Answer for step ${i + 1}.`],
): NormalizedVoiceTranscriptTurn[] {
  const steps = nativeProgressDefinition(caseId)!.steps.slice(0, stepCount);
  const turns: NormalizedVoiceTranscriptTurn[] = [];
  let ordinal = 0;
  for (const [index, step] of steps.entries()) {
    turns.push({ role: "assistant", text: `${step.anchor} Please go ahead.`, ordinal: ordinal++ });
    for (const answer of answerFor(index)) {
      turns.push({ role: "candidate", text: answer, ordinal: ordinal++ });
    }
  }
  return turns;
}

describe("Clickstream stage answers", () => {
  it("projects one group per observed stage, in stage order, with technical labels", () => {
    const transcript = transcriptFor(CLICKSTREAM, 6);
    const groups = caseStageAnswerProjection(CLICKSTREAM, STAGE_VERSION, transcript);
    expect(groups).toHaveLength(6);
    expect(groups.map((g) => g.id)).toEqual([
      "clarification",
      "framework",
      "analysis",
      "data_reveal",
      "pressure_test",
      "recommendation",
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      "Clarification",
      "High-level design",
      "Ingestion & schema",
      "Scale & stream design",
      "Reliability & edge cases",
      "Final recommendation",
    ]);
  });

  it("shows the candidate's own turns and the spoken question for context", () => {
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 2),
    );
    expect(groups[0].turns.map((t) => t.text)).toEqual(["Answer for step 1."]);
    expect(groups[0].question).toContain("what would you like to clarify");
  });

  it("preserves turn ordering within a stage", () => {
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 1, () => ["First point.", "Second point.", "Third point."]),
    );
    expect(groups[0].turns.map((t) => t.text)).toEqual([
      "First point.",
      "Second point.",
      "Third point.",
    ]);
    const ordinals = groups[0].turns.map((t) => t.ordinal);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });
});

describe("question-bank answers", () => {
  it("Data Analyst projects one group per observed question with its title", () => {
    const groups = questionBankAnswerProjection(
      DA_ROUND,
      QUESTION_VERSION,
      transcriptFor(DA_ROUND, 5),
    );
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.label)).toEqual([
      "Monthly Revenue Query",
      "Conversion Rate Definition",
      "Weekly Sales Dashboard",
      "Regional Active-User Drop",
      "Checkout Experiment Result",
    ]);
    expect(groups[0].turns[0].text).toBe("Answer for step 1.");
  });

  it("Data Engineer group ids match the bank question ids used for scoring", () => {
    const groups = questionBankAnswerProjection(
      DE_ROUND,
      QUESTION_VERSION,
      transcriptFor(DE_ROUND, 5),
    );
    expect(groups.map((g) => g.id)).toEqual([
      "de_sales_dimensional_model",
      "de_multisource_pipeline",
      "de_revenue_drop_incident",
      "de_pipeline_runtime_regression",
      "de_schema_drift",
    ]);
  });
});

describe("complete and partial reports", () => {
  it("a partial round shows only the questions that were actually reached", () => {
    const groups = questionBankAnswerProjection(
      DA_ROUND,
      QUESTION_VERSION,
      transcriptFor(DA_ROUND, 2),
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.label)).toEqual([
      "Monthly Revenue Query",
      "Conversion Rate Definition",
    ]);
  });

  it("a partial case shows only observed stages", () => {
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 3),
    );
    expect(groups.map((g) => g.id)).toEqual(["clarification", "framework", "analysis"]);
  });

  it("an observed step with no candidate answer still renders with no turns", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    const transcript: NormalizedVoiceTranscriptTurn[] = [
      { role: "assistant", text: steps[0].anchor, ordinal: 0 },
      { role: "candidate", text: "First answer.", ordinal: 1 },
      { role: "assistant", text: steps[1].anchor, ordinal: 2 },
    ];
    const groups = questionBankAnswerProjection(DA_ROUND, QUESTION_VERSION, transcript);
    expect(groups).toHaveLength(2);
    expect(groups[1].turns).toEqual([]);
  });
});

describe("bounding", () => {
  it("caps turns per group and flags truncation", () => {
    const many = Array.from({ length: ANSWER_MAX_TURNS_PER_GROUP + 4 }, (_, i) => `Turn ${i}.`);
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 1, () => many),
    );
    expect(groups[0].turns).toHaveLength(ANSWER_MAX_TURNS_PER_GROUP);
    expect(groups[0].truncated).toBe(true);
  });

  it("caps characters per turn and flags truncation", () => {
    const long = "x".repeat(ANSWER_MAX_CHARS_PER_TURN + 500);
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 1, () => [long]),
    );
    const turn = groups[0].turns[0];
    expect(turn.text.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS_PER_TURN + 1);
    expect(turn.truncated).toBe(true);
    expect(groups[0].truncated).toBe(true);
  });

  it("caps the total projected transcript size across all groups", () => {
    const long = "y".repeat(ANSWER_MAX_CHARS_PER_TURN);
    const groups = caseStageAnswerProjection(
      CLICKSTREAM,
      STAGE_VERSION,
      transcriptFor(CLICKSTREAM, 6, () =>
        Array.from({ length: ANSWER_MAX_TURNS_PER_GROUP }, () => long),
      ),
    );
    const total = groups.reduce(
      (sum, group) => sum + group.turns.reduce((s, t) => s + t.text.length, 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(ANSWER_MAX_TOTAL_CHARS);
  });
});

describe("evaluator dispatch and legacy safety", () => {
  it("routes each technical evaluator to its own mapper", () => {
    expect(
      candidateAnswerProjection({
        caseId: CLICKSTREAM,
        evaluatorType: "technical_system_design",
        anchorVersion: STAGE_VERSION,
        transcript: transcriptFor(CLICKSTREAM, 2),
      }),
    ).toHaveLength(2);
    expect(
      candidateAnswerProjection({
        caseId: DA_ROUND,
        evaluatorType: "technical_question_bank",
        anchorVersion: QUESTION_VERSION,
        transcript: transcriptFor(DA_ROUND, 3),
      }),
    ).toHaveLength(3);
  });

  it("consulting cases project no answers (their report surface is unchanged)", () => {
    expect(
      candidateAnswerProjection({
        caseId: "airport_profitability",
        evaluatorType: "consulting",
        anchorVersion: STAGE_VERSION,
        transcript: transcriptFor("airport_profitability", 6),
      }),
    ).toEqual([]);
  });

  it("legacy reports with no stored transcript project safely to an empty list", () => {
    for (const transcript of [null, undefined, []]) {
      expect(
        candidateAnswerProjection({
          caseId: CLICKSTREAM,
          evaluatorType: "technical_system_design",
          anchorVersion: STAGE_VERSION,
          transcript,
        }),
      ).toEqual([]);
    }
  });

  it("a missing anchor version projects safely to an empty list", () => {
    expect(
      candidateAnswerProjection({
        caseId: CLICKSTREAM,
        evaluatorType: "technical_system_design",
        anchorVersion: null,
        transcript: transcriptFor(CLICKSTREAM, 2),
      }),
    ).toEqual([]);
  });
});

describe("private and system content exclusion", () => {
  it("never emits assistant speech other than the anchored spoken question", () => {
    const steps = nativeProgressDefinition(CLICKSTREAM)!.steps;
    const transcript: NormalizedVoiceTranscriptTurn[] = [
      { role: "assistant", text: steps[0].anchor, ordinal: 0 },
      { role: "candidate", text: "My clarification.", ordinal: 1 },
      // An unanchored assistant aside must never appear in the projection.
      { role: "assistant", text: "Private note: target elements not met.", ordinal: 2 },
      { role: "candidate", text: "More detail.", ordinal: 3 },
    ];
    const groups = caseStageAnswerProjection(CLICKSTREAM, STAGE_VERSION, transcript);
    const serialized = JSON.stringify(groups);
    expect(serialized.includes("Private note")).toBe(false);
    expect(serialized.includes("target elements")).toBe(false);
    expect(groups[0].turns.map((t) => t.text)).toEqual(["My clarification.", "More detail."]);
  });

  it("the projection module imports no scorer, bank JSON, or model SDK", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "lib/voice/case-answer-projection.ts"),
      "utf8",
    );
    expect(src.includes("@/lib/claude")).toBe(false);
    expect(src.includes("@/context/technical/")).toBe(false);
    expect(src.includes("case-question-bank-scorer")).toBe(false);
    expect(src.includes("case-technical-post-call-scorer")).toBe(false);
  });
});
