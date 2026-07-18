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

export function isReadinessOnlyConfirmation(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  if (!normalized) return false;
  return [
    /^(?:(?:yes|yeah|yep|sure|okay|ok|absolutely) )?(?:(?:i(?:'m| am)|we(?:'re| are)) )?ready(?: now| to (?:begin|start|continue))?(?: please)?$/,
    /^(?:let'?s|lets|let us|we can|we should) (?:begin|start|continue)(?: now)?(?: please)?$/,
    /^(?:go ahead|please (?:begin|start)|begin|start)(?: now)?$/,
  ].some((pattern) => pattern.test(normalized));
}

export function readinessDisposition(text: string): ReadinessDisposition {
  const normalized = normalizeCandidateText(text);
  if (
    /\b(?:not ready|not yet|need (?:a|one) (?:minute|moment)|give me (?:a|one) (?:minute|moment)|wait|hold on)\b/.test(
      normalized,
    )
  ) {
    return "not-ready";
  }
  if (isReadinessOnlyConfirmation(text)) {
    return "ready";
  }
  return "not-ready";
}
