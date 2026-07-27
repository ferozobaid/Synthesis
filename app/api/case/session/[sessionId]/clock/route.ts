/**
 * Native Case interview clock.
 *
 * The native architecture has no server turn loop — Vapi owns the conversation —
 * so this is the only server touchpoint between session bootstrap and the
 * end-of-call report. The browser detects the true case opening by transcript
 * anchor and asks the server to start the clock; the SERVER remains authoritative.
 *
 * Start is first-write-wins: an already-started session returns its original
 * deadline unchanged, so refreshes, retries, duplicate anchors, a second tab, and
 * repeated POSTs can never restart or extend an interview.
 *
 * Custom-LLM sessions never use this route. Their clock starts inside the
 * readiness-confirmation transaction and is read from the projection endpoint they
 * already poll. Accordingly this route authenticates with the report capability,
 * which is the only capability a native session issues.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  acquireLock,
  loadSession,
  releaseLock,
  updateSession,
} from "@/lib/voice/session-store";
import { storedCaseVoiceArchitecture } from "@/lib/voice/case-native-config";
import { verifyReportCapability } from "@/lib/voice/report-capability";
import {
  caseClockProjection,
  hasCaseClockStarted,
  isCaseExpired,
  startedCaseClock,
} from "@/lib/voice/case-clock";
import type { CaseVoiceSession } from "@/lib/voice/types";

const LOCK_LEASE_SECONDS = 10;

/** Same opaque failure the report route uses: never reveal whether a session exists. */
const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/**
 * Authorize by capability: holding the bootstrap-issued report token IS the proof
 * of ownership, exactly as in app/api/case/report/[sessionId]/route.ts.
 */
async function authorize(
  req: NextRequest,
  sessionId: string,
): Promise<CaseVoiceSession | null> {
  const token = req.headers.get("x-report-token") ?? "";
  if (!sessionId || !token) return null;

  const record = await loadSession(sessionId).catch(() => null);
  if (
    !record ||
    record.module !== "case" ||
    storedCaseVoiceArchitecture(record) !== "vapi_native" ||
    !record.reportTokenHash ||
    !verifyReportCapability(token, record.reportTokenHash)
  ) {
    return null;
  }
  return record;
}

/** Read the clock. Legacy sessions with no timing fields return nulls, never an error. */
export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const record = await authorize(req, ctx.params?.sessionId ?? "");
  if (!record) return notFound();
  return NextResponse.json(caseClockProjection(record, Date.now()));
}

/**
 * Start the clock, idempotently.
 *
 * The lock serializes concurrent starts; the mutation is independently idempotent
 * (startedCaseClock keeps any existing start), so correctness does not depend on
 * holding the lock — a lapsed lease degrades to a redundant identical write rather
 * than a restarted deadline.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: { sessionId: string } },
) {
  const sessionId = ctx.params?.sessionId ?? "";
  const record = await authorize(req, sessionId);
  if (!record) return notFound();

  const now = Date.now();
  // Already started (or already expired): return the existing deadline untouched.
  // An expired case must never be restarted by a late client.
  if (hasCaseClockStarted(record) || isCaseExpired(record, now)) {
    return NextResponse.json(caseClockProjection(record, now));
  }

  const lockKey = `lock:case-clock:${sessionId}`;
  const lockToken = await acquireLock(lockKey, LOCK_LEASE_SECONDS);
  try {
    const updated = await updateSession(sessionId, (current) => {
      if (current.module !== "case") return current;
      return { ...current, ...startedCaseClock(current, new Date().toISOString()) };
    });
    const next = updated as CaseVoiceSession;
    return NextResponse.json(caseClockProjection(next, Date.now()));
  } catch {
    return notFound();
  } finally {
    if (lockToken) await releaseLock(lockKey, lockToken).catch(() => {});
  }
}
