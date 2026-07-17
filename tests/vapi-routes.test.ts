import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared in-memory Redis fake (see voice-session-store.test.ts for the pattern).
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

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { POST as behaviouralPOST } from "@/app/api/vapi/behavioural/route";
import { MOCK_QUESTIONS } from "@/lib/__mocks__/fixtures";
import type { BehaviouralVoiceSession } from "@/lib/voice/types";

const SECRET = "test-secret";

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/vapi", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const authHeader = { authorization: `Bearer ${SECRET}` };

const STRONG_BEHAVIOURAL =
  "During my final-year consulting project our churn model was unstable before the deadline. As team lead I organized a 45-minute reset, reassigned work by strength, and rebuilt the model with a simpler logistic-regression baseline in Python. As a result we delivered on time and found three churn drivers explaining 62% of at-risk accounts.";

function behaviouralToolCall(sessionId: string, answer: string, id = "call_1") {
  return {
    message: {
      toolCallList: [{ id, name: "submit_behavioural_answer", parameters: { sessionId, answer } }],
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  delete process.env.VAPI_AUTH_DEBUG;
});

describe("POST /api/vapi/session (bootstrap)", () => {
  it("bootstraps a behavioural session, persists it with TTL, and returns the first question", async () => {
    const res = await sessionPOST(makeReq({ module: "behavioural", jdText: "" }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(typeof data.sessionId).toBe("string");
    expect(data.firstQuestion.id).toBe(MOCK_QUESTIONS[0].id);
    // mock-mode JD fallback grounds the company.
    expect(data.companyName).toBe("Revature");

    const stored = redisStore.get(`voice-session:${data.sessionId}`);
    expect(stored?.ex).toBe(7200);
    expect((stored?.value as BehaviouralVoiceSession).questionIndex).toBe(0);
  });

  it("bootstraps a case session and returns opening prompt + title", async () => {
    const res = await sessionPOST(makeReq({ module: "case", caseId: "beautify" }) as never);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(typeof data.sessionId).toBe("string");
    expect(typeof data.openingPrompt).toBe("string");
    expect(data.openingPrompt.length).toBeGreaterThan(0);
    expect(data.caseTitle).toBeTruthy();
    expect(redisStore.has(`voice-session:${data.sessionId}`)).toBe(true);
  });

  it("rejects an invalid module", async () => {
    const res = await sessionPOST(makeReq({ module: "nope" }) as never);
    expect(res.status).toBe(400);
  });

  it("404s on an unknown case id", async () => {
    const res = await sessionPOST(makeReq({ module: "case", caseId: "ghost" }) as never);
    expect(res.status).toBe(404);
  });

  it("enforces jdText length limits", async () => {
    const res = await sessionPOST(
      makeReq({ module: "behavioural", jdText: "x".repeat(20_001) }) as never,
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/vapi/behavioural (tool webhook)", () => {
  async function bootstrap(): Promise<string> {
    const res = await sessionPOST(makeReq({ module: "behavioural", jdText: "" }) as never);
    return (await res.json()).sessionId;
  }

  it("rejects a missing bearer token", async () => {
    const res = await behaviouralPOST(makeReq(behaviouralToolCall("s", "a")) as never);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall("s", "a"), { authorization: "Bearer wrong" }) as never,
    );
    expect(res.status).toBe(401);
  });

  it("fails closed when VAPI_WEBHOOK_SECRET is missing (never allows the request)", async () => {
    delete process.env.VAPI_WEBHOOK_SECRET;
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall("s", "a"), authHeader) as never,
    );
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(500);
  });

  it("authorizes a token even if the STORED secret has trailing whitespace (regression)", async () => {
    // Reproduces the production trailing-newline injection: the stored secret has
    // a trailing "\n" while the client sends the clean token. Both sides are now
    // trimmed before comparison, so authorization must succeed. Before the fix this
    // returned 401 (the token was trimmed but the secret was not).
    process.env.VAPI_WEBHOOK_SECRET = `${SECRET}\n`;
    const sessionId = await bootstrap();
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall(sessionId, STRONG_BEHAVIOURAL), authHeader) as never,
    );
    expect(res.status).toBe(200);
  });

  it("VAPI_AUTH_DEBUG logs a safe server-only diagnostic but never puts it in the response body", async () => {
    process.env.VAPI_AUTH_DEBUG = "true";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall("s", "a"), { authorization: "Bearer wrong" }) as never,
    );
    expect(res.status).toBe(401);

    // No diagnostic metadata is exposed in the API response.
    const body = await res.json();
    expect(body.diagnostic).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(SECRET);

    // The safe diagnostic goes only to the server log: presence + lengths + match.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(logged).toMatchObject({
      secretPresent: true,
      secretLength: SECRET.length,
      authHeaderPresent: true,
      matched: false,
    });
    expect(typeof logged.tokenLength).toBe("number");
    // never the secret or token bytes, even in the log
    const serializedLog = JSON.stringify(logged);
    expect(serializedLog).not.toContain(SECRET);
    expect(serializedLog).not.toContain("wrong");
    warnSpy.mockRestore();
  });

  it("does NOT log or expose diagnostics when VAPI_AUTH_DEBUG is unset", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall("s", "a"), { authorization: "Bearer wrong" }) as never,
    );
    expect(res.status).toBe(401);
    expect((await res.json()).diagnostic).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("400s on a malformed Vapi payload (no tool call)", async () => {
    const res = await behaviouralPOST(makeReq({ message: {} }, authHeader) as never);
    expect(res.status).toBe(400);
  });

  it("advances the question index and returns the next question", async () => {
    const sessionId = await bootstrap();
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall(sessionId, STRONG_BEHAVIOURAL, "call_abc"), authHeader) as never,
    );
    expect(res.status).toBe(200);
    const envelope = await res.json();

    // exact toolCallId echoed; result is a string
    expect(envelope.results[0].toolCallId).toBe("call_abc");
    expect(envelope.results[0].name).toBe("submit_behavioural_answer");
    expect(typeof envelope.results[0].result).toBe("string");

    const result = JSON.parse(envelope.results[0].result);
    expect(result.complete).toBe(false);
    expect(result.nextQuestion.id).toBe(MOCK_QUESTIONS[1].id);
    expect(result.questionNumber).toBe(2);

    // SECURITY: only the four navigation fields are exposed during the interview.
    expect(Object.keys(result).sort()).toEqual([
      "complete",
      "nextQuestion",
      "questionNumber",
      "spokenText",
    ]);
    // no per-answer score, matched answer, match score, or session data leaks
    expect(result.score).toBeUndefined();
    expect(result.matched_answer).toBeUndefined();
    expect(result.match_score).toBeUndefined();
    expect(result.session).toBeUndefined();

    // the score is still recorded in the STORED session for the final report
    const stored = redisStore.get(`voice-session:${sessionId}`)!.value as BehaviouralVoiceSession;
    expect(stored.questionIndex).toBe(1);
    expect(Object.keys(stored.session.scores ?? {})).toContain(MOCK_QUESTIONS[0].id);
  });

  it("reports completion after the final question", async () => {
    const sessionId = await bootstrap();
    let last: Record<string, unknown> = {};
    for (let i = 0; i < MOCK_QUESTIONS.length; i++) {
      const res = await behaviouralPOST(
        makeReq(behaviouralToolCall(sessionId, STRONG_BEHAVIOURAL, `c${i}`), authHeader) as never,
      );
      last = JSON.parse((await res.json()).results[0].result);
    }
    expect(last.complete).toBe(true);
    expect(last.nextQuestion).toBeNull();
    // no aggregate score is produced by the voice tool (the final report is a
    // separate, candidate-visible flow), so none is exposed here
    expect(last.score).toBeUndefined();
  });

  it("handles a missing/expired Redis session gracefully with a matched toolCallId", async () => {
    const res = await behaviouralPOST(
      makeReq(behaviouralToolCall("ghost-session", "hello", "call_x"), authHeader) as never,
    );
    expect(res.status).toBe(200);
    const envelope = await res.json();
    expect(envelope.results[0].toolCallId).toBe("call_x");
    const result = JSON.parse(envelope.results[0].result);
    expect(result.error).toBe("session_not_found");
    expect(result.complete).toBe(true);
  });

  it("defensively parses the toolWithToolCallList shape", async () => {
    const sessionId = await bootstrap();
    const body = {
      message: {
        toolWithToolCallList: [
          {
            toolCall: {
              id: "with_1",
              name: "submit_behavioural_answer",
              parameters: { sessionId, answer: STRONG_BEHAVIOURAL },
            },
          },
        ],
      },
    };
    const res = await behaviouralPOST(makeReq(body, authHeader) as never);
    const envelope = await res.json();
    expect(envelope.results[0].toolCallId).toBe("with_1");
    expect(JSON.parse(envelope.results[0].result).complete).toBe(false);
  });
});
