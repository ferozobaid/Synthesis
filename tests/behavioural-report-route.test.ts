import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory Redis fake that honours SET NX (needed for the report lock).
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
    // Atomic compare-and-delete used by releaseLock (owner-token CAS).
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

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { POST as reportPOST } from "@/app/api/vapi/behavioural/report/route";
import { GET as reportGET } from "@/app/api/behavioural/report/[sessionId]/route";
import type { BehaviouralVoiceSession, VoiceSession } from "@/lib/voice/types";
import type { TranscriptMessage } from "@/lib/behavioural/transcript";

const SECRET = "test-secret";
const authHeader = { authorization: `Bearer ${SECRET}` };

function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/vapi/behavioural/report", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function stored(sessionId: string): BehaviouralVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as BehaviouralVoiceSession;
}

/** Build an end-of-call-report envelope around the given transcript messages. */
function reportPayload(sessionId: string | null, callId: string | null, messages: TranscriptMessage[]) {
  const artifact: Record<string, unknown> = { messages };
  if (sessionId) artifact.variableValues = { sessionId };
  const call: Record<string, unknown> = {};
  if (callId) call.id = callId;
  return { message: { type: "end-of-call-report", call, artifact } };
}

/** Bot asks each stored question in order; the candidate gives a short answer. */
function messagesFor(questions: { id: string; question: string }[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  questions.forEach((q, i) => {
    out.push({ role: "bot", message: `${i + 1}) ${q.question}` });
    out.push({ role: "user", message: `My answer to question ${i + 1}.` });
  });
  return out;
}

async function bootstrapBehavioural(): Promise<{ sessionId: string; reportToken: string }> {
  const res = await sessionPOST(
    new Request("http://localhost/api/vapi/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ module: "behavioural", jdText: "" }),
    }) as never,
  );
  const data = await res.json();
  return { sessionId: data.sessionId, reportToken: data.reportToken };
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.SYNTHESIS_USE_MOCKS = "true";
  delete process.env.VAPI_AUTH_DEBUG;
});

describe("POST /api/vapi/behavioural/report (end-of-call-report webhook)", () => {
  it("rejects a missing bearer token", async () => {
    const res = await reportPOST(makeReq(reportPayload("s", "c", [])) as never);
    expect(res.status).toBe(401);
  });

  it("scores the transcript and stores a done report", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const res = await reportPOST(
      makeReq(reportPayload(sessionId, "call_1", messagesFor(qs)), authHeader) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const s = stored(sessionId);
    expect(s.reportStatus).toBe("done");
    expect(s.processedCallId).toBe("call_1");
    expect(s.report?.answered).toBe(qs.length);
    expect(typeof s.report?.overall).toBe("number");
  });

  it("is idempotent on a duplicate delivery of the same call id", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const payload = reportPayload(sessionId, "call_dup", messagesFor(qs));
    await reportPOST(makeReq(payload, authHeader) as never);
    const first = stored(sessionId);
    await reportPOST(makeReq(payload, authHeader) as never); // replay
    const second = stored(sessionId);
    expect(second.reportStatus).toBe("done");
    expect(second.processedCallId).toBe("call_dup");
    // Not reprocessed into a different state.
    expect(second.updatedAt).toBe(first.updatedAt);
  });

  it("does not process when another delivery holds the lock", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    // Pre-acquire the lock for this session+call to simulate a concurrent worker.
    redisStore.set(`lock:report:${sessionId}:call_lock`, { value: "1" });
    const res = await reportPOST(
      makeReq(reportPayload(sessionId, "call_lock", messagesFor(qs)), authHeader) as never,
    );
    expect(res.status).toBe(200);
    expect(stored(sessionId).reportStatus).toBe("pending"); // untouched
  });

  it("reclaims a stale 'processing' lease (prior crash) and completes", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const rec = stored(sessionId);
    // Simulate a worker that set processing then crashed 200s ago.
    redisStore.set(`voice-session:${sessionId}`, {
      value: {
        ...rec,
        reportStatus: "processing",
        processingStartedAt: new Date(Date.now() - 200_000).toISOString(),
        processedCallId: "old_call",
      } as VoiceSession,
    });
    const res = await reportPOST(
      makeReq(reportPayload(sessionId, "new_call", messagesFor(qs)), authHeader) as never,
    );
    expect(res.status).toBe(200);
    const s = stored(sessionId);
    expect(s.reportStatus).toBe("done");
    expect(s.processedCallId).toBe("new_call");
  });

  it("safely no-ops with a missing sessionId", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const res = await reportPOST(
      makeReq(reportPayload(null, "call_x", messagesFor(qs)), authHeader) as never,
    );
    expect(res.status).toBe(200);
    expect(stored(sessionId).reportStatus).toBe("pending");
  });

  it("safely no-ops with a missing call id", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const res = await reportPOST(
      makeReq(reportPayload(sessionId, null, messagesFor(qs)), authHeader) as never,
    );
    expect(res.status).toBe(200);
    expect(stored(sessionId).reportStatus).toBe("pending");
  });

  it("safely no-ops on a non end-of-call-report event", async () => {
    const { sessionId } = await bootstrapBehavioural();
    const res = await reportPOST(
      makeReq(
        { message: { type: "status-update", call: { id: "c" }, artifact: { variableValues: { sessionId } } } },
        authHeader,
      ) as never,
    );
    expect(res.status).toBe(200);
    expect(stored(sessionId).reportStatus).toBe("pending");
  });

  it("safely no-ops when the session is not a behavioural voice session (case)", async () => {
    const caseRes = await sessionPOST(
      new Request("http://localhost/api/vapi/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module: "case", caseId: "beautify" }),
      }) as never,
    );
    const { sessionId } = await caseRes.json();
    const res = await reportPOST(
      makeReq(reportPayload(sessionId, "call_c", []), authHeader) as never,
    );
    expect(res.status).toBe(200);
    const s = redisStore.get(`voice-session:${sessionId}`)!.value as VoiceSession;
    expect(s.module).toBe("case");
    expect((s as unknown as Record<string, unknown>).reportStatus).toBeUndefined();
  });
});

describe("GET /api/behavioural/report/[sessionId] (status poll)", () => {
  function getReq(token?: string): Request {
    return new Request("http://localhost/api/behavioural/report/x", {
      headers: token ? { "x-report-token": token } : {},
    });
  }

  async function completeReport() {
    const { sessionId, reportToken } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    await reportPOST(makeReq(reportPayload(sessionId, "call_g", messagesFor(qs)), authHeader) as never);
    return { sessionId, reportToken };
  }

  it("returns the projected report with a valid token, exposing no internals", async () => {
    const { sessionId, reportToken } = await completeReport();
    const res = await reportGET(getReq(reportToken) as never, { params: { sessionId } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.reportStatus).toBe("done");
    // ONLY the lifecycle + projected aggregate — never transcript/context/questions/token.
    expect(Object.keys(body).sort()).toEqual(["report", "reportError", "reportStatus"]);
    expect(Object.keys(body.report).sort()).toEqual([
      "answered",
      "dimension_averages",
      "feedback",
      "overall",
      "qualitative",
      "total",
      "unanswered",
    ]);
    expect(body.report.qualitative.answers).toHaveLength(body.report.answered);
    expect(body.report.qualitative.qualitative_attempted).toBe(false);
    expect(body.report.qualitative.selected_model).toBe("claude-haiku-4-5");
    expect(body.report.qualitative.qualitative_backend).toBe("deterministic_fallback");
    expect(body.report.qualitative.fallback_reason).toBe("mock_mode");
    expect(body.report.qualitative.anthropic_error_status).toBeNull();
    expect(body.report.qualitative.anthropic_error_type).toBeNull();
    expect(body.report.qualitative.top_three_priorities).toHaveLength(3);
    expect(body.report.qualitative.answers[0].candidate_excerpt.length).toBeLessThanOrEqual(220);
    expect(body.report.qualitative.answers[0].assessment_confidence).toMatch(/high|medium|low/);
    expect(body.report.qualitative.answers[0].confidence).toBeUndefined();
    expect(body.report.session).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("questions_asked");
    expect(JSON.stringify(body)).not.toContain("mapping_confidence");
    expect(JSON.stringify(body)).not.toContain(reportToken);
  });

  it("404s on a wrong or missing token (sessionId path is not authorization)", async () => {
    const { sessionId } = await completeReport();
    expect((await reportGET(getReq("wrong-token") as never, { params: { sessionId } })).status).toBe(404);
    expect((await reportGET(getReq(undefined) as never, { params: { sessionId } })).status).toBe(404);
  });

  it("returns total + unanswered for a partial (early-ended) call", async () => {
    const { sessionId, reportToken } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    // Only the first 5 questions were asked/answered before the call ended.
    await reportPOST(
      makeReq(reportPayload(sessionId, "call_p", messagesFor(qs.slice(0, 5))), authHeader) as never,
    );
    const res = await reportGET(getReq(reportToken) as never, { params: { sessionId } });
    const body = await res.json();
    expect(body.reportStatus).toBe("done");
    expect(body.report.answered).toBe(5);
    expect(body.report.total).toBe(qs.length);
    expect(body.report.unanswered).toBe(qs.length - 5);
    expect(body.report.qualitative.partial_warning).toContain("not representative");
    expect(body.report.qualitative.answers).toHaveLength(5);
  });

  it("does not expose raw transcript answer text in the polling response", async () => {
    const { sessionId, reportToken } = await bootstrapBehavioural();
    const qs = stored(sessionId).questions;
    const rawSentinel = "RAW_TRANSCRIPT_SENTINEL_DO_NOT_RETURN_9f3a";
    const longRawAnswer =
      "During a complex analytics project I worked with the operations team to define the problem, gather requirements, build a dashboard prototype, test the output with stakeholders, and present the result clearly before adding this private tail marker " +
      rawSentinel;
    await reportPOST(
      makeReq(
        reportPayload(sessionId, "call_raw", [
          { role: "bot", message: `1) ${qs[0].question}` },
          {
            role: "user",
            message: longRawAnswer,
          },
        ]),
        authHeader,
      ) as never,
    );

    const res = await reportGET(getReq(reportToken) as never, { params: { sessionId } });
    const body = await res.json();
    expect(body.reportStatus).toBe("done");
    const excerpt = body.report.qualitative.answers[0].candidate_excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(220);
    expect(longRawAnswer.length).toBeGreaterThan(220);
    expect(JSON.stringify(body)).not.toContain(rawSentinel);
    expect(JSON.stringify(body)).not.toContain(longRawAnswer);
  });

  it("reports pending before the webhook has run", async () => {
    const { sessionId, reportToken } = await bootstrapBehavioural();
    const res = await reportGET(getReq(reportToken) as never, { params: { sessionId } });
    const body = await res.json();
    expect(body.reportStatus).toBe("pending");
    expect(body.report).toBeNull();
  });
});
