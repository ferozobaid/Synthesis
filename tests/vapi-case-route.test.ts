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

import { POST as casePOST } from "@/app/api/case/route";
import { GET as projectionGET } from "@/app/api/case/voice/[sessionId]/route";
import { POST as legacyCaseVoicePOST } from "@/app/api/vapi/case/route";
import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "test-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };
const INTRO_ANSWER =
  "We're being asked one core question: would retraining most of Beautify's in-store consultants into virtual social-media advisors be profitable? Two things drive it: first, shoppers are moving online and consultants sit idle; second, the retraining investment must pay back within a reasonable horizon while protecting the brand and retail relationships.";

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function getReq(token?: string): Request {
  return new Request("http://localhost/api/case/voice/session", {
    headers: token ? { "x-case-voice-token": token } : {},
  });
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

async function bootstrap(): Promise<{
  sessionId: string;
  projectionToken: string;
  openingPrompt: string;
}> {
  const response = await sessionPOST(
    makeReq({ module: "case", caseId: "beautify" }) as never,
  );
  expect(response.status).toBe(200);
  return await response.json();
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "true";
  delete process.env.VAPI_AUTH_DEBUG;
});

describe("POST /api/vapi/session (Case bootstrap)", () => {
  it("starts Beautify and stores only the projection capability hash", async () => {
    const started = await bootstrap();
    const record = stored(started.sessionId);

    expect(started.projectionToken.length).toBeGreaterThan(20);
    expect(started.openingPrompt).toContain("Hello, I’ll be your case interviewer today.");
    expect(record.module).toBe("case");
    expect(record.caseId).toBe("beautify");
    expect(record.callId).toBeNull();
    expect(record.turnSeq).toBe(0);
    expect(record.session.fsm_state).toBe("clarification");
    expect(record.projectedTurns).toEqual([]);
    expect(record.projectionTokenHash).not.toBe(started.projectionToken);
  });

  it("rejects cases outside the Phase 1 scope", async () => {
    const response = await sessionPOST(
      makeReq({ module: "case", caseId: "diconsa" }) as never,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("unsupported_case");
  });
});

describe("legacy POST /api/vapi/case", () => {
  it("still requires Vapi authentication", async () => {
    const response = await legacyCaseVoicePOST(makeReq({}) as never);
    expect(response.status).toBe(401);
  });

  it("cannot advance a Case session under a stale submit_case_answer tool", async () => {
    const started = await bootstrap();
    const response = await legacyCaseVoicePOST(
      makeReq(
        {
          message: {
            type: "tool-calls",
            call: { id: "stale-call" },
            toolCallList: [
              {
                id: "stale-tool-call",
                name: "submit_case_answer",
                parameters: { sessionId: started.sessionId, answer: INTRO_ANSWER },
              },
            ],
          },
        },
        authHeader,
      ) as never,
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "legacy_case_tool_disabled" });
    expect(stored(started.sessionId).session.history).toEqual([]);
    expect(stored(started.sessionId).callId).toBeNull();
    expect(stored(started.sessionId).turnSeq).toBe(0);
  });
});

describe("GET /api/case/voice/[sessionId]", () => {
  it("requires the projection token and excludes server-only session fields", async () => {
    const started = await bootstrap();

    const wrong = await projectionGET(getReq("wrong") as never, {
      params: { sessionId: started.sessionId },
    });
    expect(wrong.status).toBe(404);

    const response = await projectionGET(getReq(started.projectionToken) as never, {
      params: { sessionId: started.sessionId },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stage).toBe("clarification");
    expect(body.turnSeq).toBe(0);
    expect(body.turns).toEqual([]);
    expect(body.openingText).toBe(started.openingPrompt);
    expect(body.projectionTokenHash).toBeUndefined();
    expect(body.processedModelRequests).toBeUndefined();
    expect(body.processedToolCalls).toBeUndefined();
    expect(body.evaluation).toBeUndefined();
  });
});

describe("manual /api/case regression", () => {
  it("keeps the existing manual Case API working", async () => {
    const started = await casePOST(
      makeReq({ action: "start", caseId: "beautify" }) as never,
    );
    expect(started.status).toBe(200);
    const startBody = await started.json();
    expect(startBody.stage).toBe("intro");

    const turn = await casePOST(
      makeReq({
        action: "respond",
        caseId: "beautify",
        session: startBody.session,
        answer: INTRO_ANSWER,
      }) as never,
    );
    expect(turn.status).toBe(200);
    const turnBody = await turn.json();
    expect(turnBody.stage).toBe("clarification");
    expect(turnBody.session.fsm_state).toBe("clarification");
  });
});
