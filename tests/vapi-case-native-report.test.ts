import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore, scorePostCallMock } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: any; ex?: number }>(),
  scorePostCallMock: vi.fn(),
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
      if (entry?.value === args[0]) {
        redisStore.delete(keys[0]);
        return 1;
      }
      return 0;
    }
  },
}));

vi.mock("@/lib/voice/case-post-call-scorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-post-call-scorer")>();
  return { ...actual, scoreCasePostCall: scorePostCallMock };
});

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { POST as reportPOST } from "@/app/api/vapi/case/report/route";
import { GET as reportGET } from "@/app/api/case/report/[sessionId]/route";
import { caseStageAnchorManifest } from "@/lib/voice/case-transcript";
import { CASE_VOICE_STAGE_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { PUBLIC_CASE_REPORT_FAILURE_CODES } from "@/lib/voice/case-report-public";
import type { CasePostCallReport, CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "native-report-secret";
const AIRPORT = "airport_profitability";
const ASSISTANT = "airport-assistant-server-owned";

function completeReport(overall = 4): CasePostCallReport {
  return {
    partial: false,
    observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    answeredStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    missingStages: [],
    partialReasons: [],
    score: {
      overall,
      dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"].map((dimension) => ({
        dimension: dimension as any,
        score: overall,
        justification: "Observed performance.",
        evidence: "Candidate evidence.",
      })),
      summary: "The candidate completed the case with a clear decision focus.",
      strengths: ["Commercial reasoning was a relative strength."],
      improvements: ["Make the leading hypothesis more explicit."],
      next_focus: ["Practice concise, hypothesis-led communication."],
      stage_feedback: [],
      improved_framework_outline: ["Define the decision, structure the drivers, and identify the tests."],
      improved_recommendation_outline: ["Lead with the decision, support it, and close with risks and next steps."],
      quantitative_assessment: "The quantitative approach was clear and linked to the decision.",
    },
  };
}

function request(url: string, body: unknown, auth = true): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: `Bearer ${SECRET}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function bootstrap(body: Record<string, unknown> = {}) {
  const response = await sessionPOST(request("http://localhost/api/vapi/session", {
    module: "case",
    caseId: AIRPORT,
    ...body,
  }, false) as any);
  return { response, json: await response.json() as any };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function reportPayload(
  sessionId: string,
  callId = "call-1",
  assistantId = ASSISTANT,
  extra: Record<string, unknown> = {},
) {
  const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  return {
    message: {
      type: "end-of-call-report",
      call: { id: callId, assistantId },
      artifact: {
        variableValues: { sessionId, caseId: AIRPORT },
        messages: [
          { role: "system", message: "do not persist" },
          { role: "assistant", message: manifest.anchors.framework },
          { role: "user", message: "I would structure this using customer, economics, and implementation." },
        ],
      },
      ...extra,
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  scorePostCallMock.mockReset();
  scorePostCallMock.mockResolvedValue({ ok: true, report: completeReport() });
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
  process.env.VAPI_AIRPORT_ASSISTANT_ID = ASSISTANT;
  process.env.VAPI_GCC_GYM_ASSISTANT_ID = "gym-assistant";
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("native Case bootstrap", () => {
  it("snapshots architecture, assistant/config/anchor versions and returns the token once", async () => {
    const { response, json } = await bootstrap();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ architecture: "vapi_native", assistantId: ASSISTANT, reportStatus: "pending" });
    const record = stored(json.sessionId);
    expect(record).toMatchObject({
      architecture: "vapi_native",
      expectedAssistantId: ASSISTANT,
      assistantConfigVersion: "airport-profitability-assistant-v1",
      stageAnchorVersion: CASE_VOICE_STAGE_ANCHOR_VERSION,
      authoritativeCallId: null,
      reportStatus: "pending",
      reportAttempt: 0,
    });
    expect(record.reportTokenHash).toHaveLength(64);
    expect(record.reportTokenHash).not.toBe(json.reportToken);
    expect(JSON.stringify(record)).not.toContain(json.reportToken);
  });

  it("ignores an arbitrary browser assistant id", async () => {
    const { json } = await bootstrap({ assistantId: "attacker-assistant" });
    expect(json.assistantId).toBe(ASSISTANT);
    expect(stored(json.sessionId).expectedAssistantId).toBe(ASSISTANT);
  });

  it("does not enable native mode without a configured mapped assistant", async () => {
    delete process.env.VAPI_AIRPORT_ASSISTANT_ID;
    const { response } = await bootstrap();
    expect(response.status).toBe(503);
    expect(redisStore.size).toBe(0);
  });

  it("environment changes do not switch an existing session architecture", async () => {
    const { json } = await bootstrap();
    process.env.CASE_VOICE_ARCHITECTURE = "custom_llm";
    expect(stored(json.sessionId).architecture).toBe("vapi_native");
  });
});

describe("authenticated report binding, idempotency and fencing", () => {
  it("rejects missing and incorrect webhook authentication before mutation", async () => {
    const { json } = await bootstrap();
    const before = JSON.stringify(stored(json.sessionId));
    const missing = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId), false) as any);
    const wrong = await reportPOST(new Request("http://localhost/api/vapi/case/report", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" },
      body: JSON.stringify(reportPayload(json.sessionId)),
    }) as any);
    expect([missing.status, wrong.status]).toEqual([401, 401]);
    expect(JSON.stringify(stored(json.sessionId))).toBe(before);
    expect(scorePostCallMock).not.toHaveBeenCalled();
  });

  it("wrong assistant cannot bind or score", async () => {
    const { json } = await bootstrap();
    const response = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId, "call-wrong", "wrong")) as any);
    expect(response.status).toBe(200);
    expect(stored(json.sessionId).authoritativeCallId).toBeNull();
    expect(scorePostCallMock).not.toHaveBeenCalled();
  });

  it("binds callId once and finalizes an authoritative report", async () => {
    const { json } = await bootstrap();
    const response = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    expect(response.status).toBe(200);
    expect(stored(json.sessionId)).toMatchObject({ authoritativeCallId: "call-1", reportStatus: "done", reportAttempt: 1 });
    expect(scorePostCallMock).toHaveBeenCalledTimes(1);
  });

  it("duplicate delivery scores once", async () => {
    const { json } = await bootstrap();
    const req = () => request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId));
    await reportPOST(req() as any);
    await reportPOST(req() as any);
    expect(scorePostCallMock).toHaveBeenCalledTimes(1);
    expect(stored(json.sessionId).reportAttempt).toBe(1);
  });

  it("does not rescore or increment attempts after a terminal failed report", async () => {
    const { json } = await bootstrap();
    scorePostCallMock.mockResolvedValueOnce({ ok: false, failureCode: "empty_transcript" });
    const delivery = () => reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(json.sessionId),
    ) as any);
    await delivery();
    expect(stored(json.sessionId)).toMatchObject({ reportStatus: "failed", reportAttempt: 1 });
    const failedSnapshot = structuredClone(stored(json.sessionId));
    await delivery();
    await delivery();
    expect(scorePostCallMock).toHaveBeenCalledTimes(1);
    expect(stored(json.sessionId)).toEqual(failedSnapshot);
  });

  it("a different call cannot overwrite the bound report", async () => {
    const { json } = await bootstrap();
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId, "call-1")) as any);
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId, "call-2")) as any);
    expect(stored(json.sessionId).authoritativeCallId).toBe("call-1");
    expect(scorePostCallMock).toHaveBeenCalledTimes(1);
  });

  it("uses a session-scoped lock for concurrent deliveries", async () => {
    const { json } = await bootstrap();
    let resolveScore!: (value: any) => void;
    scorePostCallMock.mockReturnValueOnce(new Promise((resolve) => { resolveScore = resolve; }));
    const first = reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    while (scorePostCallMock.mock.calls.length === 0) await Promise.resolve();
    const second = await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    expect(second.status).toBe(200);
    expect(scorePostCallMock).toHaveBeenCalledTimes(1);
    resolveScore({ ok: true, report: completeReport() });
    await first;
  });

  it("prevents a stale worker from overwriting a reclaimed fenced attempt", async () => {
    const { json } = await bootstrap();
    let resolveOld!: (value: any) => void;
    scorePostCallMock
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, report: completeReport(5) });
    const oldWorker = reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    while (scorePostCallMock.mock.calls.length === 0) await Promise.resolve();
    const current = stored(json.sessionId);
    current.reportProcessingStartedAt = new Date(Date.now() - 200_000).toISOString();
    redisStore.delete(`lock:case-report:${json.sessionId}`); // simulate expired lease
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    resolveOld({ ok: true, report: completeReport(2) });
    await oldWorker;
    expect(stored(json.sessionId).reportAttempt).toBe(2);
    expect(stored(json.sessionId).finalReport?.score.overall).toBe(5);
  });

  it("reads transcript only from artifact.messages and never logs its text", async () => {
    const { json } = await bootstrap();
    const secretText = "TRANSCRIPT-MUST-NOT-BE-LOGGED";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = reportPayload(json.sessionId) as any;
    payload.message.summary = secretText;
    payload.message.transcript = secretText;
    await reportPOST(request("http://localhost/api/vapi/case/report", payload) as any);
    expect(stored(json.sessionId).normalizedTranscript?.some((turn) => turn.text.includes(secretText))).toBe(false);
    expect(JSON.stringify([...log.mock.calls, ...info.mock.calls, ...error.mock.calls])).not.toContain(secretText);
    log.mockRestore(); info.mockRestore(); error.mockRestore();
  });

  it("logs only the safe post-call scoring diagnostic fields", async () => {
    const { json } = await bootstrap();
    const transcriptSecret = "PRIVATE-CANDIDATE-TRANSCRIPT-MARKER";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const payload = reportPayload(json.sessionId) as any;
    payload.message.artifact.messages[2].message = transcriptSecret;
    scorePostCallMock.mockResolvedValueOnce({
      ok: true,
      report: completeReport(),
      scorerOutcome: "model",
      failureCategory: null,
    });

    await reportPOST(request("http://localhost/api/vapi/case/report", payload) as any);

    const diagnostic = info.mock.calls.find((call) => call[0] === "[case-native-report] scoring");
    expect(diagnostic?.[1]).toEqual({
      sessionCorrelationId: json.sessionId,
      selectedCaseId: AIRPORT,
      observedStageCount: 1,
      missingStageCount: 5,
      partial: true,
      scorerOutcome: "model",
      scorerDurationMs: expect.any(Number),
      reportStatus: "done",
      failureCategory: null,
    });
    expect(Object.keys(diagnostic?.[1] ?? {}).sort()).toEqual([
      "failureCategory",
      "missingStageCount",
      "observedStageCount",
      "partial",
      "reportStatus",
      "scorerDurationMs",
      "scorerOutcome",
      "selectedCaseId",
      "sessionCorrelationId",
    ]);
    expect(JSON.stringify(info.mock.calls)).not.toContain(transcriptSecret);
    expect(JSON.stringify(info.mock.calls)).not.toContain(json.reportToken);
    info.mockRestore();
  });

  it("rejects custom sessions from the native report path", async () => {
    const { json } = await bootstrap();
    stored(json.sessionId).architecture = "custom_llm";
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    expect(scorePostCallMock).not.toHaveBeenCalled();
    expect(stored(json.sessionId).authoritativeCallId).toBeNull();
  });
});

describe("protected Case report polling", () => {
  it("returns only the candidate-safe projection", async () => {
    const { json } = await bootstrap();
    await reportPOST(request("http://localhost/api/vapi/case/report", reportPayload(json.sessionId)) as any);
    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const projection = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(projection).sort()).toEqual([
      "caseId", "caseTitle", "failureCode", "missingStages", "observedStages", "partial", "score", "status",
    ]);
    expect(JSON.stringify(projection)).not.toMatch(/transcript|assistantId|callId|fencing|solution|rubric|exhibit/i);
    expect(projection.score).toMatchObject({
      overall: 4,
      summary: expect.any(String),
      quantitative_assessment: expect.any(String),
    });
    expect(projection.score.dimension_scores).toHaveLength(5);
  });

  it("never exposes a distinctive candidate sentence through score evidence", async () => {
    const { json } = await bootstrap();
    const distinctive = "The purple zeppelin hypothesis belongs only to my private transcript.";
    const report = completeReport();
    report.score.dimension_scores[0].evidence = distinctive;
    report.score.dimension_scores[0].justification = distinctive;
    report.score.strengths = [distinctive];
    report.score.improvements = [distinctive];
    report.score.next_focus = [distinctive];
    report.score.summary = distinctive;
    report.score.improved_framework_outline = [distinctive];
    report.score.improved_recommendation_outline = [distinctive];
    report.score.quantitative_assessment = "The hidden answer was 4,240,000 per day.";
    scorePostCallMock.mockResolvedValueOnce({ ok: true, report });
    const payload = reportPayload(json.sessionId) as any;
    payload.message.artifact.messages[2].message = distinctive;
    await reportPOST(request("http://localhost/api/vapi/case/report", payload) as any);
    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const body = await response.text();
    const projection = JSON.parse(body);
    expect(body).not.toContain(distinctive);
    expect(body).not.toContain("4,240,000");
    expect(projection.score.dimension_scores.every(
      (dimension: Record<string, unknown>) => !("evidence" in dimension),
    )).toBe(true);
  });

  it("projects partial feedback only from answered stages", async () => {
    const { json } = await bootstrap();
    const record = stored(json.sessionId);
    const partial = completeReport();
    partial.partial = true;
    partial.observedStages = ["framework"];
    partial.answeredStages = ["framework"];
    partial.missingStages = ["clarification", "analysis", "data_reveal", "pressure_test", "recommendation"];
    partial.partialReasons = ["missing_anchor"];
    partial.score.overall = null;
    partial.score.dimension_scores = partial.score.dimension_scores.map((item) => ({
      ...item,
      score: item.dimension === "structure" || item.dimension === "communication" ? 3 : null,
      justification: item.dimension === "structure" || item.dimension === "communication"
        ? "PRIVATE model rationale about missing Recommendation quality."
        : item.justification,
    }));
    partial.score.strengths = ["Unscoped model praise must not be projected."];
    partial.score.improvements = ["Unscoped model criticism must not be projected."];
    partial.score.stage_feedback = [
      { stage: "framework", kind: "strength", text: "Observed framework feedback retained." },
      { stage: "recommendation", kind: "improvement", text: "Missing recommendation feedback discarded." },
    ];
    partial.score.improved_framework_outline = ["Observed framework coaching retained."];
    partial.score.improved_recommendation_outline = ["Missing recommendation coaching discarded."];
    partial.score.quantitative_assessment = "Missing quantitative feedback discarded.";
    record.normalizedTranscript = [{
      role: "candidate",
      text: "PRIVATE raw candidate sentence that must never reach polling.",
      ordinal: 0,
    }];
    record.reportStatus = "done";
    record.finalReport = partial;

    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const projection = await response.json();

    expect(projection.score.strengths).toEqual(["Observed framework feedback retained."]);
    expect(projection.score.improvements).toEqual([]);
    expect(projection.score.improved_framework_outline).toEqual(["Observed framework coaching retained."]);
    expect(projection.score.improved_recommendation_outline).toBeNull();
    expect(projection.score.quantitative_assessment).toBeNull();
    const scoredRationales = projection.score.dimension_scores
      .filter((item: { score: number | null }) => item.score !== null)
      .map((item: { justification: string }) => item.justification);
    expect(scoredRationales).toEqual([
      "This dimension was assessed from the observed Framework response.",
      "This dimension was assessed from the observed Framework response.",
    ]);
    expect(JSON.stringify(projection)).not.toContain("Missing recommendation");
    expect(JSON.stringify(projection)).not.toContain("Unscoped model");
    expect(JSON.stringify(projection)).not.toContain("PRIVATE model rationale");
    expect(JSON.stringify(projection)).not.toContain("PRIVATE raw candidate sentence");
  });

  it("rejects a missing or wrong report capability", async () => {
    const { json } = await bootstrap();
    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": "wrong" },
    }) as any, { params: { sessionId: json.sessionId } });
    expect(response.status).toBe(404);
  });

  it.each([
    ["stage_anchor_unavailable", "report_generation_failed"],
    ["scoring_failed", "report_generation_failed"],
    ["structured_output_error", "report_generation_failed"],
    ["arbitrary_provider_internal_detail", "report_generation_failed"],
    ["empty_transcript", "insufficient_interview_data"],
    ["unusable_transcript", "insufficient_interview_data"],
    ["report_unavailable", "report_unavailable"],
  ])("maps internal failure %s to candidate-safe code %s", async (internal, expected) => {
    const { json } = await bootstrap();
    const record = stored(json.sessionId);
    record.reportStatus = "failed";
    record.reportErrorCode = internal;

    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const projection = await response.json();

    expect(projection.failureCode).toBe(expected);
    expect(PUBLIC_CASE_REPORT_FAILURE_CODES).toContain(projection.failureCode);
    expect(JSON.stringify(projection)).not.toContain(internal === expected ? "__never__" : internal);
    expect(stored(json.sessionId).reportErrorCode).toBe(internal);
  });
});
