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
  openingAnchor: string;
  anchors: Record<CaseReportStage, string>;
}

export interface CaseStageTaggedTurn extends NormalizedVoiceTranscriptTurn {
  stage: CaseReportStage;
  substantiveCandidateResponse: boolean;
}

export type CaseTranscriptPartialReason =
  | "missing_anchor"
  | "missing_candidate_response"
  | "transcript_truncated"
  | "unusable_transcript";

export interface MappedCaseTranscript {
  turns: CaseStageTaggedTurn[];
  observedStages: CaseReportStage[];
  answeredStages: CaseReportStage[];
  missingStages: CaseReportStage[];
  partialReasons: CaseTranscriptPartialReason[];
  partial: boolean;
}

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

/**
 * Deterministic normalization shared by authored anchors and Vapi assistant
 * transcript text. It tolerates transcription punctuation and common spoken
 * number variants without introducing fuzzy or candidate-driven matching.
 */
export function normalizeCaseStageAnchor(text: string): string {
  const normalized = text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\u2018\u2019\u02bc']/g, "")
    .replace(/[\u201c\u201d\u00ab\u00bb"]/g, " ")
    .replace(/%/g, " percent ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized.split(" ").filter(Boolean);
  const canonical: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "per" && tokens[index + 1] === "cent") {
      canonical.push("percent");
      index += 1;
      continue;
    }
    if (token === "percentage") {
      canonical.push("percent");
      continue;
    }
    canonical.push(NUMBER_WORDS[token] ?? token);
  }
  return canonical.join(" ");
}

export function caseStageAnchorManifest(
  caseId: string,
  version: string,
): CaseStageAnchorManifest | null {
  const source = anchorSource as {
    version: string;
    cases: Record<string, Record<CaseReportStage, string> & { openingAnchor?: string }>;
  };
  if (source.version !== version) return null;
  const selected = source.cases[caseId];
  if (!selected) return null;
  const openingAnchor = selected.openingAnchor;
  if (typeof openingAnchor !== "string" || !openingAnchor.trim()) return null;
  const anchors = {} as Record<CaseReportStage, string>;
  for (const stage of CASE_REPORT_STAGES) {
    const value = selected?.[stage];
    if (typeof value !== "string" || !value.trim()) return null;
    anchors[stage] = value.trim();
  }
  return { version: source.version, caseId, openingAnchor: openingAnchor.trim(), anchors };
}

function anchorStage(
  text: string,
  manifest: CaseStageAnchorManifest,
): CaseReportStage | null {
  const spoken = normalizeCaseStageAnchor(text);
  for (const stage of CASE_REPORT_STAGES) {
    const anchor = normalizeCaseStageAnchor(manifest.anchors[stage]);
    // Token-bounded ordered phrase match, optionally surrounded by additional
    // assistant wording. Candidate speech is never inspected here.
    if (` ${spoken} `.includes(` ${anchor} `)) return stage;
  }
  return null;
}

function isClosingSmallTalk(text: string): boolean {
  return /^(?:thank you|thanks|that concludes|we(?:'re| are) done|goodbye)\b/i.test(text.trim());
}

const NON_ANSWER_PATTERNS: readonly RegExp[] = [
  /^(?:can|could|may) i (?:have|get|take) (?:a|1|another) (?:minute|moment)(?: please)?$/,
  /^(?:please )?(?:give me|let me have) (?:a|1|another) (?:minute|moment)$/,
  /^i (?:need|would like) (?:a|1|another) (?:minute|moment)$/,
  /^(?:1|just a) moment(?: please)?$/,
  /^(?:hold on|please wait|let me think|im thinking)$/,
  /^(?:im|i am) ready but (?:please )?(?:give me|i need) (?:a|1|another) (?:minute|moment)$/,
  /^(?:(?:yes|okay|ok) )?(?:im|i am) ready(?: to (?:begin|continue|start))?$/,
  /^(?:ready|yes im ready|yes i am ready)$/,
  /^(?:im|i am) done$/,
  /^(?:done|thats all|that is all|no more)$/,
  /^(?:thank you|thanks|thank you very much|thanks very much)$/,
  /^(?:ok|okay|got it|sure|yes|no)$/,
];

/** True only for candidate speech that contains assessable stage content. */
export function isSubstantiveCaseCandidateResponse(text: string): boolean {
  const normalized = normalizeCaseStageAnchor(text);
  if (!normalized) return false;
  return !NON_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
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
    const substantiveCandidateResponse =
      turn.role === "candidate" && isSubstantiveCaseCandidateResponse(turn.text);
    turns.push({ ...turn, stage, substantiveCandidateResponse });
    // A stage is answered only by non-empty candidate speech occurring after
    // that stage's canonical assistant anchor. Pre-anchor candidate speech is
    // ignored above and can never satisfy a later stage.
    if (substantiveCandidateResponse && observed.has(stage)) {
      answered.add(stage);
    }
  }

  const observedStages = CASE_REPORT_STAGES.filter((stage) => observed.has(stage));
  const answeredStages = CASE_REPORT_STAGES.filter((stage) => answered.has(stage));
  const missingAnchorStages = CASE_REPORT_STAGES.filter((stage) => !observed.has(stage));
  const missingCandidateStages = CASE_REPORT_STAGES.filter(
    (stage) => observed.has(stage) && !answered.has(stage),
  );
  const missingStages = CASE_REPORT_STAGES.filter(
    (stage) => !observed.has(stage) || !answered.has(stage),
  );
  const partialReasons: CaseTranscriptPartialReason[] = [];
  if (missingAnchorStages.length > 0) partialReasons.push("missing_anchor");
  if (missingCandidateStages.length > 0) partialReasons.push("missing_candidate_response");
  if (options.truncated === true) partialReasons.push("transcript_truncated");
  if (observedStages.length === 0 || answeredStages.length === 0) {
    partialReasons.push("unusable_transcript");
  }
  return {
    turns,
    observedStages,
    answeredStages,
    missingStages,
    partialReasons,
    partial: partialReasons.length > 0,
  };
}
