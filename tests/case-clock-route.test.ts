import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: unknown; ex?: number }>(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, { value, ex: opts?.ex });
      return "OK";
    }
    async get(key: string) {
      return redisStore.has(key) ? redisStore.get(key)!.value : null;
    }
    async del(key: string) {
      redisStore.delete(key);
    }
    async eval(_script: string, keys: string[], args: unknown[]) {
      const entry = redisStore.get(keys[0]);
      if (entry && entry.value === args[0]) {
        redisStore.delete(keys[0]);
        return 1;
      }
      return 0;
    }
  },
}));

import { GET as clockGET, POST as clockPOST } from "@/app/api/case/session/[sessionId]/clock/route";
import { hashReportToken } from "@/lib/voice/report-capability";
import { caseClockDeadline } from "@/lib/voice/case-clock";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SESSION_ID = "clock-session";
const TOKEN = "a".repeat(64);
const START = "2026-07-17T12:00:00.000Z";

function key(sessionId = SESSION_ID) {
  return `voice-session:${sessionId}`;
}

function stored(sessionId = SESSION_ID): CaseVoiceSession {
  return redisStore.get(key(sessionId))!.value as CaseVoiceSession;
}

function seed(patch: Partial<CaseVoiceSession> = {}, sessionId = SESSION_ID): void {
  redisStore.set(key(sessionId), {
    value: {
      module: "case",
      session: { fsm_state: "clarification", complete: false, exhibits_revealed: [] },
      caseId: "airport_profitability",
      caseTrack: "strategy",
      architecture: "vapi_native",
      reportTokenHash: hashReportToken(TOKEN),
      reportStatus: "pending",
      maxDurationSeconds: 900,
      caseStartedAt: null,
      caseExpiresAt: null,
      caseTimedOut: false,
      createdAt: START,
      updatedAt: START,
      ...patch,
    } as unknown as CaseVoiceSession,
  });
}

function req(token?: string): Request {
  return new Request("http://localhost/api/case/session/x/clock", {
    headers: token ? { "x-report-token": token } : {},
  });
}

const ctx = (sessionId = SESSION_ID) => ({ params: { sessionId } });

beforeEach(() => {
  redisStore.clear();
  vi.useRealTimers();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
});

describe("case clock endpoint", () => {
  describe("authorization", () => {
    it("rejects a missing, wrong, or absent-session token", async () => {
      seed();
      const missing = await clockGET(req() as never, ctx() as never);
      const wrong = await clockGET(req("b".repeat(64)) as never, ctx() as never);
      const absent = await clockGET(req(TOKEN) as never, ctx("nope") as never);
      expect([missing.status, wrong.status, absent.status]).toEqual([404, 404, 404]);
    });

    it("rejects an unauthorized start and leaves the clock unstarted", async () => {
      seed();
      const response = await clockPOST(req("b".repeat(64)) as never, ctx() as never);
      expect(response.status).toBe(404);
      expect(stored().caseStartedAt).toBeNull();
    });

    it("rejects a custom-LLM session, which owns its clock server-side", async () => {
      seed({ architecture: "custom_llm" });
      const response = await clockPOST(req(TOKEN) as never, ctx() as never);
      expect(response.status).toBe(404);
    });
  });

  describe("start", () => {
    it("does not start merely by reading the clock", async () => {
      seed();
      const body = await (await clockGET(req(TOKEN) as never, ctx() as never)).json();
      expect(body.caseStartedAt).toBeNull();
      expect(body.caseExpiresAt).toBeNull();
      expect(body.maxDurationSeconds).toBe(900);
      expect(body.timedOut).toBe(false);
      expect(typeof body.serverNow).toBe("string");
      expect(stored().caseStartedAt).toBeNull();
    });

    it("starts the clock and derives the deadline from the snapshotted duration", async () => {
      seed();
      const body = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      expect(body.caseStartedAt).not.toBeNull();
      expect(body.caseExpiresAt).toBe(caseClockDeadline(body.caseStartedAt, 900));
      expect(stored().caseStartedAt).toBe(body.caseStartedAt);
    });

    it("does not expire the native session when 10 of its 15 minutes have elapsed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      seed();
      const started = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      expect(started.caseExpiresAt).toBe("2026-07-17T12:15:00.000Z");

      vi.setSystemTime(Date.parse(START) + 10 * 60_000);
      const atTenMinutes = await (await clockGET(req(TOKEN) as never, ctx() as never)).json();
      expect(atTenMinutes.timedOut).toBe(false);

      vi.setSystemTime(Date.parse(START) + 15 * 60_000);
      const atFifteenMinutes = await (await clockGET(req(TOKEN) as never, ctx() as never)).json();
      expect(atFifteenMinutes.timedOut).toBe(true);
      vi.useRealTimers();
    });

    it("returns the ORIGINAL deadline on repeated starts", async () => {
      seed();
      const first = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      // Duplicate anchors, retries, a second tab, a remount.
      for (let i = 0; i < 4; i++) {
        const again = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
        expect(again.caseStartedAt).toBe(first.caseStartedAt);
        expect(again.caseExpiresAt).toBe(first.caseExpiresAt);
      }
      expect(stored().caseStartedAt).toBe(first.caseStartedAt);
    });

    it("restores the correct remaining time on a later read (refresh / remount)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      seed();
      const started = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      vi.setSystemTime(Date.parse(START) + 5 * 60_000);
      const restored = await (await clockGET(req(TOKEN) as never, ctx() as never)).json();
      expect(restored.caseStartedAt).toBe(started.caseStartedAt);
      expect(restored.caseExpiresAt).toBe(started.caseExpiresAt);
      expect(Date.parse(restored.caseExpiresAt) - Date.parse(restored.serverNow)).toBe(10 * 60_000);
      expect(restored.timedOut).toBe(false);
      vi.useRealTimers();
    });

    it("has no deadline when the session predates duration snapshotting", async () => {
      seed({ maxDurationSeconds: undefined });
      const body = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      expect(body.maxDurationSeconds).toBeNull();
      expect(body.caseExpiresAt).toBeNull();
      expect(body.timedOut).toBe(false);
    });

    it("loads a legacy session with no clock fields at all", async () => {
      seed({
        maxDurationSeconds: undefined,
        caseStartedAt: undefined,
        caseExpiresAt: undefined,
        caseTimedOut: undefined,
      });
      const response = await clockGET(req(TOKEN) as never, ctx() as never);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        maxDurationSeconds: null,
        caseStartedAt: null,
        caseExpiresAt: null,
        timedOut: false,
      });
    });
  });

  describe("expiry", () => {
    const expired = {
      caseStartedAt: "2020-01-01T00:00:00.000Z",
      caseExpiresAt: "2020-01-01T00:15:00.000Z",
    };

    it("reports expiry from server time alone, with no client involvement", async () => {
      seed(expired);
      const body = await (await clockGET(req(TOKEN) as never, ctx() as never)).json();
      expect(body.timedOut).toBe(true);
    });

    it("cannot be restarted by a late request", async () => {
      seed(expired);
      const body = await (await clockPOST(req(TOKEN) as never, ctx() as never)).json();
      expect(body.caseStartedAt).toBe(expired.caseStartedAt);
      expect(body.caseExpiresAt).toBe(expired.caseExpiresAt);
      expect(body.timedOut).toBe(true);
      expect(stored().caseStartedAt).toBe(expired.caseStartedAt);
    });

    it("cannot be extended by a session whose clock was cleared but deadline remains", async () => {
      seed(expired);
      await clockPOST(req(TOKEN) as never, ctx() as never);
      expect(stored().caseExpiresAt).toBe(expired.caseExpiresAt);
    });
  });
});
