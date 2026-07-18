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

import { GET as projectionGET } from "@/app/api/case/voice/[sessionId]/route";
import { POST as customLlmPOST } from "@/app/api/vapi/case/chat/completions/route";
import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { mockCase } from "@/lib/__mocks__/fixtures";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "test-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };
const INTRODUCTION =
  "Hello, I’ll be your case interviewer today. We’ll be going through the Beautify case. Ready whenever you are? Let’s begin.";
const OPENING_QUESTION =
  "What would you like to clarify before structuring your approach?";

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

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/vapi/case/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function projectionRequest(token: string): Request {
  return new Request("http://localhost/api/case/voice/session", {
    headers: { "x-case-voice-token": token },
  });
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

async function bootstrap() {
  const response = await sessionPOST(
    request({ module: "case", caseId: "beautify" }) as never,
  );
  expect(response.status).toBe(200);
  return await response.json() as {
    sessionId: string;
    projectionToken: string;
    openingPrompt: string;
  };
}

function modelBody(sessionId: string, callId: string, messages: ChatMessage[]) {
  return {
    model: "synthesis-case-fsm",
    stream: true,
    messages,
    metadata: { sessionId, caseId: "beautify" },
    call: { id: callId },
  };
}

async function spokenText(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const payloads = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  return payloads
    .map((payload) => payload.choices?.[0]?.delta?.content ?? "")
    .join("");
}

async function sendTurn(
  sessionId: string,
  callId: string,
  history: ChatMessage[],
  answer: string,
): Promise<string> {
  history.push({ role: "user", content: answer });
  const response = await customLlmPOST(
    request(modelBody(sessionId, callId, history), authHeader) as never,
  );
  const text = await spokenText(response);
  history.push({ role: "assistant", content: text });
  return text;
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "true";
  delete process.env.VAPI_CASE_AUTH_DEBUG;
});

describe("Case custom-LLM deterministic turn loop", () => {
  it("puts the required introduction before the existing authored Beautify prompt", async () => {
    const bootstrapData = await bootstrap();
    const authoredPrompt = mockCase("beautify")!.prompt!;

    expect(bootstrapData.openingPrompt.startsWith(`${INTRODUCTION}\n\n`)).toBe(true);
    expect(bootstrapData.openingPrompt.indexOf(authoredPrompt)).toBeGreaterThan(INTRODUCTION.length);
    expect(bootstrapData.openingPrompt.endsWith(`\n\n${OPENING_QUESTION}`)).toBe(true);
    expect(stored(bootstrapData.sessionId).openingText).toBe(bootstrapData.openingPrompt);
    expect(stored(bootstrapData.sessionId).session.fsm_state).toBe("clarification");
  });

  it("logs only safe request authentication diagnostics when explicitly enabled", async () => {
    const started = await bootstrap();
    const messages: ChatMessage[] = [
      { role: "assistant", content: started.openingPrompt },
      { role: "user", content: ANSWERS.clarification },
    ];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.VAPI_CASE_AUTH_DEBUG = "true";

    const rejected = await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", messages), {
        authorization: `Basic ${SECRET}`,
      }) as never,
    );
    expect(rejected.status).toBe(401);
    expect(info).toHaveBeenLastCalledWith("[case-custom-llm] request", {
      requestReceived: true,
      authorizationHeader: "present",
      authenticationScheme: "Basic",
      metadataSessionId: "present",
      statusCode: 401,
    });

    const accepted = await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", messages), authHeader) as never,
    );
    expect(accepted.status).toBe(200);
    expect(info).toHaveBeenLastCalledWith("[case-custom-llm] request", {
      requestReceived: true,
      authorizationHeader: "present",
      authenticationScheme: "Bearer",
      metadataSessionId: "present",
      statusCode: 200,
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(info.mock.calls)).not.toContain(ANSWERS.clarification);
    info.mockRestore();
  });

  it("evaluates every finalized non-empty candidate turn exactly once", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    const session = stored(started.sessionId);
    expect(reply).toBe(session.projectedTurns?.[0].interviewerText);
    expect(session.session.history).toHaveLength(2);
    expect(session.projectedTurns).toHaveLength(1);
    expect(session.turnSeq).toBe(1);
    expect(session.callId).toBe("call-1");
  });

  it("returns a cached retry without evaluating or advancing the FSM twice", async () => {
    const started = await bootstrap();
    const messages: ChatMessage[] = [
      { role: "assistant", content: started.openingPrompt },
      { role: "user", content: ANSWERS.clarification },
    ];
    const body = modelBody(started.sessionId, "call-1", messages);

    const first = await spokenText(
      await customLlmPOST(request(body, authHeader) as never),
    );
    const second = await spokenText(
      await customLlmPOST(request(body, authHeader) as never),
    );

    expect(second).toBe(first);
    expect(stored(started.sessionId).session.history).toHaveLength(2);
    expect(stored(started.sessionId).projectedTurns).toHaveLength(1);
    expect(stored(started.sessionId).turnSeq).toBe(1);
  });

  it("coalesces overlapping delivery of the same model request", async () => {
    const started = await bootstrap();
    const messages: ChatMessage[] = [
      { role: "assistant", content: started.openingPrompt },
      { role: "user", content: ANSWERS.clarification },
    ];
    const body = modelBody(started.sessionId, "call-1", messages);

    const [firstResponse, secondResponse] = await Promise.all([
      customLlmPOST(request(body, authHeader) as never),
      customLlmPOST(request(body, authHeader) as never),
    ]);
    const [first, second] = await Promise.all([
      spokenText(firstResponse),
      spokenText(secondResponse),
    ]);

    expect(second).toBe(first);
    expect(stored(started.sessionId).session.history).toHaveLength(2);
    expect(stored(started.sessionId).projectedTurns).toHaveLength(1);
    expect(stored(started.sessionId).turnSeq).toBe(1);
  });

  it("returns only the exact persisted backend interviewer text as assistant speech", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    const reply = await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);
    const turn = stored(started.sessionId).projectedTurns![0];

    expect(reply).toBe(turn.interviewerText);
    expect(reply).not.toContain("evaluation");
    expect(reply).not.toContain("stageIndex");
    expect(reply).not.toContain("turnSeq");
  });

  it("uses concise deterministic interviewer phrasing for each FSM transition", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification)).toBe(
      "Good. Let's move to your structure. What factors should Beautify consider as it shifts consultants into virtual-advisor roles?",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.framework)).toBe(
      "That's a sensible structure. Let's start with the customer. What would make a high-touch in-store customer switch to a mostly virtual experience?",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.analysis)).toBe(
      "Good. Let's ground the case in data. Are you ready for the first exhibit?",
    );

    const firstExhibit = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      ANSWERS.data_reveal,
    );
    expect(firstExhibit).toContain("First-year economics of the virtual-advisor shift");
    expect(firstExhibit).toContain("what it means for Beautify");

    const secondExhibit = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      ANSWERS.data_reveal,
    );
    expect(secondExhibit).toContain("Effect of top-4 competitors' AI chatbots");

    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.data_reveal)).toBe(
      "Good. Now pressure-test your conclusion. What is the strongest argument against this shift, and how would you address it?",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.pressure_test)).toBe(
      "Understood. Please give me your concise final recommendation, supported by the key evidence and next steps.",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.recommendation)).toBe(
      "Thank you. That concludes the case.",
    );
  });

  it("keeps a weak clarification in-stage with one natural backend-owned probe", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "What is the time horizon?",
    );

    expect(reply).toBe(
      "No fixed time horizon is provided, so state a reasonable assumption and test it against the case economics. What else would you like to clarify before structuring your approach?",
    );
    expect(stored(started.sessionId).session.fsm_state).toBe("clarification");
    expect(stored(started.sessionId).projectedTurns?.[0]).toMatchObject({
      stage: "clarification",
      action: "probe",
      interviewerText: reply,
    });
  });

  it("commits candidate and interviewer text under the same turnSeq", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    expect(stored(started.sessionId).projectedTurns![0]).toMatchObject({
      turnSeq: 1,
      candidateText: ANSWERS.clarification,
      stage: "framework",
      action: "advance",
      exhibit: null,
    });
  });

  it("keeps projected turns chronological and duplicate-free", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.framework);

    const response = await projectionGET(
      projectionRequest(started.projectionToken) as never,
      { params: { sessionId: started.sessionId } },
    );
    const projection = await response.json();

    expect(projection.turns.map((turn: { turnSeq: number }) => turn.turnSeq)).toEqual([1, 2]);
    expect(projection.turns[0].candidateText).toBe(ANSWERS.clarification);
    expect(projection.turns[1].candidateText).toBe(ANSWERS.framework);
  });

  it("reveals exhibits once and in authored order", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    for (const answer of [
      ANSWERS.clarification,
      ANSWERS.framework,
      ANSWERS.analysis,
      ANSWERS.data_reveal,
      ANSWERS.data_reveal,
      ANSWERS.data_reveal,
    ]) {
      await sendTurn(started.sessionId, "call-1", history, answer);
    }

    const session = stored(started.sessionId);
    expect(session.session.exhibits_revealed).toEqual([
      "exhibit_investment",
      "exhibit_competitor_bots",
    ]);
    expect(session.projectedTurns?.filter((turn) => turn.exhibit).map((turn) => turn.exhibit!.id)).toEqual([
      "exhibit_investment",
      "exhibit_competitor_bots",
    ]);
  });

  it("reaches recommendation and preserves the existing final score contract", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    for (const answer of [
      ANSWERS.clarification,
      ANSWERS.framework,
      ANSWERS.analysis,
      ANSWERS.data_reveal,
      ANSWERS.data_reveal,
      ANSWERS.data_reveal,
      ANSWERS.pressure_test,
      ANSWERS.recommendation,
    ]) {
      await sendTurn(started.sessionId, "call-1", history, answer);
    }

    const session = stored(started.sessionId);
    expect(session.session.fsm_state).toBe("scoring");
    expect(session.session.complete).toBe(true);
    expect(session.score?.dimension_scores).toHaveLength(5);
    expect(session.score?.overall).toBeGreaterThanOrEqual(1);
    expect(session.score?.overall).toBeLessThanOrEqual(5);
  });

  it("rejects unauthenticated, expired, mismatched, and empty requests without FSM mutation", async () => {
    const started = await bootstrap();
    const validMessages: ChatMessage[] = [
      { role: "assistant", content: started.openingPrompt },
      { role: "user", content: ANSWERS.clarification },
    ];

    const unauthorized = await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", validMessages)) as never,
    );
    expect(unauthorized.status).toBe(401);

    const expired = await customLlmPOST(
      request(modelBody("expired", "call-1", validMessages), authHeader) as never,
    );
    expect(expired.status).toBe(404);

    const empty = await customLlmPOST(
      request(
        modelBody(started.sessionId, "call-1", [
          { role: "assistant", content: started.openingPrompt },
          { role: "user", content: "   " },
        ]),
        authHeader,
      ) as never,
    );
    expect(empty.status).toBe(400);
    expect(stored(started.sessionId).session.history).toHaveLength(0);
  });
});
