"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseScore } from "@/lib/types";
import type { CasePostCallScore, CaseReportStage, ReportStatus } from "@/lib/voice/types";

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
  failureCode: string | null;
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

  return (
    <div style={{ marginTop: 18 }}>
      <p role="status" aria-live="polite" style={{ color: "var(--ink-2)", fontSize: 14 }}>
        {nativeCaseReportStatusMessage(report)}
      </p>
      {error && <p role="status" style={{ color: "var(--gap)", fontSize: 12 }}>{error}</p>}
      <button type="button" onClick={onReset}>Back to cases</button>
    </div>
  );
}
