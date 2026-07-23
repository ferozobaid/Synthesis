"use client";

import { useEffect, useRef, useState } from "react";
import { MeterBar, SectionLabel } from "@/components/ui/primitives";
import { readinessBand, to100 } from "@/components/ui/verdict";
import type { CaseScore } from "@/lib/types";
import type { PublicCaseReportFailureCode } from "@/lib/voice/case-report-public";
import type {
  CasePostCallDimensionScore,
  CasePostCallScore,
  CaseReportDimension,
  CaseReportStage,
  ReportStatus,
} from "@/lib/voice/types";

export const CASE_NATIVE_REPORT_PENDING_KEY = "synthesis.voice.case.native-report.v1";
export const CASE_NATIVE_REPORT_PENDING_TTL_MS = 115 * 60 * 1_000;

export interface PendingNativeCaseReport {
  sessionId: string;
  reportToken: string;
  caseId: string;
  caseTitle: string;
  assistantId: string;
  createdAt: number;
}

export interface NativeCaseReportProjection {
  status: ReportStatus;
  caseId: string;
  caseTitle: string | null;
  partial: boolean | null;
  observedStages: CaseReportStage[];
  missingStages: CaseReportStage[];
  score: CasePostCallScore | null;
  failureCode: PublicCaseReportFailureCode | null;
}

const STAGE_LABEL: Record<CaseReportStage, string> = {
  clarification: "Clarification",
  framework: "Framework",
  analysis: "Analysis",
  data_reveal: "Data reveal",
  pressure_test: "Pressure test",
  recommendation: "Recommendation",
};

const DIMENSION_LABEL: Record<CaseReportDimension, string> = {
  structure: "Structure",
  hypothesis_driven_thinking: "Hypothesis-driven thinking",
  quantitative_reasoning: "Quantitative reasoning",
  synthesis: "Synthesis",
  communication: "Communication",
};

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
  quantitativeFeedback: string | null;
  recommendationFeedback: string[] | null;
  nextPracticePriorities: string[];
}

export function nativeCaseReportPresentation(
  report: NativeCaseReportProjection,
): NativeCaseReportPresentation | null {
  if (report.status !== "done" || !report.score || report.partial === null) return null;
  const partial = report.partial;
  return {
    label: partial ? "Partial Report" : "Case Report",
    caseTitle: report.caseTitle ?? "Case interview",
    partial,
    readinessUpdated: !partial && report.score.overall !== null,
    overall: partial ? null : report.score.overall,
    summary: report.score.summary,
    dimensions: partial
      ? report.score.dimension_scores.filter((dimension) => dimension.score !== null)
      : report.score.dimension_scores,
    observedStages: report.observedStages.map((stage) => STAGE_LABEL[stage]),
    missingStages: report.missingStages.map((stage) => STAGE_LABEL[stage]),
    strengths: report.score.strengths,
    improvements: report.score.improvements,
    frameworkFeedback: report.score.improved_framework_outline,
    quantitativeFeedback: report.score.quantitative_assessment,
    recommendationFeedback: report.score.improved_recommendation_outline,
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
  if (!report || report.status === "pending") {
    return "Waiting for Vapi’s authoritative end-of-call report.";
  }
  if (report.status === "processing") return "Your Case report is being processed.";
  if (report.status === "failed") return "The Case report could not be produced.";
  return report.partial
    ? "A partial Case report is ready. It will not update readiness."
    : "Your authoritative Case report is ready.";
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

  return (
    <div style={{ marginTop: 18, maxWidth: 820, marginInline: "auto" }}>
      <p role="status" aria-live="polite" style={{ color: "var(--ink-2)", fontSize: 14 }}>
        {nativeCaseReportStatusMessage(report)}
      </p>
      {error && <p role="status" style={{ color: "var(--gap)", fontSize: 12 }}>{error}</p>}
      {presentation && (
        <NativeCaseReportView presentation={presentation} />
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
    <div style={{ animation: "fadeUp .45s ease both", marginBottom: 18 }}>
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
                  {DIMENSION_LABEL[dimension.dimension]}
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
        <FeedbackList title="Strengths" values={presentation.strengths} color="var(--success)" />
        <FeedbackList title="Improvements" values={presentation.improvements} color="var(--partial)" />
      </div>

      {(presentation.frameworkFeedback || presentation.recommendationFeedback) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
          {presentation.frameworkFeedback && (
            <FeedbackList title="Framework feedback" values={presentation.frameworkFeedback} color="var(--accent)" />
          )}
          {presentation.recommendationFeedback && (
            <FeedbackList title="Recommendation feedback" values={presentation.recommendationFeedback} color="var(--accent)" />
          )}
        </div>
      )}

      {presentation.quantitativeFeedback && (
        <section style={cardStyle}>
          <SectionLabel style={{ marginBottom: 9 }}>Quantitative reasoning feedback</SectionLabel>
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
