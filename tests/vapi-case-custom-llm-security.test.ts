import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  redisStore,
  completeMock,
  buildCaseLivePacketMock,
  requestCacheKeyMock,
  logicalTurnKeyMock,
  respondToCaseMock,
  evaluateResponseMock,
  scoreCaseMock,
  controllerMock,
  controllerWarningMock,
} = vi.hoisted(() => ({
  redisStore: new Map<string, { value: unknown; ex?: number }>(),
  completeMock: vi.fn(),
  buildCaseLivePacketMock: vi.fn(),
  requestCacheKeyMock: vi.fn(),
  logicalTurnKeyMock: vi.fn(),
  respondToCaseMock: vi.fn(),
  evaluateResponseMock: vi.fn(),
  scoreCaseMock: vi.fn(),
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

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, complete: completeMock };
});

vi.mock("@/lib/voice/case-live-packet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-live-packet")>();
  buildCaseLivePacketMock.mockImplementation(actual.buildCaseLivePacket);
  return { ...actual, buildCaseLivePacket: buildCaseLivePacketMock };
});

vi.mock("@/lib/voice/case-turn-cache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-turn-cache")>();
  requestCacheKeyMock.mockImplementation(actual.buildCaseVoiceRequestCacheKey);
  logicalTurnKeyMock.mockImplementation(actual.buildCaseVoiceLogicalTurnKey);
  return {
    ...actual,
    buildCaseVoiceRequestCacheKey: requestCacheKeyMock,
    buildCaseVoiceLogicalTurnKey: logicalTurnKeyMock,
  };
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

import { POST as chatPOST } from "@/app/api/vapi/case/chat/completions/route";
import { CASE_VOICE_LLM_VERSION } from "@/lib/voice/case-interviewer-mode";
import type { CaseState } from "@/lib/types";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "case-security-secret";
const AUTH = { authorization: `Bearer ${SECRET}` };
const AIRPORT = "airport_profitability";
const RETIRED_RESTART_RESPONSE =
  "This interview was created with an older version of the Case Simulator. Please end this call and start a new interview.";

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

function body(
  sessionId: string,
  callId: string,
  messages: ChatMessage[],
  caseId = AIRPORT,
) {
  return {
    model: "synthesis-case-fsm",
    stream: true,
    messages,
    metadata: { sessionId, caseId },
    call: { id: callId },
  };
}

function seedSession(input: {
  sessionId: string;
  caseId?: string;
  stage?: CaseState;
  complete?: boolean;
  callId?: string | null;
  architecture?: "custom_llm" | "vapi_native";
}): CaseVoiceSession {
  const caseId = input.caseId ?? AIRPORT;
  const stage = input.stage ?? "clarification";
  const current: CaseVoiceSession = {
    module: "case",
    caseId,
    architecture: input.architecture,
    interviewerMode: "llm",
    interviewerVersion: CASE_VOICE_LLM_VERSION,
    liveStatus: "active",
    concludedAt: null,
    session: {
      id: input.sessionId,
      user_id: "security-user",
      case_id: caseId,
      fsm_state: stage,
      history: [],
      stage_attempts: {},
      hints_used: {},
      exhibits_revealed: [],
      complete: input.complete ?? false,
    },
    openingText: "Are you ready to begin?",
    readinessStatus: "confirmed",
    readinessConfirmedAt: null,
    conversationStatus: "active",
    callId: input.callId ?? null,
    turnSeq: 0,
    responseSeq: 0,
    score: null,
    processedModelRequests: {},
    processedLogicalTurns: {},
    pendingCandidate: null,
    probedAnswerHashes: {},
    stageProbeCounts: {},
    projectedTurns: [],
    createdAt: "2026-07-21T12:00:00.000Z",
    updatedAt: "2026-07-21T12:00:00.000Z",
  };
  redisStore.set(`voice-session:${input.sessionId}`, { value: current });
  return current;
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function validMessages(candidateText = "I would like to clarify the objective."): ChatMessage[] {
  return [
    { role: "assistant", content: "Please begin." },
    { role: "user", content: candidateText },
  ];
}

async function spokenText(response: Response): Promise<string> {
  const chunks = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice(6)));
  return chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "").join("");
}

function expectNoCaseExecution(): void {
  expect(completeMock).not.toHaveBeenCalled();
  expect(buildCaseLivePacketMock).not.toHaveBeenCalled();
  expect(requestCacheKeyMock).not.toHaveBeenCalled();
  expect(logicalTurnKeyMock).not.toHaveBeenCalled();
  expect(controllerMock).not.toHaveBeenCalled();
  expect(controllerWarningMock).not.toHaveBeenCalled();
  expect(evaluateResponseMock).not.toHaveBeenCalled();
  expect(respondToCaseMock).not.toHaveBeenCalled();
  expect(scoreCaseMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  redisStore.clear();
  completeMock.mockReset();
  buildCaseLivePacketMock.mockClear();
  requestCacheKeyMock.mockClear();
  logicalTurnKeyMock.mockClear();
  respondToCaseMock.mockReset();
  evaluateResponseMock.mockReset();
  scoreCaseMock.mockReset();
  controllerMock.mockReset();
  controllerWarningMock.mockReset();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  delete process.env.VAPI_CASE_LATENCY_DEBUG;
});

describe("Case Custom LLM endpoint security", () => {
  it("rejects a native session before cache identity, packet, or model work", async () => {
    const sessionId = "native-session-wrong-endpoint";
    seedSession({ sessionId, architecture: "vapi_native" });
    const before = structuredClone(stored(sessionId));
    const response = await chatPOST(request(
      body(sessionId, "call-1", validMessages()),
      AUTH,
    ) as never);
    expect(response.status).toBe(409);
    expect(stored(sessionId)).toEqual(before);
    expectNoCaseExecution();
  });

  it("rejects missing authentication without mutation or Case execution", async () => {
    const sessionId = "airport-missing-auth";
    seedSession({ sessionId });
    const before = structuredClone(stored(sessionId));

    const response = await chatPOST(request(body(sessionId, "call-1", validMessages())) as never);

    expect(response.status).toBe(401);
    expect(stored(sessionId)).toEqual(before);
    expectNoCaseExecution();
  });

  it("rejects incorrect authentication without mutation or Case execution", async () => {
    const sessionId = "airport-bad-auth";
    seedSession({ sessionId });
    const before = structuredClone(stored(sessionId));

    const response = await chatPOST(request(
      body(sessionId, "call-1", validMessages()),
      { authorization: "Bearer incorrect-secret" },
    ) as never);

    expect(response.status).toBe(401);
    expect(stored(sessionId)).toEqual(before);
    expectNoCaseExecution();
  });

  it("rejects a missing session safely without Case execution", async () => {
    const response = await chatPOST(request(
      body("missing-airport-session", "call-1", validMessages()),
      AUTH,
    ) as never);

    expect(response.status).toBe(404);
    expect(redisStore.has("voice-session:missing-airport-session")).toBe(false);
    expectNoCaseExecution();
  });

  it("rejects a non-Case session before retirement or Case execution", async () => {
    const sessionId = "behavioural-session-with-retired-case-id";
    const nonCaseSession = {
      module: "behavioural",
      caseId: "beautify",
      marker: "must remain unchanged",
    };
    redisStore.set(`voice-session:${sessionId}`, { value: nonCaseSession });

    const response = await chatPOST(request(
      body(sessionId, "call-1", validMessages(), "beautify"),
      AUTH,
    ) as never);

    expect(response.status).toBe(404);
    expect(redisStore.get(`voice-session:${sessionId}`)?.value).toEqual(nonCaseSession);
    expectNoCaseExecution();
  });

  it("rejects an Airport callId mismatch before packet or model execution", async () => {
    const sessionId = "airport-call-mismatch";
    seedSession({ sessionId, callId: "historical-call" });
    const before = structuredClone(stored(sessionId));

    const response = await chatPOST(request(
      body(sessionId, "different-call", validMessages()),
      AUTH,
    ) as never);

    expect(response.status).toBe(409);
    expect(stored(sessionId)).toEqual(before);
    expectNoCaseExecution();
  });

  it("rejects whitespace-only candidate input under the existing safe contract", async () => {
    const sessionId = "airport-empty-candidate";
    seedSession({ sessionId });
    const before = structuredClone(stored(sessionId));

    const response = await chatPOST(request(
      body(sessionId, "call-1", validMessages("   ")),
      AUTH,
    ) as never);

    expect(response.status).toBe(400);
    expect(stored(sessionId)).toEqual(before);
    expectNoCaseExecution();
  });
});

describe("retired Case Voice sessions", () => {
  it.each([
    ["active", "clarification", false, null],
    ["complete", "recommendation", true, null],
    ["scoring", "scoring", false, null],
    ["historical-call", "clarification", false, "old-call-id"],
  ] as const)(
    "returns restart speech for an %s Beautify session before active validation",
    async (variant, stage, complete, historicalCallId) => {
      const sessionId = `retired-beautify-${variant}`;
      seedSession({
        sessionId,
        caseId: "beautify",
        stage,
        complete,
        callId: historicalCallId,
      });
      const before = structuredClone(stored(sessionId));
      const previousDebug = process.env.VAPI_CASE_LATENCY_DEBUG;
      process.env.VAPI_CASE_LATENCY_DEBUG = "true";
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        const response = await chatPOST(request(
          body(sessionId, "new-call-id", validMessages("Where were we?"), "beautify"),
          AUTH,
        ) as never);
        const text = await spokenText(response);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        expect(text).toBe(RETIRED_RESTART_RESPONSE);
        expect(text.trim()).not.toBe("");
        expect(stored(sessionId)).toEqual(before);
        expectNoCaseExecution();

        const latency = consoleInfo.mock.calls.find((call) => {
          const details = call[1] as Record<string, unknown> | undefined;
          return call[0] === "[case-custom-llm] latency" && details?.statusCode === 200;
        })?.[1] as Record<string, unknown> | undefined;
        expect(latency).toMatchObject({
          interviewerCalls: 0,
          controllerMs: 0,
          evaluatorMs: 0,
          respondToCaseMs: 0,
          scoringMs: 0,
          logicalResponseReplay: false,
          authoritativeResponseSource: "committed",
        });
      } finally {
        consoleInfo.mockRestore();
        if (previousDebug === undefined) delete process.env.VAPI_CASE_LATENCY_DEBUG;
        else process.env.VAPI_CASE_LATENCY_DEBUG = previousDebug;
      }
    },
  );
});
