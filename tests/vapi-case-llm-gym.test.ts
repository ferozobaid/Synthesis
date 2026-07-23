import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redisStore,
  completeMock,
  respondToCaseMock,
  evaluateResponseMock,
  scoreCaseMock,
  controllerMock,
  controllerWarningMock,
  stabilizationMock,
  deterministicTriageMock,
  assessFrameworkMock,
} = vi.hoisted(() => ({
  redisStore: new Map<string, { value: unknown; ex?: number }>(),
  completeMock: vi.fn(),
  respondToCaseMock: vi.fn(),
  evaluateResponseMock: vi.fn(),
  scoreCaseMock: vi.fn(),
  controllerMock: vi.fn(),
  controllerWarningMock: vi.fn(),
  stabilizationMock: vi.fn(),
  deterministicTriageMock: vi.fn(),
  assessFrameworkMock: vi.fn(),
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

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, complete: completeMock };
});
vi.mock("@/lib/fsm/case-evaluator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fsm/case-evaluator")>();
  return { ...actual, evaluateResponse: evaluateResponseMock };
});
vi.mock("@/lib/fsm/case-scoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fsm/case-scoring")>();
  return { ...actual, scoreCase: scoreCaseMock };
});
vi.mock("@/lib/fsm/case-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fsm/case-runner")>();
  return { ...actual, respondToCase: respondToCaseMock };
});
vi.mock("@/lib/voice/case-turn-controller", () => ({
  runCaseTurnController: controllerMock,
  warnIfCaseTurnControllerUsesMocks: controllerWarningMock,
}));
vi.mock("@/lib/voice/case-turn-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-turn-plan")>();
  stabilizationMock.mockImplementation(actual.caseTurnStabilizationKind);
  deterministicTriageMock.mockImplementation(actual.deterministicCaseTurnTriage);
  return {
    ...actual,
    caseTurnStabilizationKind: stabilizationMock,
    deterministicCaseTurnTriage: deterministicTriageMock,
  };
});
vi.mock("@/lib/fsm/case-framework", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fsm/case-framework")>();
  assessFrameworkMock.mockImplementation(actual.assessCaseFramework);
  return { ...actual, assessCaseFramework: assessFrameworkMock };
});

import { GET as catalogGET } from "@/app/api/case/catalog/route";
import { POST as chatPOST } from "@/app/api/vapi/case/chat/completions/route";
import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import type { CaseInterviewerDecision } from "@/lib/voice/case-interviewer";
import type { CaseState } from "@/lib/types";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "gym-route-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };
const GYM = "gcc_premium_gym_market_entry";
const AIRPORT = "airport_profitability";

interface ChatMessage { id?: string; role: "assistant" | "user"; content: string }

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/vapi/case/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function sessionRequest(body: unknown): Request {
  return new Request("http://localhost/api/vapi/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(sessionId: string, callId: string, messages: ChatMessage[], caseId: string = GYM) {
  return {
    model: "synthesis-case-fsm",
    stream: true,
    messages,
    metadata: { sessionId, caseId },
    call: { id: callId },
  };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

async function bootstrap(caseId: string = GYM) {
  const response = await sessionPOST(sessionRequest({ module: "case", caseId }) as never);
  expect(response.status).toBe(200);
  return await response.json() as { sessionId: string; projectionToken: string; openingPrompt: string; caseId: string; caseTitle: string };
}

function modelDecision(overrides: Partial<CaseInterviewerDecision> = {}): CaseInterviewerDecision {
  return {
    spokenResponse: "Thank you. Please continue.",
    candidateAction: "off_topic",
    proposedStage: null,
    requestedFactIds: [],
    requestedExhibitId: null,
    shouldProbe: false,
    confidence: 0.95,
    ...overrides,
  };
}

function queueDecision(overrides: Partial<CaseInterviewerDecision> = {}): void {
  completeMock.mockResolvedValueOnce(JSON.stringify(modelDecision(overrides)));
}

async function spokenText(response: Response): Promise<string> {
  expect(response.status).toBe(200);
  const chunks = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  return chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("");
}

async function turn(
  sessionId: string,
  callId: string,
  messages: ChatMessage[],
  candidateText: string,
): Promise<string> {
  messages.push({ role: "user", content: candidateText });
  const text = await spokenText(await chatPOST(request(body(sessionId, callId, messages), authHeader) as never));
  messages.push({ role: "assistant", content: text });
  return text;
}

function setStage(sessionId: string, stage: CaseState, exhibits: string[] = []): void {
  const current = stored(sessionId);
  redisStore.set(`voice-session:${sessionId}`, {
    value: {
      ...current,
      session: {
        ...current.session,
        fsm_state: stage,
        history: [],
        stage_attempts: {},
        hints_used: {},
        exhibits_revealed: exhibits,
        complete: false,
      },
      callId: null,
      readinessStatus: "confirmed",
      conversationStatus: "active",
      liveStatus: "active",
      concludedAt: null,
      pendingCandidate: null,
      processedModelRequests: {},
      processedLogicalTurns: {},
      projectedTurns: [],
      turnSeq: 0,
      responseSeq: 0,
      score: null,
      probedAnswerHashes: {},
      stageProbeCounts: {},
    },
  });
}

function expectNoLegacyLiveCalls(): void {
  expect(respondToCaseMock).not.toHaveBeenCalled();
  expect(evaluateResponseMock).not.toHaveBeenCalled();
  expect(scoreCaseMock).not.toHaveBeenCalled();
  expect(controllerMock).not.toHaveBeenCalled();
  expect(assessFrameworkMock).not.toHaveBeenCalled();
}

function latestLivePacket(): string {
  return JSON.stringify(JSON.parse(completeMock.mock.calls.at(-1)?.[0] ?? "{}").livePacket);
}

beforeEach(() => {
  redisStore.clear();
  completeMock.mockReset();
  respondToCaseMock.mockReset();
  evaluateResponseMock.mockReset();
  scoreCaseMock.mockReset();
  controllerMock.mockReset();
  controllerWarningMock.mockReset();
  stabilizationMock.mockClear();
  deterministicTriageMock.mockClear();
  assessFrameworkMock.mockClear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "false";
  process.env.CASE_VOICE_INTERVIEWER_MODE = "llm";
  process.env.CASE_VOICE_REVISION_WINDOW_MS = "0";
  delete process.env.VERCEL_ENV;
  delete process.env.CASE_VOICE_CONTROLLER_MODE;
});

describe("Preview LLM catalog", () => {
  it("exposes only id, title, and description for both selectable cases in llm mode", async () => {
    const response = await catalogGET();
    expect(response.status).toBe(200);
    const { cases } = await response.json() as { cases: Array<Record<string, unknown>> };
    expect(cases.map((entry) => entry.id)).toEqual([AIRPORT, GYM]);
    for (const entry of cases) {
      expect(Object.keys(entry).sort()).toEqual(["description", "id", "title"]);
    }
  });

  it("always presents exactly the two cases with no Beautify or Diconsa options", async () => {
    for (const mode of ["llm", "legacy", "production"]) {
      process.env.CASE_VOICE_INTERVIEWER_MODE = mode;
      const { cases } = await (await catalogGET()).json() as { cases: Array<{ id: string }> };
      expect(cases.map((entry) => entry.id)).toEqual([AIRPORT, GYM]);
      expect(JSON.stringify(cases)).not.toContain("beautify");
      expect(JSON.stringify(cases)).not.toContain("diconsa");
    }
  });
});

function seedRetiredSession(sessionId: string): void {
  redisStore.set(`voice-session:${sessionId}`, {
    value: {
      module: "case",
      caseId: "beautify",
      interviewerMode: "llm",
      interviewerVersion: "case-voice-llm-v1",
      liveStatus: "active",
      concludedAt: null,
      session: {
        id: sessionId,
        user_id: "u",
        case_id: "beautify",
        fsm_state: "clarification",
        history: [],
        stage_attempts: {},
        hints_used: {},
        exhibits_revealed: [],
        complete: false,
      },
      openingText: "Older opening.",
      readinessStatus: "confirmed",
      readinessConfirmedAt: null,
      conversationStatus: "active",
      callId: null,
      turnSeq: 0,
      responseSeq: 0,
      score: null,
      processedModelRequests: {},
      processedLogicalTurns: {},
      pendingCandidate: null,
      probedAnswerHashes: {},
      stageProbeCounts: {},
      projectedTurns: [],
      createdAt: "2026-07-20T12:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
    },
  });
}

describe("Retired (older) Case Simulator sessions", () => {
  it("returns the safe restart response without a Haiku call or packet-registry construction", async () => {
    const sessionId = "old-beautify-session";
    seedRetiredSession(sessionId);
    const messages: ChatMessage[] = [
      { role: "assistant", content: "Older opening." },
      { role: "user", content: "Where were we?" },
    ];
    // buildCaseLivePacket would throw for a beautify record, so a clean 200 with
    // the restart text proves the packet registry was never reached.
    const response = await chatPOST(
      request(body(sessionId, "call-old", messages, "beautify"), authHeader) as never,
    );
    const text = await spokenText(response);
    expect(text).toContain("older version of the Case Simulator");
    expect(text).toContain("start a new interview");
    expect(completeMock).not.toHaveBeenCalled();
    // No silent migration or continuation: the stored session is untouched.
    expect(stored(sessionId).caseId).toBe("beautify");
    expect(stored(sessionId).projectedTurns).toEqual([]);
    expect(stored(sessionId).session.fsm_state).toBe("clarification");
    expectNoLegacyLiveCalls();
  });
});

describe("Preview LLM Gym case selection and snapshot", () => {
  it("selects and immutably snapshots the Gym case", async () => {
    const started = await bootstrap(GYM);
    expect(started.caseId).toBe(GYM);
    expect(started.caseTitle).toBe("GCC Premium Gym Market Entry");
    expect(stored(started.sessionId)).toMatchObject({
      caseId: GYM,
      interviewerMode: "llm",
      selectedCaseTitle: "GCC Premium Gym Market Entry",
    });
  });

  it("also selects the Airport case independently", async () => {
    const started = await bootstrap(AIRPORT);
    expect(started.caseId).toBe(AIRPORT);
    expect(stored(started.sessionId).caseId).toBe(AIRPORT);
  });

  it("fails closed on missing, unknown, and non-LLM case ids in llm mode", async () => {
    const missing = await sessionPOST(sessionRequest({ module: "case" }) as never);
    expect(missing.status).toBe(400);
    for (const caseId of ["nope", "beautify", "diconsa"]) {
      const response = await sessionPOST(sessionRequest({ module: "case", caseId }) as never);
      expect(response.status).toBe(400);
    }
  });

  it("rejects a chat turn whose metadata names a different case than the session", async () => {
    const started = await bootstrap(GYM);
    setStage(started.sessionId, "clarification");
    const messages: ChatMessage[] = [{ role: "assistant", content: "What would you like to clarify?" }];
    messages.push({ role: "user", content: "A question." });
    const response = await chatPOST(
      request(body(started.sessionId, "call-mismatch", messages, AIRPORT), authHeader) as never,
    );
    expect(response.status).toBe(409);
    expect(completeMock).not.toHaveBeenCalled();
  });
});

describe("Preview LLM Gym live interview", () => {
  it("opens on the European premium gym and GCC entry with no Airport or Diconsa content", async () => {
    const started = await bootstrap(GYM);
    const messages: ChatMessage[] = [{ role: "assistant", content: started.openingPrompt }];
    queueDecision({ candidateAction: "readiness_confirmed", confidence: 0.8 });
    const ready = await turn(started.sessionId, "call-ready", messages, "I’m ready to begin.");
    expect(ready).toContain("European premium gym chain");
    expect(ready).toContain("Gulf Cooperation Council");
    expect(ready.toLowerCase()).not.toContain("airport");
    expect(ready.toLowerCase()).not.toContain("aeronautical");
    expect(ready).not.toContain("Diconsa");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expectNoLegacyLiveCalls();
  });

  it("keeps the Dubai inputs hidden before reveal and reveals the exhibit once", async () => {
    const started = await bootstrap(GYM);
    setStage(started.sessionId, "data_reveal");
    const messages: ChatMessage[] = [{ role: "assistant", content: "Let’s size the market." }];
    queueDecision({ candidateAction: "analysis_answer", confidence: 0.8 });
    await turn(started.sessionId, "call-size", messages, "Let me set assumptions first.");
    const packetBefore = latestLivePacket();
    expect(packetBefore).not.toContain("3500000");
    expect(packetBefore).not.toContain("avg_monthly_membership");

    queueDecision({
      candidateAction: "analysis_answer",
      requestedExhibitId: "exhibit_dubai_premium_inputs",
      confidence: 0.9,
    });
    const reveal = await turn(started.sessionId, "call-size", messages, "Please share the inputs.");
    expect(reveal).toContain("Dubai Premium Gym Market Inputs");
    expect(stored(started.sessionId).session.exhibits_revealed).toEqual(["exhibit_dubai_premium_inputs"]);

    queueDecision({
      candidateAction: "analysis_answer",
      requestedExhibitId: "exhibit_dubai_premium_inputs",
      confidence: 1,
    });
    await turn(started.sessionId, "call-size", messages, "Show it again.");
    expect(stored(started.sessionId).session.exhibits_revealed).toEqual(["exhibit_dubai_premium_inputs"]);
    expectNoLegacyLiveCalls();
  });

  it.each([
    "The client needs 8 locations.",
    "It would need eight locations.",
    "Roughly eight sites are required.",
    "The market is about $56.7M.",
    "That is around $5.7 million of revenue.",
    "Each location earns about $720K a year.",
  ])("blocks the interviewer from stating the hidden answer: %s", async (spokenResponse) => {
    const started = await bootstrap(GYM);
    setStage(started.sessionId, "pressure_test");
    const messages: ChatMessage[] = [{ role: "assistant", content: "How many locations?" }];
    queueDecision({ candidateAction: "analysis_answer", spokenResponse, confidence: 0.85 });
    const text = await turn(started.sessionId, "call-protect", messages, "Let me work through it.");
    expect(text.trim()).not.toBe("");
    expect(text).not.toContain("8 location");
    expect(text).not.toContain("eight location");
    expect(text).not.toContain("56.7");
    expect(text).not.toContain("720");
    expect(stored(started.sessionId).session.fsm_state).toBe("pressure_test");
    expectNoLegacyLiveCalls();
  });

  it("lets a candidate-provided calculation advance when the interviewer does not restate it", async () => {
    const started = await bootstrap(GYM);
    setStage(started.sessionId, "pressure_test");
    const messages: ChatMessage[] = [{ role: "assistant", content: "How many locations?" }];
    queueDecision({
      candidateAction: "analysis_answer",
      proposedStage: "recommendation",
      spokenResponse: "That is a reasonable estimate. Let’s move to your recommendation.",
      confidence: 0.85,
    });
    await turn(
      started.sessionId,
      "call-calc",
      messages,
      "About $5.7 million at $720,000 per location is roughly 8 locations, which is aggressive but feasible.",
    );
    expect(stored(started.sessionId).session.fsm_state).toBe("recommendation");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expectNoLegacyLiveCalls();
  });

  it("concludes from Recommendation as unscored with score null and complete false", async () => {
    const started = await bootstrap(GYM);
    setStage(started.sessionId, "recommendation");
    const messages: ChatMessage[] = [{ role: "assistant", content: "Your recommendation?" }];
    queueDecision({
      candidateAction: "recommendation",
      proposedStage: "scoring",
      confidence: 0.9,
    });
    const text = await turn(started.sessionId, "call-reco", messages, "Enter the UAE first, then Saudi Arabia.");
    expect(text).toContain("score is not available yet");
    const current = stored(started.sessionId);
    expect(current.liveStatus).toBe("concluded_unscored");
    expect(current.session.complete).toBe(false);
    expect(current.score).toBeNull();
    expect(current.session.fsm_state).toBe("scoring");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expectNoLegacyLiveCalls();
  });
});
