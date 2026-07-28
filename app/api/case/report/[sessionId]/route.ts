import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { candidateSafeCasePostCallScore } from "@/lib/voice/case-post-call-scorer";
import { candidateSafeTechnicalCasePostCallScore } from "@/lib/voice/case-technical-post-call-scorer";
import { candidateSafeQuestionBankScore } from "@/lib/voice/case-question-bank-scorer";
import { publicCaseReportFailureCode } from "@/lib/voice/case-report-public";
import { candidateAnswerProjection } from "@/lib/voice/case-answer-projection";
import type { CasePostCallScore, CaseReportStage } from "@/lib/voice/types";
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

  const caseRecord = getVoiceLlmCaseRecord(record.caseId);
  const isQuestionBank = caseRecord?.evaluator_type === "technical_question_bank";
  const isTechnical = caseRecord?.evaluator_type === "technical_system_design";
  const evaluatorType = isQuestionBank
    ? "technical_question_bank"
    : isTechnical
      ? "technical_system_design"
      : "consulting";

  let safe: CasePostCallScore | null = null;
  let partial: boolean | null = null;
  let observedStages: CaseReportStage[] = [];
  let missingStages: CaseReportStage[] = [];

  if (isQuestionBank) {
    // Question-bank rounds carry no case stages; per-question detail lives in the
    // dimension_scores rows (one row per question). Stage arrays stay empty.
    const qbReport = record.reportStatus === "done" ? record.finalQuestionBankReport : null;
    partial = qbReport?.partial ?? null;
    safe = qbReport?.score && caseRecord
      ? candidateSafeQuestionBankScore(
          caseRecord,
          qbReport.score,
          record.normalizedTranscript ?? [],
          { partial: qbReport.partial, answeredQuestions: qbReport.answeredQuestions },
        )
      : null;
  } else {
    const report = record.reportStatus === "done" ? record.finalReport : null;
    partial = report?.partial ?? null;
    observedStages = report?.observedStages ?? [];
    missingStages = report?.missingStages ?? [];
    const candidateSafeScore = isTechnical
      ? candidateSafeTechnicalCasePostCallScore
      : candidateSafeCasePostCallScore;
    safe = report?.score && caseRecord
      ? candidateSafeScore(
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
  }
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
  // Candidate-safe answer review, re-derived from the persisted normalized
  // transcript with the same deterministic mappers the evaluators used. It needs
  // no active call, survives refresh, and is empty for legacy sessions that
  // stored no transcript. Bounded in lib/voice/case-answer-projection.ts.
  const answers = candidateAnswerProjection({
    caseId: record.caseId,
    evaluatorType,
    anchorVersion: record.stageAnchorVersion,
    transcript: record.normalizedTranscript,
  });

  return NextResponse.json({
    status: record.reportStatus ?? "pending",
    caseId: record.caseId,
    caseTrack: record.caseTrack ?? null,
    caseRole: record.caseRole ?? null,
    caseTitle: record.selectedCaseTitle ?? null,
    evaluatorType,
    partial,
    observedStages,
    missingStages,
    score,
    answers,
    // Opaque, stable identity for this completed attempt. Same value on every
    // poll, so the client can record the outcome exactly once. Never the raw
    // Vapi call id.
    outcomeId: record.outcomeId ?? null,
    failureCode: record.reportStatus === "failed"
      ? publicCaseReportFailureCode(record.reportErrorCode)
      : null,
  });
}
