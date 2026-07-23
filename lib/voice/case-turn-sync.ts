export type CandidateRevisionRelation =
  | "same"
  | "new-superset"
  | "new-prefix"
  | "same-message-id"
  | "correction"
  | "none";

const CORRECTION_MARKER =
  /\b(?:no|actually|rather|i mean|let me correct|let me rephrase|scratch that|cut that|correction)\b/i;

export function normalizeCandidateText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sharedPrefixWords(left: string, right: string): number {
  const a = left.split(" ").filter(Boolean);
  const b = right.split(" ").filter(Boolean);
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

export function candidateRevisionRelation(
  previousText: string,
  nextText: string,
  previousMessageId: string | null = null,
  nextMessageId: string | null = null,
): CandidateRevisionRelation {
  const previous = normalizeCandidateText(previousText);
  const next = normalizeCandidateText(nextText);
  if (!previous || !next) return "none";
  if (previous === next) return "same";
  if (previousMessageId && nextMessageId && previousMessageId === nextMessageId) {
    return "same-message-id";
  }
  if (next.startsWith(`${previous} `)) return "new-superset";
  if (previous.startsWith(`${next} `)) return "new-prefix";

  const previousWords = previous.split(" ");
  const requiredPrefix = Math.min(5, Math.max(2, Math.ceil(previousWords.length * 0.35)));
  if (CORRECTION_MARKER.test(nextText) && sharedPrefixWords(previous, next) >= requiredPrefix) {
    return "correction";
  }
  return "none";
}

export function isCandidateRevision(relation: CandidateRevisionRelation): boolean {
  return relation === "same" || relation === "new-superset" || relation === "same-message-id" || relation === "correction";
}

export type ReadinessDisposition = "ready" | "not-ready";
export type ReadinessSignal = "affirmative" | "negative" | "mixed" | "unknown";

const READINESS_NEGATIVE_CUE =
  /\b(?:no|nope|not ready|not yet|need (?:a|one|another|some|a couple(?: of)?|couple(?: of)?|a few) (?:minutes?|moments?|seconds?)|give me (?:a|one|another|some|a couple(?: of)?|couple(?: of)?|a few) (?:minutes?|moments?|seconds?)|wait|hold on)\b/;
const READINESS_AFFIRMATIVE_CUE =
  /^(?:(?:uh+|um+|erm|well) )*(?:yes|yeah|yep|sure|absolutely|okay|ok)\b|\b(?:i(?:'m| am)|we(?:'re| are)) ready\b|^(?:let'?s|lets|let us|we can|we should) (?:begin|start)\b|^(?:go ahead|please (?:begin|start)|begin|start)\b/;
const READINESS_FILLER_PREFIX = /^(?:(?:uh+|um+|erm|well)\s*)+$/;

function affirmativeReadinessOnly(normalized: string): boolean {
  const withoutFillers = normalized.replace(/^(?:(?:uh+|um+|erm|well) )+/, "");
  return [
    /^(?:yes|yeah|yep|sure|okay|ok|absolutely)(?: (?:(?:i(?:'m| am)|we(?:'re| are)) )?ready(?: now| to (?:begin|start|continue))?)?(?: please)?$/,
    /^(?:yes|yeah|yep|sure|okay|ok|absolutely) i (?:am|'m)$/,
    /^(?:(?:i(?:'m| am)|we(?:'re| are)) )?ready(?: now| to (?:begin|start|continue))?(?: please)?$/,
    /^(?:let'?s|lets|let us|we can|we should) (?:begin|start|continue)(?: now)?(?: please)?$/,
    /^(?:go ahead|please (?:begin|start)|begin|start)(?: now)?$/,
  ].some((pattern) => pattern.test(withoutFillers));
}

export function readinessSignal(text: string): ReadinessSignal {
  const normalized = normalizeCandidateText(text);
  if (!normalized) return "unknown";
  const negative = READINESS_NEGATIVE_CUE.test(normalized);
  const affirmative = READINESS_AFFIRMATIVE_CUE.test(normalized) || affirmativeReadinessOnly(normalized);
  if (affirmative && negative) return "mixed";
  if (negative) return "negative";
  if (affirmativeReadinessOnly(normalized)) return "affirmative";
  return "unknown";
}

export function isPotentialReadinessPrefix(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  const signal = readinessSignal(text);
  return signal === "affirmative" || READINESS_FILLER_PREFIX.test(normalized);
}

export function isReadinessOnlyConfirmation(text: string): boolean {
  return readinessSignal(text) === "affirmative";
}

export function readinessDisposition(text: string): ReadinessDisposition {
  return readinessSignal(text) === "affirmative" ? "ready" : "not-ready";
}
