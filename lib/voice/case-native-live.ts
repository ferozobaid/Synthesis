import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  normalizeCaseStageAnchor,
} from "@/lib/voice/case-transcript";

const CURRENT_STAGE_ANCHOR_VERSION = "case-stage-anchors-v1";
const MAX_ASSISTANT_CONTEXT_CHARS = 24_000;

export const NATIVE_CASE_LIVE_STAGE_LABELS = [
  "Clarification",
  "Framework",
  "Analysis",
  "Market sizing",
  "Pressure test",
  "Recommendation",
] as const;

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

function containsNormalizedPhrase(text: string, phrase: string): boolean {
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
 */
export function advanceNativeCaseLiveProgress(
  current: NativeCaseLiveProgress,
  caseId: string,
  finalizedLine: NativeCaseLiveTranscriptLine,
  finalizedAt: number,
): NativeCaseLiveProgress {
  if (finalizedLine.role !== "assistant" || !finalizedLine.text.trim()) return current;
  const manifest = caseStageAnchorManifest(caseId, CURRENT_STAGE_ANCHOR_VERSION);
  if (!manifest) return current;

  const combined = `${current.finalizedAssistantText} ${finalizedLine.text}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(-MAX_ASSISTANT_CONTEXT_CHARS);
  let stageIndex = current.stageIndex;
  for (let index = 0; index < CASE_REPORT_STAGES.length; index += 1) {
    if (containsNormalizedPhrase(combined, manifest.anchors[CASE_REPORT_STAGES[index]])) {
      stageIndex = Math.max(stageIndex, index);
    }
  }
  const caseBegan =
    containsNormalizedPhrase(combined, manifest.openingAnchor) ||
    containsNormalizedPhrase(combined, manifest.anchors.clarification);
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
