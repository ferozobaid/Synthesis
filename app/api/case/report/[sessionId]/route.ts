import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { verifyReportCapability } from "@/lib/voice/report-capability";
import type { CaseReportDimension } from "@/lib/voice/types";

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

const DIMENSION_LABEL: Record<CaseReportDimension, string> = {
  structure: "Structure",
  hypothesis_driven_thinking: "Hypothesis-driven thinking",
  quantitative_reasoning: "Quantitative reasoning",
  synthesis: "Synthesis",
  communication: "Communication",
};

function candidateSafeJustification(
  dimension: CaseReportDimension,
  score: number | null,
): string {
  const label = DIMENSION_LABEL[dimension];
  if (score === null) return `${label} could not be scored from the observed interview stages.`;
  if (score >= 4) return `${label} was a demonstrated strength in the observed response.`;
  if (score >= 3) return `${label} was demonstrated, with room for greater consistency.`;
  return `${label} needs more deliberate development in future practice.`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const sessionId = ctx.params?.sessionId ?? "";
  const token = req.headers.get("x-report-token") ?? "";
  if (!sessionId || !token) return notFound();

  const record = await loadSession(sessionId).catch(() => null);
  if (
    !record ||
    record.module !== "case" ||
    storedCaseVoiceArchitecture(record) !== "vapi_native" ||
    !record.reportTokenHash ||
    !verifyReportCapability(token, record.reportTokenHash)
  ) {
    return notFound();
  }

  const report = record.reportStatus === "done" ? record.finalReport : null;
  // Persisted reports may retain internal evidence for auditability. The browser
  // projection is rebuilt field-by-field and never includes transcript excerpts.
  const safeDimensions = report?.score.dimension_scores.filter(
    (dimension) => Object.prototype.hasOwnProperty.call(DIMENSION_LABEL, dimension.dimension),
  ) ?? [];
  const score = report?.score
    ? {
        overall: report.score.overall,
        dimension_scores: safeDimensions.map((dimension) => ({
          dimension: dimension.dimension,
          score: dimension.score,
          justification: candidateSafeJustification(dimension.dimension, dimension.score),
        })),
        strengths: safeDimensions
          .filter((dimension) => dimension.score !== null && dimension.score >= 4)
          .slice(0, 3)
          .map((dimension) => `${DIMENSION_LABEL[dimension.dimension]} was a relative strength.`),
        improvements: safeDimensions
          .filter((dimension) => dimension.score === null || dimension.score < 3)
          .slice(0, 3)
          .map((dimension) => dimension.score === null
            ? `${DIMENSION_LABEL[dimension.dimension]} needs a complete observed stage before it can be assessed.`
            : `Build a more explicit ${DIMENSION_LABEL[dimension.dimension].toLowerCase()} approach.`),
        next_focus: safeDimensions
          .filter((dimension) => dimension.score === null || dimension.score < 3)
          .slice(0, 2)
          .map((dimension) => DIMENSION_LABEL[dimension.dimension]),
      }
    : null;
  return NextResponse.json({
    status: record.reportStatus ?? "pending",
    caseId: record.caseId,
    caseTitle: record.selectedCaseTitle ?? null,
    partial: report?.partial ?? null,
    observedStages: report?.observedStages ?? [],
    missingStages: report?.missingStages ?? [],
    score,
    failureCode: record.reportStatus === "failed" ? record.reportErrorCode ?? "report_failed" : null,
  });
}
