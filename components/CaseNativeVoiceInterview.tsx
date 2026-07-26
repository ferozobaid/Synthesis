"use client";

import { useEffect, useRef, useState } from "react";
import { MeterBar, SectionLabel } from "@/components/ui/primitives";
import { readinessBand, to100 } from "@/components/ui/verdict";
import type { CaseScore } from "@/lib/types";
import type { PublicCaseReportFailureCode } from "@/lib/voice/case-report-public";
// Type-only import: erased at build, so no worked-solution content is bundled.
import type {
  CaseWorkedSolutionView,
  WorkedSolutionCalculationSection,
  WorkedSolutionProseSection,
} from "@/lib/voice/case-worked-solution-types";
import { TECHNICAL_DIM_LABEL } from "@/lib/voice/case-technical-dimensions";
import { questionBankTitle } from "@/lib/voice/question-bank-catalog";
// Type-only: the projection is built server-side and arrives over the
// report-token-authorized status route. No mapper or transcript is bundled here.
import type { CandidateAnswerGroup } from "@/lib/voice/case-answer-projection";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import type {
  CasePostCallDimensionScore,
  CasePostCallScore,
  CaseReportStage,
  ReportStatus,
} from "@/lib/voice/types";

export const CASE_NATIVE_REPORT_PENDING_KEY = "synthesis.voice.case.native-report.v1";
export const CASE_NATIVE_REPORT_PENDING_TTL_MS = 115 * 60 * 1_000;

export interface PendingNativeCaseReport {
  sessionId: string;
  reportToken: string;
  caseId: string;
  caseTrack?: "strategy" | "technical";
  caseRole?: "data_engineering" | "data_analyst";
  caseTitle: string;
  assistantId: string;
  createdAt: number;
}

export interface NativeCaseReportProjection {
  status: ReportStatus;
  caseId: string;
  caseTrack?: "strategy" | "technical" | null;
  caseRole?: "data_engineering" | "data_analyst" | null;
  caseTitle: string | null;
  evaluatorType?: string;
  partial: boolean | null;
  observedStages: CaseReportStage[];
  missingStages: CaseReportStage[];
  score: CasePostCallScore | null;
  /** Candidate-safe answer review. Absent on legacy reports. */
  answers?: CandidateAnswerGroup[] | null;
  failureCode: PublicCaseReportFailureCode | null;
}

/** Consulting stage labels — the fallback when a case has no progress definition. */
const STAGE_LABEL: Record<CaseReportStage, string> = {
  clarification: "Clarification",
  framework: "Framework",
  analysis: "Analysis",
  data_reveal: "Data reveal",
  pressure_test: "Pressure test",
  recommendation: "Recommendation",
};

/**
 * Report stage labels come from the same evaluator-aware definition the live
 * tracker uses, so a technical case never shows consulting stage names in its
 * report either. Internal stage ids are unchanged.
 */
function stageLabeller(caseId: string): (stage: CaseReportStage) => string {
  const definition = nativeProgressDefinition(caseId);
  if (!definition || definition.kind === "question_bank") {
    return (stage) => STAGE_LABEL[stage];
  }
  const byId = new Map(definition.steps.map((step) => [step.id, step.label]));
  return (stage) => byId.get(stage) ?? STAGE_LABEL[stage];
}

const CONSULTING_DIMENSION_LABEL: Record<string, string> = {
  structure: "Structure",
  hypothesis_driven_thinking: "Hypothesis-driven thinking",
  quantitative_reasoning: "Quantitative reasoning",
  synthesis: "Synthesis",
  communication: "Communication",
};

/** Every dimension label this build knows about, keyed by dimension id. */
const DIMENSION_LABEL: Record<string, string> = {
  ...CONSULTING_DIMENSION_LABEL,
  ...TECHNICAL_DIM_LABEL,
};

/**
 * Falls back to the question-bank title (which itself humanizes any unknown id) so
 * technical_question_bank per-question rows render by their question title.
 */
function dimensionLabel(dimension: string): string {
  return DIMENSION_LABEL[dimension] ?? questionBankTitle(dimension);
}

const SECTION_LABELS = {
  consulting: {
    framework: "Framework feedback",
    recommendation: "Recommendation feedback",
    quantitative: "Quantitative reasoning feedback",
  },
  technical_system_design: {
    framework: "Pipeline design feedback",
    recommendation: "Operations & trade-off feedback",
    quantitative: "Scale & reliability feedback",
  },
  technical_question_bank: {
    framework: "Per-question feedback",
    recommendation: "Next steps",
    quantitative: "Overall feedback",
  },
} as const;

export type NativeCaseEvaluatorType = keyof typeof SECTION_LABELS;

export interface NativeCaseReportPresentation {
  label: "Case Report" | "Partial Report";
  caseTitle: string;
  partial: boolean;
  readinessUpdated: boolean;
  overall: number | null;
  summary: string;
  dimensions: CasePostCallDimensionScore[];
  observedStages: string[];
  missingStages: string[];
  strengths: string[];
  improvements: string[];
  frameworkFeedback: string[] | null;
  frameworkFeedbackLabel: string;
  quantitativeFeedback: string | null;
  quantitativeFeedbackLabel: string;
  recommendationFeedback: string[] | null;
  recommendationFeedbackLabel: string;
  nextPracticePriorities: string[];
  /** Per-step candidate answers, keyed by backend step id. Empty when unavailable. */
  answersByStepId: Record<string, CandidateAnswerGroup>;
  /** Ordered groups, used for the Clickstream per-stage review. */
  answerGroups: CandidateAnswerGroup[];
  /**
   * Where the answer review attaches. Question-bank rounds key answers by
   * question id — the same id as their per-question score rows — so the
   * disclosure sits inline on each row. The system-design case keys answers by
   * stage, which no dimension row matches, so it gets its own stage section.
   */
  answerReviewMode: "per_dimension" | "per_stage" | "none";
}

function resolveEvaluatorType(value: string | undefined): NativeCaseEvaluatorType {
  if (value === "technical_system_design") return "technical_system_design";
  if (value === "technical_question_bank") return "technical_question_bank";
  return "consulting";
}

export function nativeCaseReportPresentation(
  report: NativeCaseReportProjection,
): NativeCaseReportPresentation | null {
  if (report.status !== "done" || !report.score || report.partial === null) return null;
  const partial = report.partial;
  const sectionLabels = SECTION_LABELS[resolveEvaluatorType(report.evaluatorType)];
  // Legacy reports predate the answer projection and simply have none.
  const answerGroups = Array.isArray(report.answers) ? report.answers : [];
  const evaluatorType = resolveEvaluatorType(report.evaluatorType);
  const stageLabel = stageLabeller(report.caseId);
  return {
    answerGroups,
    answerReviewMode:
      answerGroups.length === 0
        ? "none"
        : evaluatorType === "technical_question_bank"
          ? "per_dimension"
          : evaluatorType === "technical_system_design"
            ? "per_stage"
            : "none",
    answersByStepId: Object.fromEntries(answerGroups.map((group) => [group.id, group])),
    label: partial ? "Partial Report" : "Case Report",
    caseTitle: report.caseTitle ?? "Case interview",
    partial,
    readinessUpdated:
      report.caseTrack !== "technical" &&
      !partial &&
      report.score.overall !== null,
    overall: partial ? null : report.score.overall,
    summary: report.score.summary,
    dimensions: partial
      ? report.score.dimension_scores.filter((dimension) => dimension.score !== null)
      : report.score.dimension_scores,
    observedStages: report.observedStages.map(stageLabel),
    missingStages: report.missingStages.map(stageLabel),
    strengths: report.score.strengths,
    improvements: report.score.improvements,
    frameworkFeedback: report.score.improved_framework_outline,
    frameworkFeedbackLabel: sectionLabels.framework,
    quantitativeFeedback: report.score.quantitative_assessment,
    quantitativeFeedbackLabel: sectionLabels.quantitative,
    recommendationFeedback: report.score.improved_recommendation_outline,
    recommendationFeedbackLabel: sectionLabels.recommendation,
    nextPracticePriorities: report.score.next_focus,
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function writePendingNativeCaseReport(
  value: PendingNativeCaseReport,
  target = storage(),
): void {
  try { target?.setItem(CASE_NATIVE_REPORT_PENDING_KEY, JSON.stringify(value)); } catch { /* best effort */ }
}

export function clearPendingNativeCaseReport(target = storage()): void {
  try { target?.removeItem(CASE_NATIVE_REPORT_PENDING_KEY); } catch { /* best effort */ }
}

export function readPendingNativeCaseReport(
  now = Date.now(),
  target = storage(),
): PendingNativeCaseReport | null {
  try {
    const raw = target?.getItem(CASE_NATIVE_REPORT_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingNativeCaseReport>;
    const valid =
      typeof value.sessionId === "string" && value.sessionId.length > 0 &&
      typeof value.reportToken === "string" && value.reportToken.length > 0 &&
      typeof value.caseId === "string" && value.caseId.length > 0 &&
      typeof value.caseTitle === "string" && value.caseTitle.length > 0 &&
      typeof value.assistantId === "string" && value.assistantId.length > 0 &&
      typeof value.createdAt === "number" && Number.isFinite(value.createdAt) &&
      now - value.createdAt < CASE_NATIVE_REPORT_PENDING_TTL_MS;
    if (!valid) {
      clearPendingNativeCaseReport(target);
      return null;
    }
    return value as PendingNativeCaseReport;
  } catch {
    clearPendingNativeCaseReport(target);
    return null;
  }
}

export async function fetchNativeCaseReport(
  pending: Pick<PendingNativeCaseReport, "sessionId" | "reportToken">,
  fetcher: typeof fetch = fetch,
): Promise<NativeCaseReportProjection> {
  const response = await fetcher(`/api/case/report/${encodeURIComponent(pending.sessionId)}`, {
    headers: { "x-report-token": pending.reportToken },
  });
  if (!response.ok) throw new Error("The Case report could not be recovered.");
  return response.json() as Promise<NativeCaseReportProjection>;
}

export function fullAuthoritativeCaseScore(
  report: NativeCaseReportProjection,
): CaseScore | null {
  if (report.status !== "done" || report.partial !== false || !report.score) return null;
  if (report.score.overall === null || report.score.dimension_scores.some((d) => d.score === null)) {
    return null;
  }
  return {
    overall: report.score.overall,
    dimension_scores: report.score.dimension_scores.map((item) => ({
      dimension: item.dimension,
      score: item.score as number,
      justification: item.justification,
    })),
    strengths: report.score.strengths,
    improvements: report.score.improvements,
    next_focus: report.score.next_focus,
  };
}

export function nativeCaseReportStatusMessage(
  report: NativeCaseReportProjection | null,
): string {
  if (!report || report.status === "pending" || report.status === "processing") {
    return "Generating your personalized case report…";
  }
  if (report.status === "failed") return "The Case report could not be produced.";
  return report.partial
    ? "A partial Case report is ready. It will not update readiness."
    : "Your authoritative Case report is ready.";
}

export function nativeCaseReportSupportingMessage(
  report: NativeCaseReportProjection | null,
): string | null {
  return !report || report.status === "pending" || report.status === "processing"
    ? "This usually takes a few moments."
    : null;
}

// --- Worked solution (secure, click-to-reveal) --------------------------------

export const WORKED_SOLUTION_BUTTON_ID = "case-worked-solution-toggle";
export const WORKED_SOLUTION_PANEL_ID = "case-worked-solution-panel";

export type WorkedSolutionPhase = "idle" | "loading" | "error" | "ready";

export interface WorkedSolutionState {
  open: boolean;
  phase: WorkedSolutionPhase;
  solution: CaseWorkedSolutionView | null;
}

export const INITIAL_WORKED_SOLUTION_STATE: WorkedSolutionState = {
  open: false,
  phase: "idle",
  solution: null,
};

/**
 * The control is offered only once a completed report is presentable (full or
 * partial). It never renders while a report is pending, processing, or failed,
 * so no request can be made before there is a done report to authorize against.
 */
export function caseWorkedSolutionControlVisible(
  report: NativeCaseReportProjection | null,
): boolean {
  return report ? nativeCaseReportPresentation(report) !== null : false;
}

/**
 * Fetch only once. After the solution is cached in state, reopening the panel
 * re-renders it without another network request; while a fetch is in flight we
 * do not start a second one. Guarantees exactly one request across open/close.
 */
export function shouldFetchWorkedSolution(state: WorkedSolutionState): boolean {
  return state.solution === null && state.phase !== "loading";
}

/**
 * Pure transition for a toggle click. Opening the first time requests a fetch;
 * closing never fetches; reopening a cached solution never refetches. This is the
 * single source of truth for both the component and its tests.
 */
export function toggleWorkedSolution(
  state: WorkedSolutionState,
): { next: WorkedSolutionState; fetch: boolean } {
  if (state.open) return { next: { ...state, open: false }, fetch: false };
  const fetch = shouldFetchWorkedSolution(state);
  return {
    next: { ...state, open: true, phase: fetch ? "loading" : state.phase },
    fetch,
  };
}

/** Accessible relationship between the toggle button and the disclosure panel. */
export function caseWorkedSolutionA11y(open: boolean) {
  return {
    button: {
      id: WORKED_SOLUTION_BUTTON_ID,
      "aria-expanded": open,
      "aria-controls": WORKED_SOLUTION_PANEL_ID,
    },
    panel: {
      id: WORKED_SOLUTION_PANEL_ID,
      role: "region" as const,
      "aria-labelledby": WORKED_SOLUTION_BUTTON_ID,
      hidden: !open,
    },
  };
}

/**
 * Fetch the protected worked solution with the retained report capability. This
 * hits the dedicated solution endpoint — never the report or catalog routes — so
 * it can never re-run scoring or report generation.
 */
export async function fetchCaseWorkedSolution(
  pending: Pick<PendingNativeCaseReport, "sessionId" | "reportToken">,
  fetcher: typeof fetch = fetch,
): Promise<CaseWorkedSolutionView> {
  const response = await fetcher(
    `/api/case/report/${encodeURIComponent(pending.sessionId)}/solution`,
    { headers: { "x-report-token": pending.reportToken } },
  );
  if (!response.ok) throw new Error("The worked solution could not be loaded.");
  const body = (await response.json()) as { solution: CaseWorkedSolutionView };
  return body.solution;
}

/** Polls the protected report capability after a native call ends or refreshes. */
export default function CaseNativeVoiceInterview({
  pending,
  onComplete,
  onReset,
}: {
  pending: PendingNativeCaseReport;
  onComplete?: (score: CaseScore) => void;
  onReset: () => void;
}) {
  const [report, setReport] = useState<NativeCaseReportProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const completed = useRef(false);

  useEffect(() => {
    writePendingNativeCaseReport(pending);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await fetchNativeCaseReport(pending);
        if (cancelled) return;
        setReport(next);
        setError(null);
        if (next.status === "done" || next.status === "failed") {
          const score = fullAuthoritativeCaseScore(next);
          clearPendingNativeCaseReport();
          if (score && !completed.current) {
            completed.current = true;
            onComplete?.(score);
          }
          return;
        }
      } catch {
        if (!cancelled) setError("Report recovery is retrying.");
      }
      if (!cancelled) timer = setTimeout(poll, 1_000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [onComplete, pending]);

  const presentation = report ? nativeCaseReportPresentation(report) : null;
  const supportingMessage = nativeCaseReportSupportingMessage(report);

  return (
    <div className="case-native-report-shell" style={{ marginTop: 18, maxWidth: 820, marginInline: "auto" }}>
      <div
        role="status"
        aria-live="polite"
        style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}
      >
        {supportingMessage && (
          <span
            aria-label="Report generation in progress"
            style={{
              width: 10,
              height: 10,
              marginTop: 5,
              flex: "0 0 auto",
              borderRadius: "50%",
              background: "var(--accent)",
              animation: "pulseDot 1.2s ease-in-out infinite",
            }}
          />
        )}
        <div>
          <p style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>
            {nativeCaseReportStatusMessage(report)}
          </p>
          {supportingMessage && (
            <p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 12 }}>
              {supportingMessage}
            </p>
          )}
        </div>
      </div>
      {error && <p role="status" style={{ color: "var(--gap)", fontSize: 12 }}>{error}</p>}
      {presentation && (
        <NativeCaseReportView presentation={presentation} />
      )}
      {caseWorkedSolutionControlVisible(report) && (
        <WorkedSolutionDisclosure pending={pending} />
      )}
      <button type="button" onClick={onReset} style={backButtonStyle}>Back to cases</button>
    </div>
  );
}

function NativeCaseReportView({
  presentation,
}: {
  presentation: NativeCaseReportPresentation;
}) {
  const score100 = presentation.overall === null ? null : to100(presentation.overall);
  const band = score100 === null ? null : readinessBand(score100);
  return (
    <div className="case-native-report" style={{ animation: "fadeUp .45s ease both", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <SectionLabel color={presentation.partial ? "var(--partial)" : "var(--accent)"}>
          {presentation.label}
        </SectionLabel>
        <h2 style={{ margin: 0, fontSize: 22, color: "var(--ink)" }}>{presentation.caseTitle}</h2>
      </div>

      <section style={cardStyle}>
        {score100 !== null && band ? (
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 34, fontWeight: 700, color: "var(--accent)" }}>
              {score100}<span style={{ fontSize: 14, color: "var(--ink-3)" }}>/100</span>
            </div>
            <div>
              <div style={{ fontWeight: 600, color: band.color }}>{band.label}</div>
              <p style={bodyStyle}>{presentation.summary}</p>
            </div>
          </div>
        ) : (
          <>
            <p style={{ ...bodyStyle, marginTop: 0 }}>{presentation.summary}</p>
            <p style={{ ...bodyStyle, color: "var(--partial)" }}>
              Readiness was not updated because the available interview evidence was incomplete.
            </p>
          </>
        )}
      </section>

      <section style={cardStyle}>
        <SectionLabel style={{ marginBottom: 14 }}>Observed performance</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {presentation.dimensions.map((dimension) => (
            <div key={dimension.dimension}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 190, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {dimensionLabel(dimension.dimension)}
                </span>
                {dimension.score !== null && (
                  <>
                    <MeterBar value={dimension.score} max={5} color="var(--accent)" height={7} />
                    <span style={{ width: 42, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {dimension.score}/5
                    </span>
                  </>
                )}
              </div>
              <p style={{ ...bodyStyle, fontSize: 12, margin: "5px 0 0" }}>{dimension.justification}</p>
              {/* Question-bank rounds key answers by question id, which is the
                  dimension id on these rows. Consulting/system-design dimensions
                  never match a step id, so nothing renders for them here. */}
              {presentation.answerReviewMode === "per_dimension" && (
                <AnswerDisclosure
                  group={presentation.answersByStepId[dimension.dimension]}
                  idPrefix={`dimension-${dimension.dimension}`}
                />
              )}
            </div>
          ))}
          {presentation.dimensions.length === 0 && (
            <p style={bodyStyle}>No dimension had enough observed evidence to score reliably.</p>
          )}
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
          <StageList title="Observed stages" values={presentation.observedStages} color="var(--success)" />
          <StageList title="Missing or unanswered stages" values={presentation.missingStages} color="var(--partial)" />
        </div>
      </section>

      {presentation.answerReviewMode === "per_stage" && (
        <section style={cardStyle}>
          <SectionLabel style={{ marginBottom: 14 }}>Your answers</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {presentation.answerGroups.map((group) => (
              <div key={group.id}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {group.label}
                </span>
                <AnswerDisclosure group={group} idPrefix={`stage-${group.id}`} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
        <FeedbackList title="Strengths" values={presentation.strengths} color="var(--success)" />
        <FeedbackList title="Improvements" values={presentation.improvements} color="var(--partial)" />
      </div>

      {(presentation.frameworkFeedback || presentation.recommendationFeedback) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
          {presentation.frameworkFeedback && (
            <FeedbackList title={presentation.frameworkFeedbackLabel} values={presentation.frameworkFeedback} color="var(--accent)" />
          )}
          {presentation.recommendationFeedback && (
            <FeedbackList title={presentation.recommendationFeedbackLabel} values={presentation.recommendationFeedback} color="var(--accent)" />
          )}
        </div>
      )}

      {presentation.quantitativeFeedback && (
        <section style={cardStyle}>
          <SectionLabel style={{ marginBottom: 9 }}>{presentation.quantitativeFeedbackLabel}</SectionLabel>
          <p style={{ ...bodyStyle, margin: 0 }}>{presentation.quantitativeFeedback}</p>
        </section>
      )}

      <FeedbackList
        title="Next-practice priorities"
        values={presentation.nextPracticePriorities}
        color="var(--accent)"
      />
    </div>
  );
}

/**
 * One reusable candidate-safe answer review, shared by the Clickstream per-stage
 * rows and the two rounds' per-question rows.
 *
 * It renders only what the report route projected: the candidate's own turns and
 * the spoken question for context. It holds local disclosure state only, needs no
 * Vapi connection, and re-renders identically after a refresh because the data
 * comes from the report-token-authorized status route.
 */
function AnswerDisclosure({
  group,
  idPrefix,
}: {
  group: CandidateAnswerGroup | undefined;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  if (!group) return null;
  const buttonId = `${idPrefix}-answer-toggle`;
  const panelId = `${idPrefix}-answer-panel`;
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        style={answerToggleStyle}
      >
        <span>Your answer</span>
        <span aria-hidden style={{ color: "var(--ink-3)", fontSize: 11 }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!open}
        style={{ marginTop: open ? 10 : 0 }}
      >
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.question && (
              <p style={{ ...bodyStyle, margin: 0, fontStyle: "italic", color: "var(--ink-3)" }}>
                {group.question}
              </p>
            )}
            {group.turns.length > 0 ? (
              group.turns.map((turn) => (
                <p
                  key={turn.ordinal}
                  style={{
                    ...bodyStyle,
                    margin: 0,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: "var(--surface-2)",
                  }}
                >
                  {turn.text}
                </p>
              ))
            ) : (
              <p style={{ ...bodyStyle, margin: 0, color: "var(--ink-4)" }}>
                No answer was captured for this part of the interview.
              </p>
            )}
            {group.truncated && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--ink-4)" }}>
                Shortened for display.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StageList({ title, values, color }: { title: string; values: string[]; color: string }) {
  return (
    <div>
      <SectionLabel color={color} style={{ marginBottom: 9 }}>{title}</SectionLabel>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {values.length > 0
          ? values.map((value) => (
              <span key={value} style={{ fontSize: 12, padding: "5px 9px", borderRadius: 999, background: "var(--surface-2)", color: "var(--ink-2)" }}>
                {value}
              </span>
            ))
          : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>None</span>}
      </div>
    </div>
  );
}

function FeedbackList({ title, values, color }: { title: string; values: string[]; color: string }) {
  return (
    <section style={cardStyle}>
      <SectionLabel color={color} style={{ marginBottom: 10 }}>{title}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {values.length > 0
          ? values.map((value, index) => (
              <div key={`${title}-${index}`} style={{ ...bodyStyle, display: "flex", gap: 8 }}>
                <span style={{ color }}>→</span><span>{value}</span>
              </div>
            ))
          : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>No reliable evidence available.</span>}
      </div>
    </section>
  );
}

/**
 * Collapsed, click-to-reveal worked solution. It holds only local disclosure
 * state: opening or closing it never touches the report projection, the score
 * passed to onComplete, or readiness, and it never re-polls the report. The
 * solution is fetched lazily on the first open and cached, so no request is made
 * on render and reopening never refetches.
 */
function WorkedSolutionDisclosure({
  pending,
}: {
  pending: Pick<PendingNativeCaseReport, "sessionId" | "reportToken">;
}) {
  const [state, setState] = useState<WorkedSolutionState>(INITIAL_WORKED_SOLUTION_STATE);
  const a11y = caseWorkedSolutionA11y(state.open);

  const onToggle = () => {
    setState((current) => {
      const { next, fetch } = toggleWorkedSolution(current);
      if (fetch) {
        void fetchCaseWorkedSolution(pending)
          .then((solution) =>
            setState((s) => ({ ...s, phase: "ready", solution })),
          )
          .catch(() =>
            setState((s) => ({ ...s, phase: s.solution ? "ready" : "error" })),
          );
      }
      return next;
    });
  };

  return (
    <section style={{ ...cardStyle, marginTop: 4 }}>
      <button
        type="button"
        onClick={onToggle}
        style={workedSolutionToggleStyle}
        {...a11y.button}
      >
        <span>{state.open ? "Hide worked solution" : "View worked solution"}</span>
        <span aria-hidden style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {state.open ? "▲" : "▼"}
        </span>
      </button>
      <p style={{ margin: "8px 0 0", color: "var(--ink-3)", fontSize: 12 }}>
        This is one strong approach, not the only valid answer.
      </p>
      <div {...a11y.panel} style={{ marginTop: state.open ? 14 : 0 }}>
        {state.open && state.phase === "loading" && (
          <p role="status" aria-live="polite" style={{ ...bodyStyle, margin: 0 }}>
            Loading the worked solution…
          </p>
        )}
        {state.open && state.phase === "error" && (
          <p role="status" aria-live="polite" style={{ margin: 0, color: "var(--gap)", fontSize: 12 }}>
            The worked solution could not be loaded. Your report is unaffected — try again.
          </p>
        )}
        {state.open && state.phase === "ready" && state.solution && (
          <WorkedSolutionContent solution={state.solution} />
        )}
      </div>
    </section>
  );
}

/**
 * Renders whichever sections the case authored. Consulting cases carry all five;
 * the technical experiences omit the calculation blocks and instead supply extra
 * prose and/or per-question answers.
 */
function WorkedSolutionContent({ solution }: { solution: CaseWorkedSolutionView }) {
  return (
    <div style={{ animation: "fadeUp .35s ease both", display: "flex", flexDirection: "column", gap: 16 }}>
      <WorkedSolutionProse section={solution.framework} />
      <WorkedSolutionProse section={solution.analysisApproach} />
      {solution.additionalSections?.map((section) => (
        <WorkedSolutionProse key={section.heading} section={section} />
      ))}
      {solution.calculations && <WorkedSolutionCalc section={solution.calculations} />}
      {solution.pressureTest && <WorkedSolutionCalc section={solution.pressureTest} />}
      {solution.questions?.map((question) => (
        <WorkedSolutionProse
          key={question.questionId}
          section={{ heading: question.title, points: question.points }}
        />
      ))}
      <WorkedSolutionProse section={solution.exampleRecommendation} />
    </div>
  );
}

function WorkedSolutionProse({
  section,
}: {
  section: WorkedSolutionProseSection;
}) {
  return (
    <div>
      <SectionLabel style={{ marginBottom: 9 }}>{section.heading}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {section.points.map((point, index) => (
          <div key={`${section.heading}-${index}`} style={{ ...bodyStyle, display: "flex", gap: 8 }}>
            <span style={{ color: "var(--accent)" }}>→</span>
            <span>{point}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkedSolutionCalc({
  section,
}: {
  section: WorkedSolutionCalculationSection;
}) {
  return (
    <div>
      <SectionLabel style={{ marginBottom: 9 }}>{section.heading}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {section.steps.map((step, index) => (
          <div
            key={`${section.heading}-${index}`}
            style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", minWidth: 200 }}>
              {step.label}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-2)" }}>
              {step.expression} = {step.result}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const workedSolutionToggleStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  gap: 12,
  border: "1px solid var(--line)",
  background: "var(--surface-2)",
  color: "var(--ink)",
  fontSize: 14,
  fontWeight: 600,
  padding: "11px 14px",
  borderRadius: 10,
  cursor: "pointer",
} as const;

const answerToggleStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--line)",
  background: "var(--surface-2)",
  color: "var(--ink-2)",
  fontSize: 12,
  fontWeight: 600,
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer",
} as const;

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: "18px 20px",
  boxShadow: "var(--shadow-sm)",
  marginBottom: 16,
} as const;

const bodyStyle = {
  color: "var(--ink-2)",
  fontSize: 13,
  lineHeight: 1.55,
} as const;

const backButtonStyle = {
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink-2)",
  padding: "10px 15px",
  borderRadius: 9,
  cursor: "pointer",
} as const;
