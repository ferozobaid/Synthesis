import { NextRequest, NextResponse } from "next/server";
import { authorizeVapi } from "@/lib/voice/vapi";
import {
  acquireLock,
  loadSession,
  releaseLock,
  saveSession,
} from "@/lib/voice/session-store";
import { scoreTranscript, type TranscriptMessage } from "@/lib/behavioural/transcript";
import { mockAnswerBank } from "@/lib/__mocks__/fixtures";
import type { BehaviouralVoiceSession } from "@/lib/voice/types";

// POST /api/vapi/behavioural/report — Vapi assistant-level `end-of-call-report`
// webhook. This is an INFORMATIONAL server event, so it returns a plain 200 JSON
// acknowledgement (never the tool-response vapiEnvelope shape). It maps the final
// transcript to the ordered questions, scores it with the existing engine, and
// stores ONLY the derived report on the session (never the raw transcript).
//
// Full-transcript scoring can be ~1 model call per question; allow headroom.
export const maxDuration = 300;

/** Lock lease + stale-processing threshold (a crashed worker is reclaimed after). */
const LOCK_LEASE_SECONDS = 150;
const STALE_PROCESSING_MS = 150_000;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Explicit, ordered allowlist of where the injected sessionId may appear. */
function resolveSessionId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(
    m?.artifact?.variableValues?.sessionId,
    m?.call?.artifact?.variableValues?.sessionId,
    m?.call?.assistantOverrides?.variableValues?.sessionId,
    m?.call?.assistantOverrides?.metadata?.sessionId,
    m?.assistantOverrides?.variableValues?.sessionId,
  );
}

/** Vapi call id — required so processing is idempotent per call. */
function resolveCallId(message: Record<string, unknown>): string | null {
  const m = message as any;
  return firstString(m?.call?.id, m?.artifact?.call?.id, m?.callId);
}

function resolveMessages(message: Record<string, unknown>): TranscriptMessage[] {
  const arr = (message as any)?.artifact?.messages;
  return Array.isArray(arr) ? (arr as TranscriptMessage[]) : [];
}

const ack = () => NextResponse.json({ ok: true }, { status: 200 });

export async function POST(req: NextRequest) {
  const unauthorized = authorizeVapi(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const message = (body as { message?: Record<string, unknown> } | null)?.message;

  // Only act on a genuine end-of-call-report; any other event is a safe no-op.
  if (!message || message.type !== "end-of-call-report") return ack();

  // Require BOTH a confirmed sessionId and callId; missing either → safe ack.
  const sessionId = resolveSessionId(message);
  const callId = resolveCallId(message);
  if (!sessionId || !callId) return ack();

  // Serialize concurrent duplicate deliveries of the same call.
  const lockKey = `lock:report:${sessionId}:${callId}`;
  const lockToken = await acquireLock(lockKey, LOCK_LEASE_SECONDS).catch(() => null);
  if (!lockToken) return ack();

  try {
    const record = await loadSession(sessionId);
    if (!record || record.module !== "behavioural") return ack();

    // Idempotency: DONE for this call is the only permanent short-circuit.
    if (record.reportStatus === "done" && record.processedCallId === callId) return ack();
    // A fresh in-flight worker owns it; a stale one (crash) is reclaimed below.
    if (record.reportStatus === "processing" && record.processingStartedAt) {
      const age = Date.now() - Date.parse(record.processingStartedAt);
      if (Number.isFinite(age) && age >= 0 && age < STALE_PROCESSING_MS) return ack();
    }

    // Persist the processing CLAIM (status + lease) before scoring. NOTE: we do
    // NOT persist or queue the transcript itself — the raw transcript is not stored
    // (PII minimisation). A crashed/timed-out attempt is only reprocessed if Vapi
    // redelivers the end-of-call-report (whose payload carries the transcript) to
    // the stale-lease reclaim above; the claim here is not a durability guarantee
    // for the transcript.
    const claimed: BehaviouralVoiceSession = {
      ...record,
      reportStatus: "processing",
      processingStartedAt: new Date().toISOString(),
      processedCallId: callId,
      updatedAt: new Date().toISOString(),
    };
    await saveSession(sessionId, claimed);

    try {
      const messages = resolveMessages(message);
      const { report } = await scoreTranscript(
        record.questions.map((q) => ({
          id: q.id,
          question: q.question,
          competency: q.competency,
          type: q.type,
          source: q.source,
          fallback_company: q.fallback_company,
        })),
        messages,
        mockAnswerBank(),
        { sessionId, userId: record.session.user_id },
      );
      const done: BehaviouralVoiceSession = {
        ...claimed,
        reportStatus: "done",
        report,
        reportError: null,
        updatedAt: new Date().toISOString(),
      };
      await saveSession(sessionId, done);
    } catch (e) {
      const failed: BehaviouralVoiceSession = {
        ...claimed,
        reportStatus: "failed",
        reportError: e instanceof Error ? e.message : "scoring_failed",
        updatedAt: new Date().toISOString(),
      };
      await saveSession(sessionId, failed);
    }

    return ack();
  } finally {
    await releaseLock(lockKey, lockToken).catch(() => {});
  }
}
