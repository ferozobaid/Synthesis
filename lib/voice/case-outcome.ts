/**
 * Stable identity for a completed case attempt.
 *
 * The browser needs a key it can use to tell "this is the same finished interview
 * I already recorded" from "this is a genuinely new attempt", across report
 * retries, duplicate Vapi webhook delivery, projection polling, refreshes, and
 * remounts. That key is derived from the session and the authoritative call —
 * both of which are bound once and never rebound — so it is stable for the life
 * of the attempt.
 *
 * Deliberately NOT part of the identity: `reportAttempt`, which increments on
 * every scoring retry and would mint a new identity for the same interview.
 *
 * The digest also keeps the raw Vapi call id out of the browser: the client
 * receives an opaque hex string it can only compare for equality.
 *
 * Server (live) plane only.
 */
import { createHash } from "node:crypto";

/**
 * Opaque, stable id for one completed attempt. Returns null when the call is not
 * yet bound, so a caller never invents an identity for an unfinished interview.
 */
export function caseOutcomeId(
  sessionId: string,
  authoritativeCallId: string | null | undefined,
): string | null {
  if (!sessionId || !authoritativeCallId) return null;
  return createHash("sha256").update(`${sessionId}:${authoritativeCallId}`).digest("hex");
}
