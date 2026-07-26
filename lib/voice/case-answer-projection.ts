/**
 * Candidate-safe "Your answer" projection for the native technical experiences.
 *
 * Built at read time from the already-persisted `normalizedTranscript` using the
 * SAME deterministic mappers the evaluators use (mapCaseTranscript /
 * mapQuestionBankTranscript), so the review a candidate sees is exactly the
 * evidence their report was scored against, and no new persisted field or
 * webhook write is introduced. Legacy sessions with no stored transcript simply
 * project to an empty list.
 *
 * Safety contract
 * ---------------
 * Only two kinds of text can leave this module:
 *   - CANDIDATE turns — the candidate's own speech;
 *   - the single ASSISTANT turn that carried a step's canonical anchor, shown as
 *     the spoken question for context.
 * Both were part of the live spoken call. System messages, system prompts,
 * private interviewer guidance, answer keys, target elements, rubrics, red
 * flags, reference solutions, model reasoning, provider payloads, raw webhook
 * metadata, token counts, assistant configuration, report fences, and secrets
 * are structurally unreachable: this module reads a normalized transcript and a
 * client-safe anchor manifest, and nothing else.
 *
 * Everything is bounded (turns per group, characters per turn, total characters)
 * so a long or adversarial call cannot inflate the report response.
 */
import { mapCaseTranscript } from "@/lib/voice/case-transcript";
import { mapQuestionBankTranscript } from "@/lib/voice/question-bank-transcript";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import { containsNormalizedPhrase } from "@/lib/voice/case-native-live";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

/** Bounds. Deliberately small — this is a review aid, not a full transcript. */
export const ANSWER_MAX_TURNS_PER_GROUP = 8;
export const ANSWER_MAX_CHARS_PER_TURN = 1_200;
export const ANSWER_MAX_QUESTION_CHARS = 1_200;
export const ANSWER_MAX_TOTAL_CHARS = 24_000;

export interface CandidateAnswerTurn {
  /** Position in the original transcript; preserves ordering across bounding. */
  ordinal: number;
  text: string;
  /** True when this turn's text was cut by a bound. */
  truncated: boolean;
}

export interface CandidateAnswerGroup {
  /** Backend step identity: CaseReportStage id or bank question id. */
  id: string;
  /** Candidate-facing step label. */
  label: string;
  /** The spoken question for context, when it was captured. */
  question: string | null;
  turns: CandidateAnswerTurn[];
  /** True when turns were dropped by a bound. */
  truncated: boolean;
}

function boundText(text: string, limit: number): { text: string; truncated: boolean } {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return { text: collapsed, truncated: false };
  return { text: `${collapsed.slice(0, limit).trimEnd()}…`, truncated: true };
}

/**
 * The assistant turn that introduced a step, located by its canonical anchor.
 * Only anchored assistant speech qualifies, so an unanchored aside can never be
 * promoted into the question slot.
 */
function spokenQuestion(
  transcript: readonly NormalizedVoiceTranscriptTurn[],
  anchor: string,
): string | null {
  for (const turn of transcript) {
    if (turn.role !== "assistant") continue;
    if (containsNormalizedPhrase(turn.text, anchor)) {
      return boundText(turn.text, ANSWER_MAX_QUESTION_CHARS).text;
    }
  }
  return null;
}

/**
 * Assemble bounded groups from an ordered list of (stepId, candidate turn) pairs.
 * `order` fixes group order; a step with no captured answer still appears (with
 * an empty `turns`) only if it was observed, which the callers decide.
 */
function assemble(
  definitionSteps: readonly { id: string; label: string; anchor: string }[],
  includedIds: readonly string[],
  turnsById: Map<string, NormalizedVoiceTranscriptTurn[]>,
  transcript: readonly NormalizedVoiceTranscriptTurn[],
): CandidateAnswerGroup[] {
  const groups: CandidateAnswerGroup[] = [];
  let totalChars = 0;
  const included = new Set(includedIds);

  for (const step of definitionSteps) {
    if (!included.has(step.id)) continue;
    const source = turnsById.get(step.id) ?? [];
    const capped = source.slice(0, ANSWER_MAX_TURNS_PER_GROUP);
    let truncated = capped.length < source.length;
    const turns: CandidateAnswerTurn[] = [];

    for (const turn of capped) {
      const remaining = ANSWER_MAX_TOTAL_CHARS - totalChars;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const limit = Math.min(ANSWER_MAX_CHARS_PER_TURN, remaining);
      const bounded = boundText(turn.text, limit);
      if (!bounded.text) continue;
      turns.push({ ordinal: turn.ordinal, text: bounded.text, truncated: bounded.truncated });
      totalChars += bounded.text.length;
      if (bounded.truncated) truncated = true;
    }

    groups.push({
      id: step.id,
      label: step.label,
      question: spokenQuestion(transcript, step.anchor),
      turns,
      truncated,
    });
  }
  return groups;
}

/**
 * Candidate answers grouped by case stage, for the stage-mapped technical case.
 * Only observed stages appear, so a partial report shows exactly what was
 * captured and nothing is invented for stages that never happened.
 */
export function caseStageAnswerProjection(
  caseId: string,
  anchorVersion: string,
  transcript: readonly NormalizedVoiceTranscriptTurn[],
): CandidateAnswerGroup[] {
  const definition = nativeProgressDefinition(caseId);
  if (!definition || transcript.length === 0) return [];
  const mapped = mapCaseTranscript(caseId, anchorVersion, transcript);
  if (!mapped) return [];

  const turnsById = new Map<string, NormalizedVoiceTranscriptTurn[]>();
  for (const turn of mapped.turns) {
    if (turn.role !== "candidate") continue;
    const bucket = turnsById.get(turn.stage) ?? [];
    bucket.push(turn);
    turnsById.set(turn.stage, bucket);
  }
  return assemble(definition.steps, mapped.observedStages, turnsById, transcript);
}

/**
 * Candidate answers grouped by bank question, for the two technical rounds.
 * Only observed questions appear.
 */
export function questionBankAnswerProjection(
  caseId: string,
  anchorVersion: string,
  transcript: readonly NormalizedVoiceTranscriptTurn[],
): CandidateAnswerGroup[] {
  const definition = nativeProgressDefinition(caseId);
  if (!definition || transcript.length === 0) return [];
  const mapped = mapQuestionBankTranscript(caseId, anchorVersion, transcript);
  if (!mapped) return [];

  const turnsById = new Map<string, NormalizedVoiceTranscriptTurn[]>();
  for (const turn of mapped.turns) {
    if (turn.role !== "candidate") continue;
    const bucket = turnsById.get(turn.questionId) ?? [];
    bucket.push(turn);
    turnsById.set(turn.questionId, bucket);
  }
  return assemble(definition.steps, mapped.observedQuestions, turnsById, transcript);
}

/**
 * Evaluator-aware entry point. `evaluatorType` comes from the CaseRecord, never
 * from a case id, matching the report route's existing dispatch.
 */
export function candidateAnswerProjection(input: {
  caseId: string;
  evaluatorType: string;
  anchorVersion: string | null | undefined;
  transcript: readonly NormalizedVoiceTranscriptTurn[] | null | undefined;
}): CandidateAnswerGroup[] {
  const { caseId, evaluatorType, anchorVersion, transcript } = input;
  if (!anchorVersion || !transcript || transcript.length === 0) return [];
  if (evaluatorType === "technical_question_bank") {
    return questionBankAnswerProjection(caseId, anchorVersion, transcript);
  }
  if (evaluatorType === "technical_system_design") {
    return caseStageAnswerProjection(caseId, anchorVersion, transcript);
  }
  // Consulting cases keep their existing report surface unchanged.
  return [];
}
