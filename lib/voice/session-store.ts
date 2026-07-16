/**
 * Voice session store — Upstash Redis persistence for Vapi voice sessions.
 *
 * Vercel functions are ephemeral and horizontally scaled, so an in-memory Map
 * would neither survive cold starts nor be shared across instances. Session
 * state therefore lives in the external Upstash Redis store, keyed by id.
 *
 * Server (live) plane only. The Redis credentials are read from server-only
 * environment variables and are never exposed to client code.
 */
import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { VoiceSession } from "@/lib/voice/types";

/**
 * 2 hours. Comfortably outlasts a full voice interview plus post-call scoring and
 * client refresh-recovery, so the record cannot expire mid-flow. Refreshed
 * (sliding) on every write.
 */
export const VOICE_SESSION_TTL_SECONDS = 2 * 60 * 60;

const KEY_PREFIX = "voice-session:";

/** Base error for all store failures — lets routes distinguish store problems. */
export class VoiceSessionStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceSessionStoreError";
  }
}

/** Thrown by updateSession when the session no longer exists (e.g. TTL expiry). */
export class VoiceSessionMissingError extends VoiceSessionStoreError {
  constructor(sessionId: string) {
    super(`Voice session not found or expired: ${sessionId}`);
    this.name = "VoiceSessionMissingError";
  }
}

function keyFor(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new VoiceSessionStoreError("A non-empty sessionId is required.");
  }
  return `${KEY_PREFIX}${sessionId}`;
}

function assertValidRecord(record: VoiceSession): void {
  if (!record || (record.module !== "behavioural" && record.module !== "case")) {
    throw new VoiceSessionStoreError("Invalid voice session record: unknown or missing module.");
  }
}

/**
 * Build the Redis client from the exact, server-only Upstash env vars provided by
 * the Vercel integration. Explicit (not Redis.fromEnv()), no aliases, read/write
 * token. Constructed per call — the client is a thin fetch wrapper — so a missing
 * credential surfaces as a typed error rather than a module-load crash.
 */
function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new VoiceSessionStoreError(
      "Upstash Redis is not configured. Set UPSTASH_REDIS_REST_KV_REST_API_URL and " +
        "UPSTASH_REDIS_REST_KV_REST_API_TOKEN (server-only).",
    );
  }
  return new Redis({ url, token });
}

/** Persist (create or overwrite) a session with the 45-minute TTL. */
export async function saveSession(sessionId: string, record: VoiceSession): Promise<void> {
  const key = keyFor(sessionId);
  assertValidRecord(record);
  await getRedis().set(key, record, { ex: VOICE_SESSION_TTL_SECONDS });
}

/** Load a session, or null when it is absent/expired. */
export async function loadSession(sessionId: string): Promise<VoiceSession | null> {
  const key = keyFor(sessionId);
  const value = await getRedis().get<VoiceSession>(key);
  return value ?? null;
}

/**
 * Read-modify-write a session under the same id, refreshing the TTL. Throws
 * VoiceSessionMissingError when the session is gone so callers can 404 cleanly.
 */
export async function updateSession(
  sessionId: string,
  mutate: (current: VoiceSession) => VoiceSession,
): Promise<VoiceSession> {
  const current = await loadSession(sessionId);
  if (!current) throw new VoiceSessionMissingError(sessionId);
  const next = { ...mutate(current), updatedAt: new Date().toISOString() } as VoiceSession;
  await saveSession(sessionId, next);
  return next;
}

/** Remove a session (best-effort cleanup; TTL also reaps abandoned sessions). */
export async function deleteSession(sessionId: string): Promise<void> {
  const key = keyFor(sessionId);
  await getRedis().del(key);
}

/**
 * Atomic mutual-exclusion lock (Redis SET NX EX). Returns a unique owner token on
 * success, or null if another holder has the lock. Pass the token to releaseLock
 * so we only ever delete our OWN lock. Used to make end-of-call report processing
 * concurrency-safe against duplicate webhook deliveries.
 */
export async function acquireLock(key: string, leaseSeconds: number): Promise<string | null> {
  const token = randomBytes(16).toString("hex");
  const res = await getRedis().set(key, token, { nx: true, ex: leaseSeconds });
  return res === "OK" ? token : null;
}

/**
 * Atomic compare-and-delete: release the lock ONLY if we still own it. If our
 * lease expired and another worker re-acquired the key, this is a no-op — it must
 * never delete a lock a different worker now holds. Best-effort; the lease also
 * expires the key on its own.
 */
const RELEASE_IF_OWNER =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export async function releaseLock(key: string, token: string): Promise<void> {
  await getRedis().eval(RELEASE_IF_OWNER, [key], [token]);
}
