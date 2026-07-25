/**
 * Deterministic transcript -> question mapping for the native technical rounds.
 *
 * Mirrors the stage-anchor mapper (lib/voice/case-transcript.ts) but keys off
 * per-question spoken anchors instead of case stages. Mapping is fully
 * deterministic — no LLM is used to infer question boundaries:
 *
 *   1. Primary: exact, unique spoken question anchors. Each assistant turn is
 *      matched against the question anchors; a match advances the current question
 *      monotonically (an assistant response carries at most one anchor).
 *   2. Sequential fallback: the manifest `order` (the bank's default_order) fixes
 *      the sequence, so a missing/garbled anchor simply leaves that question
 *      unobserved and the walk continues in order — it never misassigns forward.
 *   3. Partial fallback: if no anchor is ever observed (or no substantive answer is
 *      captured), the result is flagged partial/unusable so the evaluator emits a
 *      safe partial report rather than dropping the whole report.
 *
 * Candidate speech can never advance the question pointer.
 */
import anchorSource from "@/context/vapi/technical-question-anchors-v1.json";
import {
  isSubstantiveCaseCandidateResponse,
  normalizeCaseStageAnchor,
} from "@/lib/voice/case-transcript";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

export type QuestionBankPartialReason =
  | "missing_anchor"
  | "missing_candidate_response"
  | "transcript_truncated"
  | "unusable_transcript";

export interface QuestionAnchorManifest {
  version: string;
  caseId: string;
  order: string[];
  anchors: Record<string, string>;
}

export interface QuestionTaggedTurn extends NormalizedVoiceTranscriptTurn {
  questionId: string;
  substantiveCandidateResponse: boolean;
}

export interface MappedQuestionBankTranscript {
  caseId: string;
  order: string[];
  turns: QuestionTaggedTurn[];
  observedQuestions: string[];
  answeredQuestions: string[];
  missingQuestions: string[];
  partialReasons: QuestionBankPartialReason[];
  partial: boolean;
}

export function questionAnchorManifest(
  caseId: string,
  version: string,
): QuestionAnchorManifest | null {
  const source = anchorSource as {
    version: string;
    cases: Record<string, { order?: string[]; anchors?: Record<string, string> }>;
  };
  if (source.version !== version) return null;
  const selected = source.cases[caseId];
  if (!selected || !Array.isArray(selected.order) || selected.order.length === 0) return null;
  const anchors: Record<string, string> = {};
  for (const id of selected.order) {
    const value = selected.anchors?.[id];
    if (typeof value !== "string" || !value.trim()) return null;
    anchors[id] = value.trim();
  }
  return { version: source.version, caseId, order: [...selected.order], anchors };
}

/** The single question id whose spoken anchor appears in this assistant turn, or null. */
function anchorQuestion(text: string, manifest: QuestionAnchorManifest): string | null {
  const spoken = normalizeCaseStageAnchor(text);
  for (const id of manifest.order) {
    const anchor = normalizeCaseStageAnchor(manifest.anchors[id]);
    // Token-bounded ordered phrase match, optionally surrounded by additional
    // assistant wording. Candidate speech is never inspected here.
    if (` ${spoken} `.includes(` ${anchor} `)) return id;
  }
  return null;
}

export function mapQuestionBankTranscript(
  caseId: string,
  version: string,
  transcript: readonly NormalizedVoiceTranscriptTurn[],
  options: { truncated?: boolean } = {},
): MappedQuestionBankTranscript | null {
  const manifest = questionAnchorManifest(caseId, version);
  if (!manifest) return null;

  const { order } = manifest;
  let currentIndex = -1;
  const observed = new Set<string>();
  const answered = new Set<string>();
  const turns: QuestionTaggedTurn[] = [];

  for (const turn of transcript) {
    if (turn.role === "assistant") {
      const found = anchorQuestion(turn.text, manifest);
      if (found) {
        const index = order.indexOf(found);
        if (index >= currentIndex) {
          currentIndex = index;
          observed.add(found);
        }
      }
    }
    if (currentIndex < 0) continue; // greeting / readiness, before question one
    const questionId = order[currentIndex];
    const substantiveCandidateResponse =
      turn.role === "candidate" && isSubstantiveCaseCandidateResponse(turn.text);
    turns.push({ ...turn, questionId, substantiveCandidateResponse });
    // A question is answered only by substantive candidate speech occurring after
    // that question's anchor.
    if (substantiveCandidateResponse && observed.has(questionId)) {
      answered.add(questionId);
    }
  }

  const observedQuestions = order.filter((id) => observed.has(id));
  const answeredQuestions = order.filter((id) => answered.has(id));
  const missingQuestions = order.filter((id) => !observed.has(id) || !answered.has(id));

  const partialReasons: QuestionBankPartialReason[] = [];
  if (order.some((id) => !observed.has(id))) partialReasons.push("missing_anchor");
  if (order.some((id) => observed.has(id) && !answered.has(id))) {
    partialReasons.push("missing_candidate_response");
  }
  if (options.truncated === true) partialReasons.push("transcript_truncated");
  if (observedQuestions.length === 0 || answeredQuestions.length === 0) {
    partialReasons.push("unusable_transcript");
  }

  return {
    caseId,
    order,
    turns,
    observedQuestions,
    answeredQuestions,
    missingQuestions,
    partialReasons,
    partial: partialReasons.length > 0,
  };
}
