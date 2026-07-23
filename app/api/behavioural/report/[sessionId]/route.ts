import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/voice/session-store";
import { verifyReportCapability } from "@/lib/voice/report-capability";

// GET /api/behavioural/report/[sessionId] — client status poll for the post-call
// report. Authorization is the bootstrap-issued report token (sent as the
// `x-report-token` header), compared as fixed-length SHA-256 digests. The
// `sessionId` in the path is a lookup key, NOT authorization. The body carries
// ONLY the report lifecycle — never the raw transcript, context, questions, or
// any token material.

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const sessionId = ctx.params?.sessionId ?? "";
  const token = req.headers.get("x-report-token") ?? "";
  if (!sessionId || !token) return notFound();

  const record = await loadSession(sessionId).catch(() => null);
  if (!record || record.module !== "behavioural" || !record.reportTokenHash) return notFound();
  if (!verifyReportCapability(token, record.reportTokenHash)) return notFound();

  const reportStatus = record.reportStatus ?? "pending";
  // Project to the candidate-facing report only. The stored BehaviouralSummary
  // embeds `session` (per-answer numeric scores); we never return that, the raw
  // transcript, the captured context, or any token material.
  const r = reportStatus === "done" ? record.report : null;
  // Partial calls (max-duration / early end) are scored over whatever completed;
  // expose total + unanswered so the report can mark the rest as not answered.
  const total = record.questions?.length ?? r?.answered ?? 0;
  const report = r
    ? {
        overall: r.overall,
        dimension_averages: r.dimension_averages,
        answered: r.answered,
        total,
        unanswered: Math.max(0, total - r.answered),
        feedback: r.feedback,
        qualitative: r.qualitative ?? null,
      }
    : null;

  return NextResponse.json({
    reportStatus,
    report,
    reportError: reportStatus === "failed" ? record.reportError ?? null : null,
  });
}
