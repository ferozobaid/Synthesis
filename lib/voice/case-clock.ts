/**
 * The single authority on case interview timing.
 *
 * Design rule: **expiry is DERIVED, never trusted from a stored flag.**
 * `isCaseExpired` compares the persisted deadline against server time and nothing
 * else, so a session is expired the moment its deadline passes — whether or not a
 * browser countdown fired, whether or not the tab was open, and whether or not the
 * `caseTimedOut` observation was successfully written. `caseTimedOut` exists only
 * as an opportunistic record for observability; losing that write changes nothing.
 *
 * Pure and I/O-free so every server read path can share it. Live plane only.
 */
import type { CaseVoiceSession } from "@/lib/voice/types";

/** The clock fields a caller needs to reason about timing. */
export type CaseClockSession = Pick<
  CaseVoiceSession,
  "maxDurationSeconds" | "caseStartedAt" | "caseExpiresAt" | "caseTimedOut"
>;

/** Candidate-safe clock projection returned to the browser. */
export interface CaseClockProjection {
  maxDurationSeconds: number | null;
  caseStartedAt: string | null;
  caseExpiresAt: string | null;
  /** Server time at response, so the client can correct for browser clock skew. */
  serverNow: string;
  timedOut: boolean;
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Deadline for a start instant and duration, or null when either is missing. */
export function caseClockDeadline(
  startedAt: string | null | undefined,
  maxDurationSeconds: number | null | undefined,
): string | null {
  const started = parseIso(startedAt);
  if (started === null) return null;
  if (typeof maxDurationSeconds !== "number" || !Number.isFinite(maxDurationSeconds)) {
    return null;
  }
  if (maxDurationSeconds <= 0) return null;
  return new Date(started + maxDurationSeconds * 1_000).toISOString();
}

/** True once the case has begun (and therefore carries a deadline). */
export function hasCaseClockStarted(session: CaseClockSession): boolean {
  return parseIso(session.caseStartedAt) !== null && parseIso(session.caseExpiresAt) !== null;
}

/**
 * Authoritative expiry. A session with no deadline (legacy record, or a case that
 * has not begun) is never expired.
 */
export function isCaseExpired(session: CaseClockSession, nowMs: number): boolean {
  const expiresAt = parseIso(session.caseExpiresAt);
  if (expiresAt === null) return false;
  return nowMs >= expiresAt;
}

/** Milliseconds left before the deadline; null when there is no deadline. */
export function caseRemainingMilliseconds(
  session: CaseClockSession,
  nowMs: number,
): number | null {
  const expiresAt = parseIso(session.caseExpiresAt);
  if (expiresAt === null) return null;
  return Math.max(0, expiresAt - nowMs);
}

/**
 * The clock fields to merge when the case begins — idempotent by construction.
 * A session that already started keeps its original start and deadline, so
 * repeated readiness messages, duplicate anchors, retries, and concurrent
 * requests can never restart or extend an interview (first write wins).
 */
export function startedCaseClock(
  session: CaseClockSession,
  nowIso: string,
): Pick<CaseVoiceSession, "caseStartedAt" | "caseExpiresAt"> {
  if (hasCaseClockStarted(session)) {
    return {
      caseStartedAt: session.caseStartedAt ?? null,
      caseExpiresAt: session.caseExpiresAt ?? null,
    };
  }
  const caseStartedAt = nowIso;
  return {
    caseStartedAt,
    caseExpiresAt: caseClockDeadline(caseStartedAt, session.maxDurationSeconds),
  };
}

/** Candidate-safe clock projection, with expiry derived at response time. */
export function caseClockProjection(
  session: CaseClockSession,
  nowMs: number,
): CaseClockProjection {
  return {
    maxDurationSeconds: session.maxDurationSeconds ?? null,
    caseStartedAt: session.caseStartedAt ?? null,
    caseExpiresAt: session.caseExpiresAt ?? null,
    serverNow: new Date(nowMs).toISOString(),
    timedOut: isCaseExpired(session, nowMs),
  };
}
