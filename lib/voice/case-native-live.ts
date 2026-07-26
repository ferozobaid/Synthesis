import { normalizeCaseStageAnchor } from "@/lib/voice/case-transcript";
import {
  STRATEGY_STAGE_LABELS,
  nativeProgressDefinition,
} from "@/lib/voice/native-progress";

const MAX_ASSISTANT_CONTEXT_CHARS = 24_000;

/**
 * Consulting stage labels. Retained as the Airport/GCC Gym vocabulary and as the
 * stable export other modules and tests read; the authoritative per-case labels
 * now come from nativeProgressDefinition().
 */
export const NATIVE_CASE_LIVE_STAGE_LABELS = [...STRATEGY_STAGE_LABELS] as const;

export interface NativeCaseLiveTranscriptLine {
  role: "assistant" | "user";
  text: string;
}

export interface NativeCaseLiveProgress {
  stageIndex: number;
  startedAt: number | null;
  endedAt: number | null;
  finalizedAssistantText: string;
}

export function initialNativeCaseLiveProgress(): NativeCaseLiveProgress {
  return {
    stageIndex: -1,
    startedAt: null,
    endedAt: null,
    finalizedAssistantText: "",
  };
}

export function containsNormalizedPhrase(text: string, phrase: string): boolean {
  const normalizedText = normalizeCaseStageAnchor(text);
  const normalizedPhrase = normalizeCaseStageAnchor(phrase);
  return Boolean(
    normalizedText &&
    normalizedPhrase &&
    ` ${normalizedText} `.includes(` ${normalizedPhrase} `),
  );
}

/**
 * Advances live presentation from finalized assistant speech only. The reducer
 * is deliberately independent of the backend FSM and never inspects candidate
 * text for stage or timer authority.
 *
 * The step vocabulary comes from the case's progress definition, so consulting
 * stages, technical system-design stages, and question-bank questions all share
 * one reducer while keeping their own internal ids.
 */
export function advanceNativeCaseLiveProgress(
  current: NativeCaseLiveProgress,
  caseId: string,
  finalizedLine: NativeCaseLiveTranscriptLine,
  finalizedAt: number,
): NativeCaseLiveProgress {
  if (finalizedLine.role !== "assistant" || !finalizedLine.text.trim()) return current;
  const definition = nativeProgressDefinition(caseId);
  if (!definition) return current;

  const combined = `${current.finalizedAssistantText} ${finalizedLine.text}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(-MAX_ASSISTANT_CONTEXT_CHARS);
  let stageIndex = current.stageIndex;
  for (let index = 0; index < definition.steps.length; index += 1) {
    if (containsNormalizedPhrase(combined, definition.steps[index].anchor)) {
      stageIndex = Math.max(stageIndex, index);
    }
  }
  // A round with no separate opening line starts at its first spoken question.
  const caseBegan =
    (definition.openingAnchor !== null &&
      containsNormalizedPhrase(combined, definition.openingAnchor)) ||
    (definition.steps.length > 0 &&
      containsNormalizedPhrase(combined, definition.steps[0].anchor));
  return {
    stageIndex,
    startedAt: current.startedAt ?? (caseBegan ? finalizedAt : null),
    endedAt: current.endedAt,
    finalizedAssistantText: combined,
  };
}

export function endNativeCaseLiveProgress(
  current: NativeCaseLiveProgress,
  endedAt: number,
): NativeCaseLiveProgress {
  if (current.endedAt !== null) return current;
  return { ...current, endedAt };
}

export function nativeCaseLiveElapsedMilliseconds(
  progress: Pick<NativeCaseLiveProgress, "startedAt" | "endedAt">,
  now: number,
): number {
  if (progress.startedAt === null) return 0;
  return Math.max(0, (progress.endedAt ?? now) - progress.startedAt);
}
