/**
 * Evaluator-aware native progress definitions (client-safe).
 *
 * One resolver decides what the live progress tracker shows for a native Vapi
 * case, keyed by case id and the evaluator kind it maps to. Components read a
 * definition; they never test case ids inline.
 *
 * Internal step ids are the UNCHANGED backend identities — the six
 * CaseReportStage ids for stage-mapped cases and the bank question ids for the
 * question-bank rounds — so transcript mapping, scoring, and report projection
 * are untouched. Only `label` is presentation.
 *
 * This module carries anchors and display labels only. Anchors are the sentences
 * the assistant speaks aloud to the candidate, so they are candidate-safe; no
 * scenario private guidance, target element, rubric, answer key, or red flag is
 * reachable from here.
 */
import { CASE_REPORT_STAGES, caseStageAnchorManifest } from "@/lib/voice/case-transcript";
import { questionAnchorManifest } from "@/lib/voice/question-bank-transcript";
import { QUESTION_BANK_CATALOG } from "@/lib/voice/question-bank-catalog";

const STAGE_ANCHOR_VERSION = "case-stage-anchors-v1";
const QUESTION_ANCHOR_VERSION = "technical-question-anchors-v1";

/**
 * Which progress vocabulary a case uses.
 *  - `strategy`         consulting stages (Airport, GCC Gym) — unchanged.
 *  - `case_stage`       technical system design mapped onto the same six stages.
 *  - `question_bank`    one step per fixed bank question.
 */
export type NativeProgressKind = "strategy" | "case_stage" | "question_bank";

export interface NativeProgressStep {
  /** Backend identity (CaseReportStage id or bank question id). Never renamed. */
  id: string;
  /** Candidate-facing label for this step. */
  label: string;
  /** Canonical spoken anchor that marks this step as reached. */
  anchor: string;
}

export interface NativeProgressDefinition {
  caseId: string;
  kind: NativeProgressKind;
  /** Heading for the live progress panel. */
  panelLabel: string;
  ariaLabel: string;
  /** Spoken opening line, when the case has one distinct from step one. */
  openingAnchor: string | null;
  steps: NativeProgressStep[];
}

/** Consulting stage labels — Airport and GCC Gym keep these exactly. */
export const STRATEGY_STAGE_LABELS: readonly string[] = [
  "Clarification",
  "Framework",
  "Analysis",
  "Market sizing",
  "Pressure test",
  "Recommendation",
] as const;

/** Technical system-design labels for the same six internal stage ids. */
export const CLICKSTREAM_STAGE_LABELS: readonly string[] = [
  "Clarification",
  "High-level design",
  "Ingestion & schema",
  "Scale & stream design",
  "Reliability & edge cases",
  "Final recommendation",
] as const;

/** Case ids whose six stages render with technical system-design labels. */
const CASE_STAGE_TECHNICAL_IDS: readonly string[] = ["data_engineer_clickstream"] as const;

function stageDefinition(caseId: string): NativeProgressDefinition | null {
  const manifest = caseStageAnchorManifest(caseId, STAGE_ANCHOR_VERSION);
  if (!manifest) return null;
  const technical = CASE_STAGE_TECHNICAL_IDS.includes(caseId);
  const labels = technical ? CLICKSTREAM_STAGE_LABELS : STRATEGY_STAGE_LABELS;
  return {
    caseId,
    kind: technical ? "case_stage" : "strategy",
    panelLabel: technical ? "Interview progress" : "Case progress",
    ariaLabel: technical ? "Live technical interview progress" : "Live case stage progress",
    openingAnchor: manifest.openingAnchor,
    steps: CASE_REPORT_STAGES.map((stage, index) => ({
      id: stage,
      label: labels[index],
      anchor: manifest.anchors[stage],
    })),
  };
}

function questionBankDefinition(caseId: string): NativeProgressDefinition | null {
  const entries = QUESTION_BANK_CATALOG[caseId];
  const manifest = questionAnchorManifest(caseId, QUESTION_ANCHOR_VERSION);
  if (!entries || !manifest) return null;
  const steps: NativeProgressStep[] = [];
  // Walk the manifest order (the bank's default_order) so display order can never
  // drift from the deterministic mapping order.
  for (const id of manifest.order) {
    const entry = entries.find((candidate) => candidate.id === id);
    const anchor = manifest.anchors[id];
    if (!entry || !anchor) return null;
    steps.push({ id, label: entry.title, anchor });
  }
  return {
    caseId,
    kind: "question_bank",
    panelLabel: "Interview progress",
    ariaLabel: "Live technical round progress",
    openingAnchor: null,
    steps,
  };
}

/**
 * The progress definition for a native case, or null when the case is not a
 * native Vapi experience (manual Case flow and Behavioural are unaffected).
 */
export function nativeProgressDefinition(caseId: string): NativeProgressDefinition | null {
  return questionBankDefinition(caseId) ?? stageDefinition(caseId);
}

/** True when a case renders one of the three technical native experiences. */
export function isTechnicalNativeCase(caseId: string): boolean {
  const definition = nativeProgressDefinition(caseId);
  return definition !== null && definition.kind !== "strategy";
}
