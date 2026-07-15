import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Redis fake shared across constructed clients, honoring the `ex` TTL
// option so we can assert it. Hoisted so the vi.mock factory can close over it.
const { redisStore } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: unknown; ex?: number }>(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async set(key: string, value: unknown, opts?: { ex?: number }) {
      redisStore.set(key, { value, ex: opts?.ex });
      return "OK";
    }
    async get(key: string) {
      return redisStore.has(key) ? redisStore.get(key)!.value : null;
    }
    async del(key: string) {
      redisStore.delete(key);
    }
  },
}));

import {
  VOICE_SESSION_TTL_SECONDS,
  VoiceSessionMissingError,
  VoiceSessionStoreError,
  deleteSession,
  loadSession,
  saveSession,
  updateSession,
} from "@/lib/voice/session-store";
import type { BehaviouralVoiceSession } from "@/lib/voice/types";

function sampleRecord(): BehaviouralVoiceSession {
  const now = new Date(0).toISOString();
  return {
    module: "behavioural",
    session: {
      id: "s1",
      user_id: "u1",
      jd_id: null,
      questions_asked: [{ question_id: "q1", question: "Q1?" }],
      scores: {},
      feedback: null,
      created_at: now,
    },
    questions: [{ id: "q1", question: "Q1?", competency: "x", type: "t", dynamic: false }],
    questionIndex: 0,
    createdAt: now,
    updatedAt: now,
  };
}

describe("voice session store", () => {
  beforeEach(() => {
    redisStore.clear();
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  });

  it("saves and loads a record round-trip", async () => {
    const record = sampleRecord();
    await saveSession("abc", record);
    expect(await loadSession("abc")).toEqual(record);
  });

  it("applies the 45-minute TTL on save", async () => {
    await saveSession("abc", sampleRecord());
    expect(VOICE_SESSION_TTL_SECONDS).toBe(2700);
    expect(redisStore.get("voice-session:abc")?.ex).toBe(2700);
  });

  it("uses the voice-session:<id> key format", async () => {
    await saveSession("xyz", sampleRecord());
    expect(redisStore.has("voice-session:xyz")).toBe(true);
  });

  it("returns null for a missing session", async () => {
    expect(await loadSession("does-not-exist")).toBeNull();
  });

  it("updateSession mutates and persists, refreshing the TTL", async () => {
    await saveSession("abc", sampleRecord());
    const updated = (await updateSession("abc", (cur) => ({
      ...(cur as BehaviouralVoiceSession),
      questionIndex: 3,
    }))) as BehaviouralVoiceSession;
    expect(updated.questionIndex).toBe(3);
    const loaded = (await loadSession("abc")) as BehaviouralVoiceSession;
    expect(loaded.questionIndex).toBe(3);
    expect(redisStore.get("voice-session:abc")?.ex).toBe(2700);
  });

  it("updateSession throws a typed error when the session is missing", async () => {
    await expect(updateSession("ghost", (c) => c)).rejects.toBeInstanceOf(
      VoiceSessionMissingError,
    );
  });

  it("deleteSession removes the record", async () => {
    await saveSession("abc", sampleRecord());
    await deleteSession("abc");
    expect(await loadSession("abc")).toBeNull();
  });

  it("throws a typed error when Redis credentials are missing", async () => {
    delete process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
    delete process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;
    await expect(loadSession("abc")).rejects.toBeInstanceOf(VoiceSessionStoreError);
  });

  it("rejects an empty sessionId", async () => {
    await expect(saveSession("", sampleRecord())).rejects.toBeInstanceOf(
      VoiceSessionStoreError,
    );
  });
});
