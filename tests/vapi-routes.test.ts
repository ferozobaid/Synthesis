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
import { POST as casePOST } from "@/app/api/vapi/case/route";
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

// Strong answers per case stage, reused from tests/case-runner.test.ts so the
// mock FSM advances through the case to scoring and drips both exhibits.
const CASE_ANSWERS: Record<string, string> = {
  intro:
    "We're being asked one core question: would retraining most of Beautify's in-store consultants into virtual social-media advisors be profitable? Two things drive it — first, shoppers are moving online and consultants sit idle; second, the retraining investment must pay back within a reasonable horizon while protecting the brand and retail relationships.",
  clarification:
    "I'd ask three clarifying questions. First, over what time horizon must this be profitable? Second, which brands and markets are in scope for the virtual rollout? Third, who bears the retraining and IT cost, Beautify or the retail partners?",
  framework:
    "I'd structure this around five factors. First, the retailer response. Second, the competitor response. Third, our consultants' current capabilities. Fourth, the brand-image risk. Fifth, the underlying economics of retraining cost versus incremental revenue. My hypothesis is the economics will dominate, so I'd size them first.",
  analysis:
    "I'd start from what the customer values in store and ask how virtual can match it. First, real-time tailored feedback through a selfie-mirror app with virtual try-on. Second, an online community led by a trusted advisor. Third, learning trends from that advisor. Fourth, private, responsive handling of specific concerns. My hypothesis is that personalization and trust are the switching triggers, so the virtual experience must replicate the relationship.",
  data_reveal:
    "Payback is the upfront investment over the annual profit it generates. Incremental revenue is €130M, minus €10M annual costs is €120M, minus €2.5M IT depreciation is €117.5M. So €150M ÷ €117.5M ≈ 1.28 years. The competitor data shows virtual try-on lifts conversion most and cuts returns, so I'd prioritize that capability.",
  pressure_test:
    "I don't dismiss the risk — therefore I'd size it and mitigate it. My hypothesis is that the upside outweighs the cannibalization risk if we phase carefully. I'd pilot in two markets to measure cannibalization before scaling, share economics with retail partners through a revenue-share, and set brand-content guidelines. The payback math and the try-on conversion data suggest the value is real, so the risk is manageable.",
  recommendation:
    "My recommendation is to proceed with a phased rollout. The payback is about 1.28 years, well within a reasonable horizon, and the exhibit shows virtual try-on drives the most conversion while cutting returns. So I'd prioritize that capability, pilot in two markets, and share economics with retail partners to manage cannibalization.",
  scoring: "",
};

const STRONG_BEHAVIOURAL =
  "During my final-year consulting project our churn model was unstable before the deadline. As team lead I organized a 45-minute reset, reassigned work by strength, and rebuilt the model with a simpler logistic-regression baseline in Python. As a result we delivered on time and found three churn drivers explaining 62% of at-risk accounts.";

function behaviouralToolCall(sessionId: string, answer: string, id = "call_1") {
  return {
    message: {
      toolCallList: [{ id, name: "submit_behavioural_answer", parameters: { sessionId, answer } }],
    },
  };
}

function caseToolCall(sessionId: string, answer: string, id = "case_1") {
  return {
    message: {
      toolCallList: [{ id, name: "advance_case_interview", parameters: { sessionId, answer } }],
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
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
    expect(stored?.ex).toBe(2700);
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
    expect(result.score).toBeTruthy();

    // persisted index advanced
    const stored = redisStore.get(`voice-session:${sessionId}`)!.value as BehaviouralVoiceSession;
    expect(stored.questionIndex).toBe(1);
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
    expect(last.score).toBeTruthy();
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

describe("POST /api/vapi/case (tool webhook)", () => {
  async function bootstrap(): Promise<string> {
    const res = await sessionPOST(makeReq({ module: "case", caseId: "beautify" }) as never);
    return (await res.json()).sessionId;
  }

  it("rejects a missing bearer token", async () => {
    const res = await casePOST(makeReq(caseToolCall("s", "a")) as never);
    expect(res.status).toBe(401);
  });

  it("maps stage, exhibits, and completion across a full case", async () => {
    const sessionId = await bootstrap();
    let phase = "intro";
    let sawExhibit = false;
    let last: Record<string, unknown> = {};
    let guard = 0;

    while (guard++ < 30) {
      const answer = CASE_ANSWERS[phase] ?? "A reasonable, structured response.";
      const res = await casePOST(
        makeReq(caseToolCall(sessionId, answer, `case_${guard}`), authHeader) as never,
      );
      expect(res.status).toBe(200);
      const envelope = await res.json();

      // exact toolCallId echoed and result is a string every turn
      expect(envelope.results[0].toolCallId).toBe(`case_${guard}`);
      expect(typeof envelope.results[0].result).toBe("string");

      last = JSON.parse(envelope.results[0].result);
      expect(typeof last.phase).toBe("string"); // stage mapping present
      if (last.exhibit) {
        sawExhibit = true;
        expect((last.exhibit as { id: string }).id).toBeTruthy();
        expect((last.exhibit as { title: string }).title).toBeTruthy();
        expect(last.uiAction).toBe("reveal_exhibit");
      }
      phase = last.phase as string;
      if (last.complete) break;
    }

    expect(sawExhibit).toBe(true); // exhibit mapping exercised
    expect(last.complete).toBe(true);
    expect(last.phase).toBe("scoring"); // stage mapping at terminal
    expect(last.score).toBeTruthy();
  });

  it("handles a missing/expired Redis session gracefully", async () => {
    const res = await casePOST(
      makeReq(caseToolCall("ghost", "answer", "case_x"), authHeader) as never,
    );
    expect(res.status).toBe(200);
    const envelope = await res.json();
    expect(envelope.results[0].toolCallId).toBe("case_x");
    expect(JSON.parse(envelope.results[0].result).error).toBe("session_not_found");
  });
});
