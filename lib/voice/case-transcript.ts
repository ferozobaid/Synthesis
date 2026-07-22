import anchorSource from "@/context/vapi/case-stage-anchors-v1.json";
import type {
  CaseReportStage,
} from "@/lib/voice/types";
import type { NormalizedVoiceTranscriptTurn } from "@/lib/voice/transcript";

export const CASE_REPORT_STAGES: readonly CaseReportStage[] = [
  "clarification",
  "framework",
  "analysis",
  "data_reveal",
  "pressure_test",
  "recommendation",
] as const;

export interface CaseStageAnchorManifest {
  version: string;
  caseId: string;
  anchors: Record<CaseReportStage, string>;
}

export interface CaseStageTaggedTurn extends NormalizedVoiceTranscriptTurn {
  stage: CaseReportStage;
}

export interface MappedCaseTranscript {
  turns: CaseStageTaggedTurn[];
  observedStages: CaseReportStage[];
  missingStages: CaseReportStage[];
  partial: boolean;
}

function canonical(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function caseStageAnchorManifest(
  caseId: string,
  version: string,
): CaseStageAnchorManifest | null {
  const source = anchorSource as {
    version: string;
    cases: Record<string, Record<CaseReportStage, string>>;
  };
  if (source.version !== version) return null;
  const selected = source.cases[caseId];
  if (!selected) return null;
  const anchors = {} as Record<CaseReportStage, string>;
  for (const stage of CASE_REPORT_STAGES) {
    const value = selected?.[stage];
    if (typeof value !== "string" || !value.trim()) return null;
    anchors[stage] = value.trim();
  }
  return { version: source.version, caseId, anchors };
}

function anchorStage(
  text: string,
  manifest: CaseStageAnchorManifest,
): CaseReportStage | null {
  const spoken = canonical(text);
  for (const stage of CASE_REPORT_STAGES) {
    const anchor = canonical(manifest.anchors[stage]);
    // Exact canonical anchor, optionally preceded/followed by brief natural wording.
    // Candidate speech is never inspected by this function.
    if (spoken === anchor || spoken.includes(anchor)) return stage;
  }
  return null;
}

function isClosingSmallTalk(text: string): boolean {
  return /^(?:thank you|thanks|that concludes|we(?:'re| are) done|goodbye)\b/i.test(text.trim());
}

/**
 * Stage-map a provider transcript using assistant-authored canonical anchors only.
 * Candidate speech cannot advance or regress the state; unmatched probes and
 * acknowledgements stay in the last assistant-anchored stage.
 */
export function mapCaseTranscript(
  caseId: string,
  version: string,
  transcript: readonly NormalizedVoiceTranscriptTurn[],
  options: { truncated?: boolean } = {},
): MappedCaseTranscript | null {
  const manifest = caseStageAnchorManifest(caseId, version);
  if (!manifest) return null;

  let currentIndex = -1;
  const observed = new Set<CaseReportStage>();
  const answered = new Set<CaseReportStage>();
  const turns: CaseStageTaggedTurn[] = [];

  for (const turn of transcript) {
    if (turn.role === "assistant") {
      const found = anchorStage(turn.text, manifest);
      if (found) {
        const index = CASE_REPORT_STAGES.indexOf(found);
        if (index >= currentIndex) {
          currentIndex = index;
          observed.add(found);
        }
      } else if (currentIndex === CASE_REPORT_STAGES.length - 1 && isClosingSmallTalk(turn.text)) {
        continue;
      }
    }
    if (currentIndex < 0) continue; // readiness and greeting material
    const stage = CASE_REPORT_STAGES[currentIndex];
    turns.push({ ...turn, stage });
    // A stage is answered only by non-empty candidate speech occurring after
    // that stage's canonical assistant anchor. Pre-anchor candidate speech is
    // ignored above and can never satisfy a later stage.
    if (turn.role === "candidate" && turn.text.trim() && observed.has(stage)) {
      answered.add(stage);
    }
  }

  const observedStages = CASE_REPORT_STAGES.filter((stage) => observed.has(stage));
  const missingStages = CASE_REPORT_STAGES.filter((stage) => !observed.has(stage));
  return {
    turns,
    observedStages,
    missingStages,
    partial:
      options.truncated === true ||
      missingStages.length > 0 ||
      CASE_REPORT_STAGES.some((stage) => !answered.has(stage)),
  };
}
