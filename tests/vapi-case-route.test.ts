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
      const key = keys[0];
      const token = args[0];
      const entry = redisStore.get(key);
      if (entry && entry.value === token) {
        redisStore.delete(key);
        return 1;
      }
      return 0;
    }
  },
}));

import { POST as casePOST } from "@/app/api/case/route";
import { GET as projectionGET } from "@/app/api/case/voice/[sessionId]/route";
import { POST as caseVoicePOST } from "@/app/api/vapi/case/route";
import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "test-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };

const ANSWERS = {
  intro:
    "We're being asked one core question: would retraining most of Beautify's in-store consultants into virtual social-media advisors be profitable? Two things drive it — first, shoppers are moving online and consultants sit idle; second, the retraining investment must pay back within a reasonable horizon while protecting the brand and retail relationships.",
  clarification:
    "I'd ask three clarifying questions. First, over what time horizon must this be profitable? Second, which brands and markets are in scope for the virtual rollout? Third, who bears the retraining and IT cost, Beautify or the retail partners?",
  framework:
    "I'd structure this around five factors. First, the retailer response. Second, the competitor response. Third, our consultants' current capabilities. Fourth, the brand-image risk. Fifth, the underlying economics of retraining cost versus incremental revenue. My hypothesis is the economics will dominate, so I'd size them first.",
  analysis:
    "I'd start from what the customer values in store and ask how virtual can match it. First, real-time tailored feedback through a selfie-mirror app with virtual try-on. Second, an online community led by a trusted advisor. Third, learning trends from that advisor. Fourth, private, responsive handling of specific concerns. My hypothesis is that personalization and trust are the switching triggers, so the virtual experience must replicate the relationship.",
  data_reveal:
    "Payback is upfront investment over annual profit. Incremental revenue is €130M, minus €10M annual costs is €120M, minus €2.5M IT depreciation is €117.5M. So €150M divided by €117.5M is about 1.28 years. The competitor data shows virtual try-on lifts conversion and cuts returns, so I'd prioritize that capability.",
  pressure_test:
    "I don't dismiss the risk — therefore I'd size it and mitigate it. My hypothesis is that the upside outweighs the cannibalization risk if we phase carefully. I'd pilot in two markets to measure cannibalization before scaling, share economics with retail partners through a revenue-share, and set brand-content guidelines. The payback math and the try-on conversion data suggest the value is real, so the risk is manageable.",
  recommendation:
    "My recommendation is to proceed with a phased rollout. The payback is about 1.28 years, and the exhibit shows virtual try-on drives conversion while reducing returns. I'd prioritize a Lena-like try-on capability, pilot in two markets, and share economics with retail partners.",
};

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

function toolBody(sessionId: string, answer: string, toolCallId: string, callId = "vapi-call-1") {
  return {
    message: {
      type: "tool-calls",
      call: { id: callId },
      toolCallList: [
        {
          id: toolCallId,
          name: "submit_case_answer",
          parameters: { sessionId, answer },
        },
      ],
    },
  };
}

async function bootstrap(): Promise<{ sessionId: string; projectionToken: string }> {
  const res = await sessionPOST(makeReq({ module: "case", caseId: "beautify" }) as never);
  expect(res.status).toBe(200);
  const data = await res.json();
  return { sessionId: data.sessionId, projectionToken: data.projectionToken };
}

async function postTurn(sessionId: string, answer: string, toolCallId: string, callId = "vapi-call-1") {
  const res = await caseVoicePOST(makeReq(toolBody(sessionId, answer, toolCallId, callId), authHeader) as never);
  expect(res.status).toBe(200);
  const envelope = await res.json();
  return JSON.parse(envelope.results[0].result);
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

async function runToFinal(sessionId: string) {
  const answers = [
    ANSWERS.intro,
    ANSWERS.clarification,
    ANSWERS.framework,
    ANSWERS.analysis,
    ANSWERS.data_reveal,
    ANSWERS.data_reveal,
    ANSWERS.data_reveal,
    ANSWERS.pressure_test,
    ANSWERS.recommendation,
  ];
  let last = null;
  for (let i = 0; i < answers.length; i++) {
    last = await postTurn(sessionId, answers[i], `tc-final-${i}`);
  }
  return last;
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "true";
  delete process.env.VAPI_AUTH_DEBUG;
});

describe("POST /api/vapi/session (case bootstrap)", () => {
  it("starts a Beautify voice case and stores a protected projection capability", async () => {
    const { sessionId, projectionToken } = await bootstrap();
    expect(typeof sessionId).toBe("string");
    expect(typeof projectionToken).toBe("string");
    expect(projectionToken.length).toBeGreaterThan(20);

    const rec = stored(sessionId);
    expect(rec.module).toBe("case");
    expect(rec.caseId).toBe("beautify");
    expect(rec.callId).toBeNull();
    expect(rec.turnSeq).toBe(0);
    expect(rec.projectionTokenHash).not.toBe(projectionToken);
  });

  it("keeps Case voice scoped to Beautify for Phase 1", async () => {
    const res = await sessionPOST(makeReq({ module: "case", caseId: "diconsa" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_case");
  });
});

describe("POST /api/vapi/case", () => {
  it("processes a valid turn, binds callId, and advances to clarification", async () => {
    const { sessionId } = await bootstrap();
    const result = await postTurn(sessionId, ANSWERS.intro, "tc-1");

    expect(result.spokenText).toContain("Before you build an approach");
    expect(result.stage).toBe("clarification");
    expect(result.action).toBe("advance");
    expect(result.turnSeq).toBe(1);
    expect(result.evaluation).toBeUndefined();
    expect(result.context).toBeUndefined();

    const rec = stored(sessionId);
    expect(rec.callId).toBe("vapi-call-1");
    expect(rec.turnSeq).toBe(1);
    expect(rec.session.history).toHaveLength(2);
  });

  it("handles the clarification stage through the backend FSM", async () => {
    const { sessionId } = await bootstrap();
    await postTurn(sessionId, ANSWERS.intro, "tc-1");
    const result = await postTurn(sessionId, ANSWERS.clarification, "tc-2");

    expect(result.stage).toBe("framework");
    expect(result.action).toBe("advance");
    expect(result.spokenText).toContain("What factors should Beautify consider");
  });

  it("returns cached duplicate tool-call results without advancing twice", async () => {
    const { sessionId } = await bootstrap();
    const body = toolBody(sessionId, ANSWERS.intro, "tc-dup");
    const first = await caseVoicePOST(makeReq(body, authHeader) as never);
    const second = await caseVoicePOST(makeReq(body, authHeader) as never);

    const firstResult = JSON.parse((await first.json()).results[0].result);
    const secondResult = JSON.parse((await second.json()).results[0].result);
    expect(firstResult.stage).toBe("clarification");
    expect(secondResult.stage).toBe("clarification");
    expect(secondResult.duplicate).toBe(true);
    expect(secondResult.turnSeq).toBe(1);
    expect(stored(sessionId).session.history).toHaveLength(2);
  });

  it("does not advance when another delivery owns the session lock", async () => {
    const { sessionId } = await bootstrap();
    redisStore.set(`lock:case:${sessionId}`, { value: "other-owner", ex: 60 });

    const result = await postTurn(sessionId, ANSWERS.intro, "tc-locked");

    expect(result.error).toBe("turn_in_progress");
    expect(result.spokenText).toBe("One moment while I process your last answer.");
    expect(stored(sessionId).session.history).toHaveLength(0);
    expect(stored(sessionId).callId).toBeNull();
  });

  it("reveals Beautify exhibits exactly once and in authored order", async () => {
    const { sessionId } = await bootstrap();
    await postTurn(sessionId, ANSWERS.intro, "tc-1");
    await postTurn(sessionId, ANSWERS.clarification, "tc-2");
    await postTurn(sessionId, ANSWERS.framework, "tc-3");
    await postTurn(sessionId, ANSWERS.analysis, "tc-4");

    const r1 = await postTurn(sessionId, ANSWERS.data_reveal, "tc-5");
    const r2 = await postTurn(sessionId, ANSWERS.data_reveal, "tc-6");
    const r3 = await postTurn(sessionId, ANSWERS.data_reveal, "tc-7");

    expect(r1.action).toBe("reveal");
    expect(r1.exhibit.id).toBe("exhibit_investment");
    expect(r2.action).toBe("reveal");
    expect(r2.exhibit.id).toBe("exhibit_competitor_bots");
    expect(r3.action).toBe("advance");
    expect(r3.exhibit).toBeNull();
    expect(stored(sessionId).session.exhibits_revealed).toEqual([
      "exhibit_investment",
      "exhibit_competitor_bots",
    ]);
  });

  it("returns bounded retry responses for invalid answers without mutating the Case FSM", async () => {
    const { sessionId } = await bootstrap();
    const first = await postTurn(sessionId, "   ", "tc-invalid-1");
    const second = await postTurn(sessionId, "", "tc-invalid-2");

    expect(first.error).toBe("invalid_answer");
    expect(first.retryable).toBe(true);
    expect(second.retryable).toBe(false);
    expect(second.retryCount).toBe(2);
    expect(stored(sessionId).session.history).toHaveLength(0);
    expect(stored(sessionId).callId).toBeNull();
    expect(stored(sessionId).invalidRetries).toBe(2);
  });

  it("handles an expired or wrong-module session safely", async () => {
    const result = await postTurn("ghost-session", ANSWERS.intro, "tc-ghost");

    expect(result.error).toBe("session_not_found");
    expect(result.complete).toBe(true);
  });

  it("requires sessionId, callId, and toolCallId before processing", async () => {
    const missingSession = await caseVoicePOST(
      makeReq(toolBody("", ANSWERS.intro, "tc-missing-session"), authHeader) as never,
    );
    expect(JSON.parse((await missingSession.json()).results[0].result).error).toBe("missing_session_id");

    const { sessionId } = await bootstrap();
    const missingCall = await caseVoicePOST(
      makeReq(
        {
          message: {
            type: "tool-calls",
            toolCallList: [
              {
                id: "tc-missing-call",
                name: "submit_case_answer",
                parameters: { sessionId, answer: ANSWERS.intro },
              },
            ],
          },
        },
        authHeader,
      ) as never,
    );
    expect(JSON.parse((await missingCall.json()).results[0].result).error).toBe("missing_call_id");

    const missingToolCall = await caseVoicePOST(
      makeReq(
        {
          message: {
            type: "tool-calls",
            call: { id: "vapi-call-1" },
            toolCallList: [
              {
                name: "submit_case_answer",
                parameters: { sessionId, answer: ANSWERS.intro },
              },
            ],
          },
        },
        authHeader,
      ) as never,
    );
    expect(missingToolCall.status).toBe(400);
    expect((await missingToolCall.json()).error).toBe("tool_call_not_found");
    expect(stored(sessionId).session.history).toHaveLength(0);
  });

  it("reaches recommendation, scoring, and returns the existing final CaseScore contract", async () => {
    const { sessionId } = await bootstrap();
    const final = await runToFinal(sessionId);

    expect(final.stage).toBe("scoring");
    expect(final.complete).toBe(true);
    expect(final.score).toBeTruthy();
    expect(final.score.dimension_scores).toHaveLength(5);
    expect(final.score.overall).toBeGreaterThanOrEqual(1);
    expect(final.score.overall).toBeLessThanOrEqual(5);
    expect(stored(sessionId).session.complete).toBe(true);
  });
});

describe("GET /api/case/voice/[sessionId]", () => {
  it("requires the projection token and returns the protected browser projection", async () => {
    const { sessionId, projectionToken } = await bootstrap();
    await postTurn(sessionId, ANSWERS.intro, "tc-1");

    const wrong = await projectionGET(getReq("wrong") as never, { params: { sessionId } });
    expect(wrong.status).toBe(404);

    const ok = await projectionGET(getReq(projectionToken) as never, { params: { sessionId } });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.stage).toBe("clarification");
    expect(body.turnSeq).toBe(1);
    expect(body.messages).toHaveLength(2);
    expect(body.exhibits).toEqual([]);
    expect(body.projectionToken).toBeUndefined();
    expect(body.evaluation).toBeUndefined();
  });
});

describe("manual /api/case regression", () => {
  it("keeps the existing manual Case route working", async () => {
    const started = await casePOST(makeReq({ action: "start", caseId: "beautify" }) as never);
    expect(started.status).toBe(200);
    const startBody = await started.json();
    expect(startBody.stage).toBe("intro");

    const turn = await casePOST(
      makeReq({
        action: "respond",
        caseId: "beautify",
        session: startBody.session,
        answer: ANSWERS.intro,
      }) as never,
    );
    expect(turn.status).toBe(200);
    const turnBody = await turn.json();
    expect(turnBody.stage).toBe("clarification");
    expect(turnBody.session.fsm_state).toBe("clarification");
  });
});
