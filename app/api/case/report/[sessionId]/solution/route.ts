import { NextRequest, NextResponse } from "next/server";
import { loadSession } from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { verifyReportCapability } from "@/lib/voice/report-capability";
import { candidateWorkedSolutionProjection } from "@/lib/voice/case-worked-solutions";

/**
 * Protected candidate-facing worked-solution endpoint.
 *
 * Authorization mirrors GET /api/case/report/[sessionId] exactly: the browser
 * must present the same one-time report capability, and the session must be a
 * native Case session that owns a matching token hash. The worked solution is
 * released ONLY after the report has reached status "done" (full or partial).
 * Every failure — unknown/expired session, wrong or missing token, non-native
 * session, not-done report, or an unmapped case — fails closed as 404, so the
 * endpoint never reveals which check failed and never leaks solution content.
 *
 * The response is a strict, separately authored candidate projection. It never
 * serializes the internal CaseRecord, rubrics, evaluator prompts, scoring
 * weights, notes, hidden metadata, or the transcript, and is sent no-store.
 */
const notFound = () =>
  new NextResponse(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

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

  // Only completed reports (full or partial) may reveal the worked solution.
  // Pending, processing, and failed reports are rejected.
  if (record.reportStatus !== "done") return notFound();

  const solution = candidateWorkedSolutionProjection(record.caseId);
  if (!solution) return notFound();

  return new NextResponse(JSON.stringify({ solution }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
