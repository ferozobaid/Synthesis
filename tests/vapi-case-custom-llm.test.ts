import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore, controllerMock, controllerWarningMock } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: unknown; ex?: number }>(),
  controllerMock: vi.fn(),
  controllerWarningMock: vi.fn(),
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

vi.mock("@/lib/voice/case-turn-controller", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-turn-controller")>();
  return {
    ...actual,
    runCaseTurnController: controllerMock,
    warnIfCaseTurnControllerUsesMocks: controllerWarningMock,
  };
});

import { GET as projectionGET } from "@/app/api/case/voice/[sessionId]/route";
import { POST as customLlmPOST } from "@/app/api/vapi/case/chat/completions/route";
import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { mockCase } from "@/lib/__mocks__/fixtures";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "test-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };
const INTRODUCTION =
  "Hello, I’ll be your case interviewer today. We’ll be going through the Beautify case. Are you ready to begin?";
const READINESS_CONFIRMED = "Great, let’s begin.";
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
const COMPLETE_FRAMEWORK =
  "I would organize the analysis into external attractiveness and internal feasibility. Externally, I would assess customer demand, digital adoption, competitor activity, and retailer channel dynamics. Internally, I would assess brand fit, customer experience, technology and data capability, consultant training, and the operating model. I would then test financial viability through upfront investment, recurring costs, productivity, incremental sales, margins, payback, and downside risk.";

interface ChatMessage {
  id?: string;
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

function modelBody(
  sessionId: string,
  callId: string,
  messages: ChatMessage[],
  requestId?: string,
) {
  return {
    id: requestId,
    model: "synthesis-case-fsm",
    stream: true,
    messages,
    metadata: { sessionId, caseId: "beautify" },
    call: { id: callId },
  };
}

async function ssePayloads(response: Response): Promise<Array<Record<string, any>>> {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  return (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}

async function spokenText(response: Response): Promise<string> {
  const payloads = await ssePayloads(response);
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
  if (stored(sessionId).readinessStatus !== "confirmed") {
    await confirmReadiness(sessionId, callId, history);
  }
  history.push({ role: "user", content: answer });
  const response = await customLlmPOST(
    request(modelBody(sessionId, callId, history), authHeader) as never,
  );
  const text = await spokenText(response);
  history.push({ role: "assistant", content: text });
  return text;
}

async function confirmReadiness(
  sessionId: string,
  callId: string,
  history: ChatMessage[],
  answer = "Yes, I’m ready.",
): Promise<string> {
  history.push({ role: "user", content: answer });
  const response = await customLlmPOST(
    request(modelBody(sessionId, callId, history), authHeader) as never,
  );
  const text = await spokenText(response);
  history.push({ role: "assistant", content: text });
  return text;
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "true";
  process.env.CASE_VOICE_REVISION_WINDOW_MS = "5";
  delete process.env.CASE_VOICE_CONTROLLER_MODE;
  delete process.env.VAPI_CASE_AUTH_DEBUG;
  delete process.env.VAPI_CASE_TURN_DEBUG;
  delete process.env.VAPI_CASE_LATENCY_DEBUG;
  controllerMock.mockReset();
  controllerWarningMock.mockReset();
});

describe("Case custom-LLM deterministic turn loop", () => {
  it("withholds the authored Beautify prompt until readiness is confirmed", async () => {
    const bootstrapData = await bootstrap();
    const authoredPrompt = mockCase("beautify")!.prompt!;

    expect(bootstrapData.openingPrompt).toBe(INTRODUCTION);
    expect(bootstrapData.openingPrompt).not.toContain(authoredPrompt);
    expect(stored(bootstrapData.sessionId).openingText).toBe(bootstrapData.openingPrompt);
    expect(stored(bootstrapData.sessionId).readinessStatus).toBe("awaiting");
    expect(stored(bootstrapData.sessionId).session.fsm_state).toBe("clarification");
  });

  it("confirms readiness without scoring or advancing the Case FSM", async () => {
    const started = await bootstrap();
    const authoredPrompt = mockCase("beautify")!.prompt!;
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await confirmReadiness(started.sessionId, "call-1", history, "Let’s begin");
    const session = stored(started.sessionId);

    expect(reply).toBe(`${READINESS_CONFIRMED}\n\n${authoredPrompt}\n\n${OPENING_QUESTION}`);
    expect(session.readinessStatus).toBe("confirmed");
    expect(session.session.fsm_state).toBe("clarification");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
    expect(session.openingText).toBe(`${INTRODUCTION}\n\n${reply}`);
  });

  it("accepts a natural readiness confirmation with a temporal modifier", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await confirmReadiness(started.sessionId, "call-1", history, "I’m ready now");
    const session = stored(started.sessionId);

    expect(reply).toContain(READINESS_CONFIRMED);
    expect(session.readinessStatus).toBe("confirmed");
    expect(session.readinessConfirmedAt).toEqual(expect.any(String));
    expect(session.session.history).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it("returns the cached readiness response when the confirmation request is repeated", async () => {
    const started = await bootstrap();
    const messages: ChatMessage[] = [
      { role: "assistant", content: started.openingPrompt },
      { role: "user", content: "Yes, I’m ready" },
    ];
    const body = modelBody(started.sessionId, "call-1", messages);

    const first = await spokenText(await customLlmPOST(request(body, authHeader) as never));
    const retry = await spokenText(await customLlmPOST(request(body, authHeader) as never));
    const session = stored(started.sessionId);

    expect(retry).toBe(first);
    expect(session.readinessStatus).toBe("confirmed");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it("does not score a repeated readiness confirmation with different wording", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history, "Yes, I’m ready");

    const reply = await sendTurn(started.sessionId, "call-1", history, "Ready");
    const session = stored(started.sessionId);

    expect(reply).toBe(
      "The case has begun. What would you like to clarify before structuring your approach?",
    );
    expect(session.readinessStatus).toBe("confirmed");
    expect(session.session.fsm_state).toBe("clarification");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it("stays in readiness when the candidate is not ready", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await confirmReadiness(started.sessionId, "call-1", history, "Not yet");
    const session = stored(started.sessionId);

    expect(reply).toBe("No problem. Let me know when you’re ready.");
    expect(session.readinessStatus).toBe("awaiting");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it("answers thinking-time requests without scoring, transitioning, or creating a Case turn", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    const first = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "Can I have a moment to gather my thoughts?",
    );
    const second = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I’m still gathering my thoughts.",
    );
    const session = stored(started.sessionId);

    expect(first).toBe("Of course. Take your time and let me know when you’re ready.");
    expect(second).toBe(first);
    expect(session.conversationStatus).toBe("paused");
    expect(session.session.fsm_state).toBe("clarification");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
    expect(session.responseSeq).toBe(3);
    expect(session.score).toBeNull();
  });

  it("resumes and repeats the current question naturally without scoring", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    await sendTurn(started.sessionId, "call-1", history, "Can I gather my thoughts for a moment?");

    const resumed = await sendTurn(started.sessionId, "call-1", history, "I’m ready to continue");
    const repeated = await sendTurn(started.sessionId, "call-1", history, "Could you repeat the question?");
    const confused = await sendTurn(started.sessionId, "call-1", history, "I’m confused");
    const ended = await sendTurn(started.sessionId, "call-1", history, "Please end the interview");
    const session = stored(started.sessionId);

    expect(resumed).toBe("Of course. Let’s continue.");
    expect(repeated).toContain("What would you like to clarify before structuring your approach?");
    expect(confused).toBe("I understand. Let’s focus on the current question.");
    expect(ended).toBe("Of course. We’ll stop the interview here.");
    expect(session.conversationStatus).toBe("active");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it.each([
    "Give me a moment.",
    "Could you repeat the question?",
    "I already answered that.",
    "I’m confused.",
    "Stop the interview.",
  ])("keeps scored Case state unchanged for meta intent: %s", async (answer) => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const before = stored(started.sessionId);

    await sendTurn(started.sessionId, "call-1", history, answer);
    const after = stored(started.sessionId);

    expect(after.session).toEqual(before.session);
    expect(after.turnSeq).toBe(before.turnSeq);
    expect(after.score).toEqual(before.score);
    expect(after.projectedTurns).toEqual(before.projectedTurns);
    expect(after.invalidRetries).toBe(before.invalidRetries);
  });

  it("transitions and evaluates a compound Framework answer exactly once", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const compound =
      `I think I’m ready to structure my approach now. ${COMPLETE_FRAMEWORK}`;

    const reply = await sendTurn(started.sessionId, "call-1", history, compound);
    const session = stored(started.sessionId);
    const candidateTurns = session.session.history.filter((turn) => turn.role === "candidate");

    expect(session.session.fsm_state).toBe("analysis");
    expect(session.turnSeq).toBe(1);
    expect(candidateTurns).toHaveLength(1);
    expect(candidateTurns[0].stage).toBe("framework");
    expect(candidateTurns[0].text).toBe(COMPLETE_FRAMEWORK);
    expect(session.session.history.map((turn) => turn.role)).toEqual([
      "candidate",
      "interviewer",
    ]);
    expect(session.projectedTurns).toHaveLength(1);
    expect(session.projectedTurns?.[0]).toMatchObject({
      turnSeq: 1,
      candidateText: compound,
    });
    expect(reply).not.toContain("Those are useful clarifications");
    expect(reply).toContain("Imagine a current customer who shops in-store");
  });

  it("transitions and evaluates a done-clarifying compound remainder exactly once", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const compound = `I’m done clarifying. ${COMPLETE_FRAMEWORK}`;

    await sendTurn(started.sessionId, "call-1", history, compound);
    const session = stored(started.sessionId);
    const candidateTurns = session.session.history.filter((turn) => turn.role === "candidate");

    expect(session.session.fsm_state).toBe("analysis");
    expect(session.turnSeq).toBe(1);
    expect(candidateTurns).toHaveLength(1);
    expect(candidateTurns[0]).toMatchObject({ stage: "framework", text: COMPLETE_FRAMEWORK });
    expect(session.projectedTurns).toHaveLength(1);
    expect(session.projectedTurns?.[0].candidateText).toBe(compound);
    expect(controllerMock).not.toHaveBeenCalled();
  });

  it("moves a transition-only request to the authored Framework prompt without scoring a turn", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I’m ready to structure my approach",
    );
    const session = stored(started.sessionId);

    expect(reply).toBe(
      `Absolutely. Let’s move into your framework. ${mockCase("beautify")?.stages.find((stage) => stage.id === "framework")?.interviewer_prompt}`,
    );
    expect(session.session.fsm_state).toBe("framework");
    expect(session.session.history).toEqual([]);
    expect(session.turnSeq).toBe(0);
    expect(session.projectedTurns).toEqual([]);
    expect(session.score).toBeNull();
  });

  it.each([
    "I’m done with clarification.",
    "I would like to move to the framework now.",
    "I’m done with the clarification. I would like to move to the framework now.",
  ])("handles clear Framework navigation without scoring: %s", async (answer) => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    const reply = await sendTurn(started.sessionId, "call-1", history, answer);
    const session = stored(started.sessionId);

    expect(reply).toContain("Absolutely. Let’s move into your framework.");
    expect(session.session.fsm_state).toBe("framework");
    expect(session.session.history).toEqual([]);
    expect(session.projectedTurns).toEqual([]);
    expect(session.turnSeq).toBe(0);
    expect(controllerMock).not.toHaveBeenCalled();
  });

  it.each([
    "I think I’m ready, but give me another minute.",
    "I think I’m ready to structure. But give me another minute.",
    "I’m ready to structure, but first give me a moment.",
    "I think I can continue—actually, give me another minute.",
    "Let’s move to the framework, but let me gather my thoughts first.",
    "Can you give me a couple moments? I think I’m ready to structure. But just give me a couple of minutes.",
  ])("uses the hybrid controller for mixed pause language without Case mutation: %s", async (answer) => {
    process.env.CASE_VOICE_CONTROLLER_MODE = "hybrid";
    controllerMock.mockResolvedValue({
      outcome: "success",
      durationMs: 4,
      decision: {
        intent: "pause",
        targetStage: null,
        shouldEvaluate: false,
        substantiveRemainder: "",
        confidence: 0.98,
      },
    });
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const before = stored(started.sessionId);

    const reply = await sendTurn(started.sessionId, "call-1", history, answer);
    const after = stored(started.sessionId);

    expect(reply).toBe("Of course. Take your time and let me know when you’re ready.");
    expect(controllerMock).toHaveBeenCalledOnce();
    expect(after.conversationStatus).toBe("paused");
    expect(after.session).toEqual(before.session);
    expect(after.turnSeq).toBe(before.turnSeq);
    expect(after.score).toEqual(before.score);
    expect(after.projectedTurns).toEqual(before.projectedTurns);
  });

  it("fails closed in off mode instead of scoring unknown conversational language", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const before = stored(started.sessionId);

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "Could we change direction for a second?",
    );
    const after = stored(started.sessionId);

    expect(reply).toBe(
      "I may have misunderstood. Would you like a moment, a repeat of the question, or to continue with your answer?",
    );
    expect(controllerMock).not.toHaveBeenCalled();
    expect(after.session).toEqual(before.session);
    expect(after.turnSeq).toBe(0);
    expect(after.projectedTurns).toEqual([]);
  });

  it("runs but does not apply the controller in shadow mode", async () => {
    process.env.CASE_VOICE_CONTROLLER_MODE = "shadow";
    controllerMock.mockResolvedValue({
      outcome: "success",
      durationMs: 3,
      decision: {
        intent: "pause",
        targetStage: null,
        shouldEvaluate: false,
        substantiveRemainder: "",
        confidence: 0.97,
      },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I think I’m ready to structure. But give me another minute.",
    );
    const session = stored(started.sessionId);

    expect(reply).toBe(
      "I may have misunderstood. Would you like a moment, a repeat of the question, or to continue with your answer?",
    );
    expect(controllerMock).toHaveBeenCalledOnce();
    expect(session.session.fsm_state).toBe("clarification");
    expect(session.turnSeq).toBe(0);
    expect(info.mock.calls.find(([label]) => label === "[case-custom-llm] controller")?.[1])
      .toMatchObject({ mode: "shadow", validationPassed: true, applied: false });
    info.mockRestore();
  });

  it("replays the non-empty shadow fallback for a late mixed revision", async () => {
    process.env.CASE_VOICE_CONTROLLER_MODE = "shadow";
    controllerMock.mockResolvedValue({
      outcome: "success",
      durationMs: 3,
      decision: {
        intent: "stage_transition",
        targetStage: "framework",
        shouldEvaluate: false,
        substantiveRemainder: "",
        confidence: 0.96,
      },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const prefix = "I think I’m ready to structure.";
    const complete = `${prefix} But give me another minute.`;

    const first = await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", [
        ...history,
        { id: "mixed-turn-1", role: "user", content: prefix },
      ]), authHeader) as never,
    ));
    const replay = await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", [
        ...history,
        { id: "mixed-turn-1", role: "user", content: complete },
      ]), authHeader) as never,
    ));
    const session = stored(started.sessionId);

    expect(first).toBe(
      "I may have misunderstood. Would you like a moment, a repeat of the question, or to continue with your answer?",
    );
    expect(replay).toBe(first);
    expect(replay).not.toBe("");
    expect(controllerMock).toHaveBeenCalledOnce();
    expect(session.session.fsm_state).toBe("clarification");
    expect(session.turnSeq).toBe(0);
    expect(session.projectedTurns).toEqual([]);
    expect(session.session.history).toEqual([]);
    info.mockRestore();
  });

  it("applies a validated controller transition in hybrid mode", async () => {
    process.env.CASE_VOICE_CONTROLLER_MODE = "hybrid";
    controllerMock.mockResolvedValue({
      outcome: "success",
      durationMs: 2,
      decision: {
        intent: "stage_transition",
        targetStage: "framework",
        shouldEvaluate: true,
        substantiveRemainder: "",
        confidence: 0.96,
      },
    });
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "Let’s leave that section and get onto structure.",
    );
    const session = stored(started.sessionId);

    expect(reply).toContain("Absolutely. Let’s move into your framework.");
    expect(session.session.fsm_state).toBe("framework");
    expect(session.session.history).toEqual([]);
    expect(session.turnSeq).toBe(0);
  });

  it.each(["off", "shadow"] as const)(
    "does not reuse a %s ambiguity cache entry after switching to hybrid",
    async (initialMode) => {
      process.env.CASE_VOICE_CONTROLLER_MODE = initialMode;
      controllerMock.mockResolvedValue({
        outcome: "success",
        durationMs: 2,
        decision: {
          intent: "pause",
          targetStage: null,
          shouldEvaluate: false,
          substantiveRemainder: "",
          confidence: 0.97,
        },
      });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const started = await bootstrap();
      const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
      await confirmReadiness(started.sessionId, "call-1", history);
      const messages = [
        ...history,
        { id: "mode-change-1", role: "user" as const, content: "Could we change direction for a second?" },
      ];
      const body = modelBody(started.sessionId, "call-1", messages, "mode-change-request");

      const initial = await spokenText(await customLlmPOST(request(body, authHeader) as never));
      process.env.CASE_VOICE_CONTROLLER_MODE = "hybrid";
      const hybrid = await spokenText(await customLlmPOST(request(body, authHeader) as never));

      expect(initial).toContain("I may have misunderstood");
      expect(hybrid).toBe("Of course. Take your time and let me know when you’re ready.");
      expect(controllerMock).toHaveBeenCalledTimes(initialMode === "shadow" ? 2 : 1);
      expect(stored(started.sessionId)).toMatchObject({
        conversationStatus: "paused",
        turnSeq: 0,
        projectedTurns: [],
      });
      info.mockRestore();
    },
  );

  it.each(["timeout", "invalid_json", "refusal"] as const)(
    "caches a controller %s fallback for an exact request retry",
    async (outcome) => {
      process.env.CASE_VOICE_CONTROLLER_MODE = "hybrid";
      controllerMock.mockResolvedValue({
        outcome,
        durationMs: outcome === "timeout" ? 2_500 : 3,
        decision: null,
      });
      const started = await bootstrap();
      const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
      await confirmReadiness(started.sessionId, "call-1", history);
      const messages = [
        ...history,
        { id: "ambiguous-1", role: "user" as const, content: "Could we change direction for a second?" },
      ];
      const body = modelBody(started.sessionId, "call-1", messages, "controller-timeout");

      const first = await spokenText(await customLlmPOST(request(body, authHeader) as never));
      const retry = await spokenText(await customLlmPOST(request(body, authHeader) as never));
      const session = stored(started.sessionId);

      expect(retry).toBe(first);
      expect(first).toContain("I may have misunderstood");
      expect(controllerMock).toHaveBeenCalledOnce();
      expect(session.turnSeq).toBe(0);
      expect(session.projectedTurns).toEqual([]);
    },
  );

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
    const requestCalls = info.mock.calls.filter(([label]) => label === "[case-custom-llm] request");
    expect(requestCalls.at(-1)).toEqual(["[case-custom-llm] request", {
      requestReceived: true,
      authorizationHeader: "present",
      authenticationScheme: "Bearer",
      metadataSessionId: "present",
      statusCode: 200,
    }]);
    expect(JSON.stringify(info.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(info.mock.calls)).not.toContain(ANSWERS.clarification);
    info.mockRestore();
  });

  it("logs safe turn synchronization diagnostics only when explicitly enabled", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.VAPI_CASE_TURN_DEBUG = "true";

    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    const turnCalls = info.mock.calls.filter(([label]) => label === "[case-custom-llm] turn");
    expect(turnCalls.length).toBeGreaterThan(0);
    expect(turnCalls.at(-1)?.[1]).toMatchObject({
      callId: "call-1",
      messageCount: history.length - 1,
      outcome: "processed",
    });
    expect(JSON.stringify(turnCalls)).not.toContain(ANSWERS.clarification);
    expect(JSON.stringify(turnCalls)).not.toContain(SECRET);
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

  it("reports backend phase timings without exposing answer text", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    history.push({ role: "user", content: ANSWERS.clarification });

    const response = await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", history), authHeader) as never,
    );
    const timing = response.headers.get("server-timing") ?? "";

    expect(timing).toContain("stabilize;dur=");
    expect(timing).toContain("redis_lock;dur=");
    expect(timing).toContain("pending_lock;dur=");
    expect(timing).toContain("turn_lock;dur=");
    expect(timing).toContain("triage;dur=");
    expect(timing).toContain("controller;dur=");
    expect(timing).toContain("intent;dur=");
    expect(timing).toContain("evaluator;dur=");
    expect(timing).toContain("persist;dur=");
    expect(timing).toContain("response_ready;dur=");
    expect(timing).not.toContain(ANSWERS.clarification);
  });

  it("returns a cached retry without evaluating or advancing the FSM twice", async () => {
    const started = await bootstrap();
    const messages: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", messages);
    messages.push({ role: "user", content: ANSWERS.clarification });
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
    const messages: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", messages);
    messages.push({ role: "user", content: ANSWERS.clarification });
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

  it("replaces progressive revisions with one stable canonical candidate turn", async () => {
    process.env.CASE_VOICE_REVISION_WINDOW_MS = "50";
    process.env.VAPI_CASE_LATENCY_DEBUG = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const logicalTurnsBefore = Object.keys(stored(started.sessionId).processedLogicalTurns ?? {}).length;
    const partial =
      "I have three clarifying questions. What factors should Beautify consider?";
    const corrected =
      `${partial} No, actually, cut that. What time horizon should we use, which markets and brands are in scope, and will Beautify bear the technology, training, and operating costs?`;

    const firstRequest = customLlmPOST(
      request(
        modelBody(started.sessionId, "call-1", [
          ...history,
          { id: "user-turn-1", role: "user", content: partial },
        ], "model-request-1"),
        authHeader,
      ) as never,
    );
    await pause(5);
    const revisedRequest = customLlmPOST(
      request(
        modelBody(started.sessionId, "call-1", [
          ...history,
          { id: "user-turn-1", role: "user", content: corrected },
        ], "model-request-2"),
        authHeader,
      ) as never,
    );

    const [superseded, stableReply] = await Promise.all([
      firstRequest.then(ssePayloads),
      revisedRequest.then(spokenText),
    ]);
    const session = stored(started.sessionId);
    const supersededReply = superseded
      .map((payload) => payload.choices?.[0]?.delta?.content ?? "")
      .join("");

    expect(supersededReply).toBe("");
    expect(superseded[0].choices[0]).toMatchObject({
      delta: { role: "assistant", content: "" },
      finish_reason: null,
    });
    expect(superseded.at(-1)?.choices[0].finish_reason).toBe("stop");
    expect(stableReply).toBe(session.projectedTurns?.[0].interviewerText);
    expect(session.projectedTurns).toHaveLength(1);
    expect(session.projectedTurns?.[0].candidateText).toBe(corrected);
    expect(session.session.history.filter((message) => message.role === "candidate")).toHaveLength(1);
    expect(session.turnSeq).toBe(1);

    const replayedRetry = await spokenText(
      await customLlmPOST(
        request(
          modelBody(started.sessionId, "call-1", [
            ...history,
            { id: "user-turn-1", role: "user", content: partial },
            { role: "assistant", content: "" },
          ]),
          authHeader,
        ) as never,
      ),
    );
    const completed = stored(started.sessionId);
    const latencyCalls = info.mock.calls
      .filter(([label]) => label === "[case-custom-llm] latency")
      .map(([, payload]) => payload as Record<string, unknown>);

    expect(replayedRetry).toBe(stableReply);
    expect(replayedRetry).not.toBe("");
    expect(completed.turnSeq).toBe(1);
    expect(Object.values(completed.processedLogicalTurns ?? {})).toHaveLength(logicalTurnsBefore + 1);
    expect(Object.values(completed.processedLogicalTurns ?? {}).filter(
      (logical) => logical.candidateText === partial,
    )).toHaveLength(0);
    expect(Object.values(completed.processedLogicalTurns ?? {}).filter(
      (logical) => logical.candidateText === corrected,
    )).toHaveLength(1);
    expect(Object.values(completed.processedLogicalTurns ?? {}).every(
      (logical) => logical.result.spokenText.trim().length > 0,
    )).toBe(true);
    expect(latencyCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        responseKind: "suppressed_empty",
        spokenTextEmpty: true,
        logicalTurnCompleted: false,
        authoritativeResponsePresent: false,
      }),
      expect.objectContaining({
        responseKind: "authoritative_non_empty",
        spokenTextEmpty: false,
        logicalTurnCompleted: true,
        authoritativeResponsePresent: true,
      }),
      expect.objectContaining({
        responseKind: "replayed_non_empty",
        spokenTextEmpty: false,
        logicalTurnCompleted: true,
        authoritativeResponsePresent: true,
      }),
    ]));
    info.mockRestore();
  });

  it("keeps genuinely separate answers on distinct turn sequences", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.framework);

    expect(stored(started.sessionId).projectedTurns?.map((turn) => turn.turnSeq)).toEqual([1, 2]);
    expect(stored(started.sessionId).projectedTurns?.map((turn) => turn.candidateText)).toEqual([
      ANSWERS.clarification,
      ANSWERS.framework,
    ]);
  });

  it("does not lose a later answer when Vapi reuses a message id", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);

    history.push({ id: "reused-user-id", role: "user", content: ANSWERS.clarification });
    const firstReply = await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", history), authHeader) as never,
    ));
    history.push({ role: "assistant", content: firstReply });
    history.push({ id: "reused-user-id", role: "user", content: ANSWERS.framework });
    await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", history), authHeader) as never,
    ));

    const session = stored(started.sessionId);
    expect(session.turnSeq).toBe(2);
    expect(session.projectedTurns?.map((turn) => turn.candidateText)).toEqual([
      ANSWERS.clarification,
      ANSWERS.framework,
    ]);
  });

  it("replays the authoritative response for a late revision after commit", async () => {
    const started = await bootstrap();
    const baseHistory: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", baseHistory);
    const first = "What time horizon should we use?";
    const revised = `${first} Which brands and markets are in scope?`;

    const authoritative = await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", [
        ...baseHistory,
        { id: "logical-user-1", role: "user", content: first },
      ]), authHeader) as never,
    ));
    const late = await spokenText(await customLlmPOST(
      request(modelBody(started.sessionId, "call-1", [
        ...baseHistory,
        { id: "logical-user-1", role: "user", content: revised },
      ]), authHeader) as never,
    ));

    const session = stored(started.sessionId);
    expect(late).toBe(authoritative);
    expect(late).not.toBe("");
    expect(session.turnSeq).toBe(1);
    expect(session.projectedTurns).toHaveLength(1);
    expect(session.projectedTurns?.[0].candidateText).toBe(first);
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
      "Those are useful clarifications. The case does not specify a fixed profitability horizon, so use a three-year assessment horizon as a transparent working assumption. Beautify is a global, multi-brand business; for this interview, assume the initial scope covers its major brands and priority markets. Assume Beautify bears the technology, training, and ongoing operating costs; the case does not assign those costs to retail partners. Unless you have another clarification, please walk me through how you would structure the problem.",
    );
    const frameworkReply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      ANSWERS.framework,
    );
    expect(frameworkReply).toContain("That is a workable structure.");
    expect(frameworkReply).toContain("Imagine a current customer who shops in-store");
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.analysis)).toBe(
      "You’ve identified the key customer needs. Now let’s test the economics and market evidence, one exhibit at a time.",
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
      "We’ve grounded the opportunity in the exhibits. What is the strongest argument against the shift, and how would you address it?",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.pressure_test)).toBe(
      "Bring the analysis together in a concise final recommendation, including the main evidence, risks, and next steps.",
    );
    expect(await sendTurn(started.sessionId, "call-1", history, ANSWERS.recommendation)).toBe(
      "Thank you. That concludes the case. Your score is ready on screen.",
    );
  });

  it("acknowledges covered framework branches before applying the existing FSM probe", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    const answer = "I would look at demand, economics, competition, and implementation risks.";
    const reply = await sendTurn(started.sessionId, "call-1", history, answer);
    const session = stored(started.sessionId);
    const projected = session.projectedTurns?.at(-1);

    expect(reply).toContain("external demand, competition, and channel dynamics");
    expect(reply).toContain("internal capabilities, customer experience, and brand fit");
    expect(reply).toContain("financial viability and downside risk");
    expect(reply).toContain("Separate the external market and channel questions");
    expect(projected).toMatchObject({ stage: "framework", action: "probe" });
    expect(session.session.fsm_state).toBe("framework");
  });

  it("advances the supplied complete Framework without requiring a hypothesis label", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    const reply = await sendTurn(started.sessionId, "call-1", history, COMPLETE_FRAMEWORK);
    const session = stored(started.sessionId);

    expect(session.session.fsm_state).toBe("analysis");
    expect(session.projectedTurns?.at(-1)).toMatchObject({
      stage: "analysis",
      action: "advance",
    });
    expect(reply).toContain("That is a workable structure.");
    expect(reply).not.toContain("Separate the external market and channel questions");
  });

  it("does not repeat a Framework objective after the candidate answers it", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await sendTurn(started.sessionId, "call-1", history, ANSWERS.clarification);

    const first = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I would structure an external branch around demand and competitors, then test investment cost and payback.",
    );
    expect(first).toContain("internal feasibility");
    expect(stored(started.sessionId).lastProbeObjective?.id).toBe("framework:group:internal");

    const second = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "Internally, I would assess brand fit, customer experience, technology and data capability, consultant training, and the operating model.",
    );
    const session = stored(started.sessionId);

    expect(session.session.fsm_state).toBe("analysis");
    expect(session.lastProbeObjective).toBeNull();
    expect(second).not.toContain("Add Beautify's internal feasibility");

    const fresh = await bootstrap();
    expect(stored(fresh.sessionId).lastProbeObjective).toBeUndefined();
  });

  it("replaces a satisfied Framework objective with a different missing objective", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    await sendTurn(started.sessionId, "call-1", history, "I’m ready to structure my approach");

    const first = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I would structure two branches around customer demand and competitors.",
    );
    expect(first).toContain("internal feasibility");
    expect(stored(started.sessionId).lastProbeObjective?.id).toBe("framework:group:internal");

    const second = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "Internally, I would assess brand fit, technology capability, consultant training, and the operating model.",
    );
    const session = stored(started.sessionId);

    expect(session.session.fsm_state).toBe("framework");
    expect(session.lastProbeObjective?.id).toBe("framework:group:economics");
    expect(second).toContain("financial-viability branch");
    expect(second).not.toContain("Add Beautify's internal feasibility");
  });

  it("acknowledges frustration and releases a previously satisfied Framework without scoring it", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    const current = stored(started.sessionId);
    redisStore.set(`voice-session:${started.sessionId}`, {
      value: {
        ...current,
        session: {
          ...current.session,
          fsm_state: "framework",
          history: [
            { role: "candidate", stage: "framework", text: COMPLETE_FRAMEWORK },
            { role: "interviewer", stage: "framework", text: "Separate external and internal factors.", action: "probe" },
          ],
        },
        lastProbeObjective: {
          id: "framework:organization",
          stage: "framework",
          prompt: "Separate the external market and channel questions from Beautify's internal feasibility and economics.",
          acknowledgement: "you already separated the external and internal branches",
          requiredGroupId: null,
          coveredConcepts: [],
        },
      },
    });

    const reply = await sendTurn(started.sessionId, "call-1", history, "I already answered that");
    const session = stored(started.sessionId);

    expect(reply).toBe(
      "You’re right—you already separated the external and internal branches. Let’s continue with the analysis.",
    );
    expect(session.session.fsm_state).toBe("analysis");
    expect(session.session.history).toHaveLength(2);
    expect(session.turnSeq).toBe(0);
    expect(session.projectedTurns).toEqual([]);
  });

  it("does not let frustration advance insufficient prior Framework evidence", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    await confirmReadiness(started.sessionId, "call-1", history);
    await sendTurn(started.sessionId, "call-1", history, "I’m ready to structure my approach");
    await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I would look at customer demand.",
    );
    const before = stored(started.sessionId);

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "I already answered that",
    );
    const after = stored(started.sessionId);

    expect(reply).toBe("I understand. Let’s focus on the current question.");
    expect(after.session.fsm_state).toBe("framework");
    expect(after.turnSeq).toBe(before.turnSeq);
    expect(after.session.history).toEqual(before.session.history);
    expect(after.projectedTurns).toEqual(before.projectedTurns);
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
      "Those are useful clarifications. The case does not specify a fixed profitability horizon, so use a three-year assessment horizon as a transparent working assumption. Do you have another clarification, or are you ready to structure your approach?",
    );
    expect(stored(started.sessionId).session.fsm_state).toBe("clarification");
    expect(stored(started.sessionId).projectedTurns?.[0]).toMatchObject({
      stage: "clarification",
      action: "probe",
      interviewerText: reply,
    });
  });

  it("frames unsupported clarification facts as assumptions instead of inventing data", async () => {
    const started = await bootstrap();
    const history: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];

    const reply = await sendTurn(
      started.sessionId,
      "call-1",
      history,
      "What is the exact market size, growth rate, and revenue target for the priority markets?",
    );

    expect(reply).toContain("The case does not provide an exact figure");
    expect(reply).toContain("state a reasonable assumption rather than inventing data");
    expect(reply).not.toMatch(/€|\$|\b\d+(?:\.\d+)?%\b/);
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
