/**
 * Live "Current question" projection for the native technical experiences
 * (client-safe).
 *
 * The panel is a pure projection of two sources and nothing else:
 *
 *   1. safe static display content — the configured readiness line and the step
 *      labels from lib/voice/native-progress.ts;
 *   2. finalized ASSISTANT transcript text that the candidate already heard.
 *
 * Because the displayed body is verbatim spoken assistant speech, it cannot
 * contain a system message, prompt instruction, private interviewer guidance,
 * answer key, target element, rubric, reference solution, assistant id, webhook
 * metadata, or model reasoning — none of that is ever spoken, and none of it is
 * reachable from this module. Candidate speech is never displayed here.
 */
import {
  containsNormalizedPhrase,
  type NativeCaseLiveTranscriptLine,
} from "@/lib/voice/case-native-live";
import { normalizeCaseStageAnchor } from "@/lib/voice/case-transcript";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import { nativeReadinessMessage } from "@/lib/voice/native-case-brief";

/** Longest spoken question retained for display. */
export const CURRENT_QUESTION_MAX_CHARS = 1_200;

export type NativeCurrentQuestionKind = "readiness" | "question" | "probe";

export interface NativeCurrentQuestionState {
  kind: NativeCurrentQuestionKind;
  /** Progress step id the display belongs to, or null before question one. */
  stepId: string | null;
  /** Step label ("Clarification", "Monthly Revenue Query", …), or null. */
  title: string | null;
  /** The text shown to the candidate. */
  text: string;
}

export function initialNativeCurrentQuestion(caseId: string): NativeCurrentQuestionState {
  return {
    kind: "readiness",
    stepId: null,
    title: null,
    text: nativeReadinessMessage(caseId),
  };
}

/**
 * Utterances that are pure acknowledgement or pacing. These must never replace
 * or erase the active question.
 */
const ACKNOWLEDGEMENT_PATTERNS: readonly RegExp[] = [
  /^(?:thank you|thanks|thank you very much|thanks very much)(?: for that| for your answer)?$/,
  /^(?:take your time|no rush|whenever youre ready|thats okay|thats ok|thats fine|no problem)$/,
  /^(?:ok|okay|sure|got it|understood|great|perfect|excellent|right|good|noted|mm hmm|uh huh|i see)$/,
  /^(?:lets move on|moving on|next|alright|all right)$/,
  /^(?:that concludes|we are done|were done|goodbye|bye)\b.*$/,
  /^(?:one moment|just a moment|give me a second)$/,
];

/**
 * Wordings that make an assistant turn a real ask even without a question mark
 * (voice transcription frequently drops terminal punctuation).
 */
const SUBSTANTIVE_ASK_PATTERNS: readonly RegExp[] = [
  /\bwalk me through\b/,
  /\btell me\b/,
  /\bexplain\b/,
  /\bdescribe\b/,
  /\bhow would you\b/,
  /\bwhat would you\b/,
  /\bwhy would you\b/,
  /\bwhich would you\b/,
  /\bcan you\b/,
  /\bcould you\b/,
  /\bwhat exactly\b/,
  /\bstate\b/,
];

/** Minimum normalized length before an assistant turn can count as a probe. */
const MIN_PROBE_CHARS = 20;

/** True when the whole utterance is acknowledgement or pacing, nothing more. */
export function isAcknowledgementOnly(text: string): boolean {
  const normalized = normalizeCaseStageAnchor(text);
  if (!normalized) return true;
  return ACKNOWLEDGEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * True when an assistant turn carries a substantive follow-up ask. An
 * acknowledgement that also contains a real question ("Thank you. How would you
 * handle late events?") passes, because the ask is judged on the whole turn.
 */
export function isSubstantiveProbe(text: string): boolean {
  if (isAcknowledgementOnly(text)) return false;
  const normalized = normalizeCaseStageAnchor(text);
  if (normalized.length < MIN_PROBE_CHARS) return false;
  if (text.includes("?")) return true;
  return SUBSTANTIVE_ASK_PATTERNS.some((pattern) => pattern.test(normalized));
}

function bounded(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > CURRENT_QUESTION_MAX_CHARS
    ? `${collapsed.slice(0, CURRENT_QUESTION_MAX_CHARS).trimEnd()}…`
    : collapsed;
}

/**
 * Fold one finalized transcript line into the panel state.
 *
 * - a canonical step anchor replaces the panel with that complete spoken question;
 * - a substantive follow-up replaces the body but keeps the step attribution;
 * - anything else (acknowledgements, pacing, closing small talk, candidate
 *   speech) leaves the last substantive question in place.
 */
export function advanceNativeCurrentQuestion(
  current: NativeCurrentQuestionState,
  caseId: string,
  finalizedLine: NativeCaseLiveTranscriptLine,
): NativeCurrentQuestionState {
  if (finalizedLine.role !== "assistant") return current;
  const text = finalizedLine.text.trim();
  if (!text) return current;

  const definition = nativeProgressDefinition(caseId);
  if (!definition) return current;

  // Later steps win when one turn somehow carries more than one anchor, so the
  // panel can never regress to an earlier question.
  let matched: { id: string; label: string } | null = null;
  let matchedIndex = -1;
  for (let index = 0; index < definition.steps.length; index += 1) {
    const step = definition.steps[index];
    if (containsNormalizedPhrase(text, step.anchor) && index > matchedIndex) {
      matched = { id: step.id, label: step.label };
      matchedIndex = index;
    }
  }
  if (matched) {
    return { kind: "question", stepId: matched.id, title: matched.label, text: bounded(text) };
  }

  // Before the first anchor, only the readiness line is shown.
  if (current.kind === "readiness") return current;
  if (!isSubstantiveProbe(text)) return current;
  return { kind: "probe", stepId: current.stepId, title: current.title, text: bounded(text) };
}
