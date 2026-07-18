import type { CaseState } from "@/lib/types";
import { isValidClarificationQuestion } from "@/lib/voice/case-conversation";
import {
  isReadinessOnlyConfirmation,
  normalizeCandidateText,
  readinessDisposition,
} from "@/lib/voice/case-turn-sync";

export type CaseCandidateIntent =
  | "readiness-confirmation"
  | "not-ready"
  | "thinking-pause-request"
  | "repeat-question-request"
  | "clarification-question"
  | "substantive-case-answer"
  | "self-correction-revision"
  | "off-topic-or-confused"
  | "end-interview";

export interface CaseIntentContext {
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  stage: CaseState;
}

const THINKING_REQUEST =
  /\b(?:gather(?:ing)? my thoughts?|collect(?:ing)? my thoughts?|(?:let me|i(?:'d| would) like to) think|think(?:ing)? (?:through|about) (?:this|that|it|the (?:question|problem)|my (?:answer|response))|(?:have|need|give me|take) (?:a|one|another|some) (?:moment|minute|second)|still (?:thinking|gathering)|bear with me|hold on)\b/;
const REPEAT_REQUEST = [
  /^(?:(?:can|could|would|will) you |please )?(?:repeat (?:that|the question|your question)|say that again|ask that again|restate (?:that|the question|your question)|rephrase (?:that|the question|your question))(?: please)?$/,
  /^i (?:didn'?t|did not) catch (?:that|the question|your question)$/,
  /^which question(?: do you mean)?$/,
];
const GENERIC_MEANING_REQUEST = /^what do you mean(?: by (?:that|the question))?$/;
const END_REQUEST =
  /^(?:please )?(?:end|stop|finish)(?: the| this)? (?:case|interview|call)(?: now)?$|^(?:i(?:'d| would) like to|can we|let'?s) (?:end|stop|finish)(?: the| this)? (?:case|interview|call)(?: now)?$/;
const CONFUSED_RESPONSE =
  /^(?:i(?: am|'m) confused|i don'?t understand|i do not understand|i have no idea|i don'?t know what to do|what are we doing)(?: here)?$/;
const CORRECTION_MARKER =
  /\b(?:actually|i mean|let me correct|let me rephrase|scratch that|cut that|correction)\b/;

export function classifyCaseCandidateIntent(
  text: string,
  context: CaseIntentContext,
): CaseCandidateIntent {
  const normalized = normalizeCandidateText(text);

  if (context.readinessStatus === "awaiting") {
    if (readinessDisposition(text) === "ready") return "readiness-confirmation";
    return "not-ready";
  }

  if (END_REQUEST.test(normalized)) return "end-interview";
  if (THINKING_REQUEST.test(normalized)) return "thinking-pause-request";
  if (REPEAT_REQUEST.some((pattern) => pattern.test(normalized)) || GENERIC_MEANING_REQUEST.test(normalized)) {
    return "repeat-question-request";
  }
  if (isReadinessOnlyConfirmation(text)) return "readiness-confirmation";
  if (readinessDisposition(text) === "not-ready" && /\b(?:not ready|not yet)\b/.test(normalized)) {
    return "thinking-pause-request";
  }
  if (context.stage === "clarification" && isValidClarificationQuestion(text)) {
    return "clarification-question";
  }
  if (CONFUSED_RESPONSE.test(normalized)) return "off-topic-or-confused";
  if (CORRECTION_MARKER.test(normalized)) return "self-correction-revision";
  return "substantive-case-answer";
}

export function caseIntentUsesEvaluator(intent: CaseCandidateIntent): boolean {
  return (
    intent === "clarification-question" ||
    intent === "substantive-case-answer" ||
    intent === "self-correction-revision"
  );
}
