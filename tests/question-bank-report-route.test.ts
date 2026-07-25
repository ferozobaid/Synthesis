import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: any; ex?: number }>(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    async set(key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) {
      if (opts?.nx && redisStore.has(key)) return null;
      redisStore.set(key, { value, ex: opts?.ex });
      return "OK";
    }
    async get(key: string) { return redisStore.get(key)?.value ?? null; }
    async del(key: string) { redisStore.delete(key); }
    async eval(_script: string, keys: string[], args: unknown[]) {
      const entry = redisStore.get(keys[0]);
      if (args.length === 4) {
        const current = entry?.value;
        if (!current || Number(current.reportAttempt ?? -1) !== Number(args[0])) return 0;
        if (String(current.reportFencingToken ?? "") !== String(args[1])) return 0;
        redisStore.set(keys[0], { value: JSON.parse(String(args[2])), ex: Number(args[3]) });
        return 1;
      }
      if (entry?.value === args[0]) { redisStore.delete(keys[0]); return 1; }
      return 0;
    }
  },
}));

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { POST as reportPOST } from "@/app/api/vapi/case/report/route";
import { GET as reportGET } from "@/app/api/case/report/[sessionId]/route";
import { questionAnchorManifest } from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "qb-report-secret";
const CASE_ID = "data_analyst_technical_round";
const ASSISTANT = "asst-da-technical-round";
const manifest = questionAnchorManifest(CASE_ID, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
const ORDER = manifest.order;
const ANSWER = "I would filter valid orders, join customers, aggregate revenue by month and region, and reconcile totals with a duplicate check.";

function request(url: string, body: unknown, auth = true): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${SECRET}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function bootstrap() {
  const res = await sessionPOST(request("http://localhost/api/vapi/session", { module: "case", caseId: CASE_ID }) as any);
  return { res, json: (await res.json()) as any };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function transcriptMessages(answered: string[] = ORDER) {
  const messages: Array<{ role: string; message: string }> = [
    { role: "system", message: "do not persist" },
    { role: "assistant", message: "Welcome, say ready to begin." },
    { role: "user", message: "ready" },
  ];
  for (const id of ORDER) {
    messages.push({ role: "assistant", message: `${manifest.anchors[id]} Please walk me through it.` });
    messages.push({ role: "user", message: answered.includes(id) ? ANSWER : "okay" });
  }
  return messages;
}

function reportPayload(sessionId: string, callId = "call-1", assistantId = ASSISTANT, answered: string[] = ORDER) {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: callId, assistantId },
      artifact: { variableValues: { sessionId, caseId: CASE_ID }, messages: transcriptMessages(answered) },
    },
  };
}

async function readReport(sessionId: string, token: string) {
  const res = await reportGET(
    new Request(`http://localhost/api/case/report/${sessionId}`, { headers: { "x-report-token": token } }) as any,
    { params: { sessionId } },
  );
  return { res, json: (await res.json()) as any };
}

beforeEach(() => {
  redisStore.clear();
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID = ASSISTANT;
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("question-bank round — native bootstrap resolves the dedicated assistant", () => {
  it("returns the server-resolved assistant id and snapshots it (browser cannot override)", async () => {
    const { res, json } = await bootstrap();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ architecture: "vapi_native", assistantId: ASSISTANT, reportStatus: "pending" });
    const record = stored(json.sessionId);
    expect(record).toMatchObject({
      expectedAssistantId: ASSISTANT,
      assistantConfigVersion: "data-analyst-technical-round-assistant-v1",
      stageAnchorVersion: CASE_VOICE_QUESTION_ANCHOR_VERSION,
      caseTrack: "technical",
      caseRole: "data_analyst",
    });
  });

  it("fails closed (503) when the round assistant id is unset", async () => {
    delete process.env.VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID;
    const { res } = await bootstrap();
    expect(res.status).toBe(503);
    expect(redisStore.size).toBe(0);
  });
});

describe("question-bank round — end-to-end report", () => {
  it("scores per question and exposes a candidate-safe report via the token", async () => {
    const { json } = await bootstrap();
    // Polling before the webhook: pending.
    const pending = await readReport(json.sessionId, json.reportToken);
    expect(pending.json.status).toBe("pending");

    const webhook = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    expect(webhook.status).toBe(200);
    expect(stored(json.sessionId)).toMatchObject({ reportStatus: "done", authoritativeCallId: "call-1" });

    const done = await readReport(json.sessionId, json.reportToken);
    expect(done.json.status).toBe("done");
    expect(done.json.evaluatorType).toBe("technical_question_bank");
    expect(done.json.partial).toBe(false);
    expect(done.json.score.dimension_scores).toHaveLength(5);
    expect(done.json.score.dimension_scores.map((d: any) => d.dimension)).toEqual(ORDER);
    expect(typeof done.json.score.overall).toBe("number");
    // No answer-key / rubric / transcript material leaks into the projection.
    const serialized = JSON.stringify(done.json);
    expect(serialized).not.toContain("acceptable_alternatives");
    expect(serialized).not.toContain("red_flags");
  });

  it("rejects a webhook from the wrong assistant (no binding, no score)", async () => {
    const { json } = await bootstrap();
    const res = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId, "call-x", "wrong-assistant")) as any);
    expect(res.status).toBe(200);
    expect(stored(json.sessionId).authoritativeCallId).toBeNull();
    expect(stored(json.sessionId).reportStatus).toBe("pending");
  });

  it("rejects an unauthenticated webhook before any mutation", async () => {
    const { json } = await bootstrap();
    const before = JSON.stringify(stored(json.sessionId));
    const res = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId), false) as any);
    expect(res.status).toBe(401);
    expect(JSON.stringify(stored(json.sessionId))).toBe(before);
  });

  it("produces a safe partial report when some questions are unanswered", async () => {
    const { json } = await bootstrap();
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId, "call-1", ASSISTANT, [ORDER[0], ORDER[1]])) as any);
    const done = await readReport(json.sessionId, json.reportToken);
    expect(done.json.status).toBe("done");
    expect(done.json.partial).toBe(true);
    expect(done.json.score.overall).toBeNull();
  });

  it("refresh recovery: a fresh reader with the same token re-reads the finished report", async () => {
    const { json } = await bootstrap();
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    const reread = await readReport(json.sessionId, json.reportToken);
    expect(reread.json.status).toBe("done");
    expect(reread.json.score.dimension_scores).toHaveLength(5);
    // A wrong token is refused.
    const bad = await readReport(json.sessionId, "wrong-token");
    expect(bad.res.status).toBe(404);
  });
});
