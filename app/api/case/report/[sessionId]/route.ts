import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { candidateSafeCasePostCallScore } from "@/lib/voice/case-post-call-scorer";
import { publicCaseReportFailureCode } from "@/lib/voice/case-report-public";
import { verifyReportCapability } from "@/lib/voice/report-capability";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

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
  const caseRecord = getVoiceLlmCaseRecord(record.caseId);
  const safe = report?.score && caseRecord
    ? candidateSafeCasePostCallScore(
        report.score,
        record.normalizedTranscript ?? [],
        caseRecord,
        {
          partial: report.partial,
          answeredStages: report.answeredStages ?? report.observedStages.filter(
            (stage) => !report.missingStages.includes(stage),
          ),
        },
      )
    : null;
  // Rebuild the browser projection field-by-field. Internal evidence, transcript,
  // anchors, partial-reason codes, and report-processing metadata never cross it.
  const score = safe
    ? {
        overall: safe.overall,
        dimension_scores: safe.dimension_scores.map((dimension) => ({
          dimension: dimension.dimension,
          score: dimension.score,
          justification: dimension.justification,
        })),
        summary: safe.summary,
        strengths: safe.strengths,
        improvements: safe.improvements,
        next_focus: safe.next_focus,
        improved_framework_outline: safe.improved_framework_outline,
        improved_recommendation_outline: safe.improved_recommendation_outline,
        quantitative_assessment: safe.quantitative_assessment,
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
    failureCode: record.reportStatus === "failed"
      ? publicCaseReportFailureCode(record.reportErrorCode)
      : null,
  });
}
