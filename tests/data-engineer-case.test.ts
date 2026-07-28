import { beforeEach, describe, expect, it, vi } from "vitest";

const { redisStore, scoreConsultingMock, scoreTechnicalMock } = vi.hoisted(() => ({
  redisStore: new Map<string, { value: any; ex?: number }>(),
  scoreConsultingMock: vi.fn(),
  scoreTechnicalMock: vi.fn(),
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
  return { ...actual, scoreCasePostCall: scoreConsultingMock };
});

vi.mock("@/lib/voice/case-technical-post-call-scorer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/case-technical-post-call-scorer")>();
  return { ...actual, scoreTechnicalCasePostCall: scoreTechnicalMock };
});

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { POST as reportPOST } from "@/app/api/vapi/case/report/route";
import { GET as reportGET } from "@/app/api/case/report/[sessionId]/route";
import { GET as catalogGET } from "@/app/api/case/catalog/route";
import { caseStageAnchorManifest } from "@/lib/voice/case-transcript";
import { CASE_VOICE_STAGE_ANCHOR_VERSION, resolveNativeCaseAssistant } from "@/lib/voice/case-native-config";
import { isPreviewLlmCaseId, previewLlmCaseCatalogEntry } from "@/lib/voice/case-catalog";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import { TECHNICAL_DIMENSIONS } from "@/lib/voice/case-technical-post-call-scorer";
import type { CasePostCallReport, CaseVoiceSession } from "@/lib/voice/types";
import { nativeCaseReportPresentation } from "@/components/CaseNativeVoiceInterview";

const DATA_ENGINEER = "data_engineer_clickstream";
const AIRPORT = "airport_profitability";
const DE_ASSISTANT = "de-assistant-server-owned";
const AIRPORT_ASSISTANT = "airport-assistant-server-owned";

function technicalReport(overall = 4): CasePostCallReport {
  return {
    partial: false,
    observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    answeredStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    missingStages: [],
    partialReasons: [],
    score: {
      overall,
      dimension_scores: TECHNICAL_DIMENSIONS.map((dimension) => ({
        dimension,
        score: overall,
        justification: "Observed performance.",
        evidence: null,
      })),
      summary: "The candidate designed a coherent end-to-end pipeline.",
      strengths: ["Reasoned clearly about durability and exactly-once Gold tables."],
      improvements: ["Make the backfill strategy more concrete."],
      next_focus: ["Practice describing a concrete backfill mechanism."],
      stage_feedback: [],
      improved_framework_outline: ["Name every stage of the data lifecycle explicitly."],
      improved_recommendation_outline: ["Close with the key trade-off made and why."],
      quantitative_assessment: "The scale and reliability reasoning was clearly tied to the stated throughput.",
    },
  };
}

function consultingReport(overall = 4): CasePostCallReport {
  return {
    partial: false,
    observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    answeredStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    missingStages: [],
    partialReasons: [],
    score: {
      overall,
      dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"].map((dimension) => ({
        dimension,
        score: overall,
        justification: "Observed performance.",
        evidence: null,
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
      ...(auth ? { authorization: "Bearer native-report-secret" } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function bootstrap(caseId: string, body: Record<string, unknown> = {}) {
  const response = await sessionPOST(request("http://localhost/api/vapi/session", {
    module: "case",
    caseId,
    ...body,
  }, false) as any);
  return { response, json: await response.json() as any };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function reportPayload(
  caseId: string,
  sessionId: string,
  assistantId: string,
  callId = "call-1",
) {
  const manifest = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  return {
    message: {
      type: "end-of-call-report",
      call: { id: callId, assistantId },
      artifact: {
        variableValues: { sessionId, caseId },
        messages: [
          { role: "assistant", message: manifest.anchors.framework },
          { role: "user", message: "I would ingest via a load balancer, buffer in Kafka, and process with Flink." },
        ],
      },
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  scoreConsultingMock.mockReset();
  scoreTechnicalMock.mockReset();
  scoreConsultingMock.mockResolvedValue({ ok: true, report: technicalReport() });
  scoreTechnicalMock.mockResolvedValue({ ok: true, report: technicalReport() });
  process.env.VAPI_WEBHOOK_SECRET = "native-report-secret";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_AIRPORT_ASSISTANT_ID = AIRPORT_ASSISTANT;
  process.env.VAPI_GCC_GYM_ASSISTANT_ID = "gym-assistant";
  process.env.VAPI_DATA_ENGINEER_ASSISTANT_ID = DE_ASSISTANT;
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("Data Engineer case catalog registration", () => {
  it("is listed in the selectable catalog with id/title/description/track/role plus difficulty/duration and nothing else", async () => {
    const response = await catalogGET();
    const { cases } = await response.json() as { cases: Array<Record<string, unknown>> };
    const entry = cases.find((c) => c.id === DATA_ENGINEER);
    expect(entry).toBeDefined();
    expect(Object.keys(entry!).sort()).toEqual([
      "description",
      "difficultyStars",
      "id",
      "maxDurationSeconds",
      "role",
      "title",
      "track",
    ]);
    expect(entry).toMatchObject({
      track: "technical",
      role: "data_engineering",
      difficultyStars: 5,
      maxDurationSeconds: 1200,
    });
  });

  it("isPreviewLlmCaseId / previewLlmCaseCatalogEntry recognize the case", () => {
    expect(isPreviewLlmCaseId(DATA_ENGINEER)).toBe(true);
    expect(previewLlmCaseCatalogEntry(DATA_ENGINEER)?.title).toBe("Clickstream Data Pipeline");
  });
});

describe("Data Engineer case record loading", () => {
  it("loads a technical_system_design case record with a 10-dimension rubric", () => {
    const record = getVoiceLlmCaseRecord(DATA_ENGINEER);
    expect(record).toBeDefined();
    expect(record!.evaluator_type).toBe("technical_system_design");
    expect(record!.scoring_rubric.dimensions.map((d) => d.name).sort()).toEqual(
      [...TECHNICAL_DIMENSIONS].sort(),
    );
  });

  it("is never reachable through the shared mockCase manual-flow registry", async () => {
    const { mockCase } = await import("@/lib/__mocks__/fixtures");
    expect(mockCase(DATA_ENGINEER)).toBeUndefined();
  });

  it("has stage anchors registered under the shared stage-anchor version", () => {
    const manifest = caseStageAnchorManifest(DATA_ENGINEER, CASE_VOICE_STAGE_ANCHOR_VERSION);
    expect(manifest).not.toBeNull();
    expect(manifest!.anchors.data_reveal).toContain("scale requirements");
  });

  it("has an authored custom-LLM live packet under the exact catalog id", async () => {
    const { caseLiveAuthoredConfig, isCaseLiveCaseId } = await import("@/lib/voice/case-live-packet");
    expect(isCaseLiveCaseId(DATA_ENGINEER)).toBe(true);
    expect(caseLiveAuthoredConfig(DATA_ENGINEER)).toMatchObject({
      caseId: DATA_ENGINEER,
      opening: {
        casePrompt: expect.stringContaining("clickstream"),
      },
    });
  });
});

describe("Data Engineer native assistant resolution", () => {
  it("resolves the configured assistant id and version", () => {
    const resolved = resolveNativeCaseAssistant(DATA_ENGINEER, { VAPI_DATA_ENGINEER_ASSISTANT_ID: DE_ASSISTANT });
    expect(resolved).toMatchObject({
      caseId: DATA_ENGINEER,
      assistantId: DE_ASSISTANT,
      assistantConfigVersion: "data-engineer-clickstream-assistant-v1",
    });
  });

  it("fails closed when the assistant id env var is unset", () => {
    expect(resolveNativeCaseAssistant(DATA_ENGINEER, {})).toBeNull();
  });
});

describe("Data Engineer session bootstrap", () => {
  it("always resolves vapi_native even when CASE_VOICE_ARCHITECTURE is custom_llm", async () => {
    process.env.CASE_VOICE_ARCHITECTURE = "custom_llm";
    const { response, json } = await bootstrap(DATA_ENGINEER);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ architecture: "vapi_native", assistantId: DE_ASSISTANT, reportStatus: "pending" });
  });

  it("falls back to the existing custom-LLM Case transport when the optional native assistant is absent", async () => {
    delete process.env.VAPI_DATA_ENGINEER_ASSISTANT_ID;
    process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
    const { response, json } = await bootstrap(DATA_ENGINEER);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      architecture: "custom_llm",
      caseId: DATA_ENGINEER,
      caseTrack: "technical",
      caseRole: "data_engineering",
      openingPrompt: expect.stringContaining("Clickstream Data Pipeline"),
    });
    expect(stored(json.sessionId)).toMatchObject({
      caseId: DATA_ENGINEER,
      caseTrack: "technical",
      caseRole: "data_engineering",
      architecture: "custom_llm",
    });
  });

  it("does not change Airport's architecture resolution (still governed by the global flag)", async () => {
    process.env.CASE_VOICE_ARCHITECTURE = "custom_llm";
    const { response, json } = await bootstrap(AIRPORT);
    expect(response.status).toBe(200);
    expect(json.architecture).toBe("custom_llm");
  });

  it("snapshots the technical assistant config and stage anchor version", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    const record = stored(json.sessionId);
    expect(record).toMatchObject({
      caseId: DATA_ENGINEER,
      caseTrack: "technical",
      caseRole: "data_engineering",
      architecture: "vapi_native",
      expectedAssistantId: DE_ASSISTANT,
      assistantConfigVersion: "data-engineer-clickstream-assistant-v1",
      reportStatus: "pending",
    });
  });
});

describe("Data Engineer webhook identity checks", () => {
  it("rejects a mismatched assistant id and never scores", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    const response = await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(DATA_ENGINEER, json.sessionId, "wrong-assistant"),
    ) as any);
    expect(response.status).toBe(200);
    expect(stored(json.sessionId).authoritativeCallId).toBeNull();
    expect(scoreTechnicalMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched case id supplied in the webhook artifact", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    const payload = reportPayload(DATA_ENGINEER, json.sessionId, DE_ASSISTANT);
    payload.message.artifact.variableValues.caseId = AIRPORT;
    const response = await reportPOST(request("http://localhost/api/vapi/case/report", payload) as any);
    expect(response.status).toBe(200);
    expect(stored(json.sessionId).authoritativeCallId).toBeNull();
    expect(scoreTechnicalMock).not.toHaveBeenCalled();
  });

  it("binds and scores on a correct assistant/case id match", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    const response = await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(DATA_ENGINEER, json.sessionId, DE_ASSISTANT),
    ) as any);
    expect(response.status).toBe(200);
    expect(stored(json.sessionId)).toMatchObject({ authoritativeCallId: "call-1", reportStatus: "done" });
    expect(scoreTechnicalMock).toHaveBeenCalledTimes(1);
  });
});

describe("evaluator routing by CaseRecord.evaluator_type", () => {
  it("routes the Data Engineer case to the technical evaluator, never the consulting evaluator", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(DATA_ENGINEER, json.sessionId, DE_ASSISTANT),
    ) as any);
    expect(scoreTechnicalMock).toHaveBeenCalledTimes(1);
    expect(scoreConsultingMock).not.toHaveBeenCalled();
  });

  it("keeps Airport on the consulting evaluator, never the technical evaluator", async () => {
    process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
    const { json } = await bootstrap(AIRPORT);
    await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(AIRPORT, json.sessionId, AIRPORT_ASSISTANT),
    ) as any);
    expect(scoreConsultingMock).toHaveBeenCalledTimes(1);
    expect(scoreTechnicalMock).not.toHaveBeenCalled();
  });
});

describe("Data Engineer candidate-safe report output", () => {
  it("returns a technical_system_design projection with the 10 technical dimensions and no leakage", async () => {
    const { json } = await bootstrap(DATA_ENGINEER);
    await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(DATA_ENGINEER, json.sessionId, DE_ASSISTANT),
    ) as any);
    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const projection = await response.json();

    expect(response.status).toBe(200);
    expect(projection).toMatchObject({
      caseId: DATA_ENGINEER,
      caseTrack: "technical",
      caseRole: "data_engineering",
    });
    expect(projection.evaluatorType).toBe("technical_system_design");
    expect(projection.score.dimension_scores.map((d: { dimension: string }) => d.dimension).sort()).toEqual(
      [...TECHNICAL_DIMENSIONS].sort(),
    );
    expect(JSON.stringify(projection)).not.toMatch(
      /transcript|assistantId|callId|fencing|rubric|exhibit|validationPath|validationReason/i,
    );
    expect(nativeCaseReportPresentation(projection)?.readinessUpdated).toBe(false);
  });

  it("marks Airport's projection as the consulting evaluator with its 5 dimensions intact", async () => {
    process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
    scoreConsultingMock.mockResolvedValueOnce({ ok: true, report: consultingReport() });
    const { json } = await bootstrap(AIRPORT);
    await reportPOST(request(
      "http://localhost/api/vapi/case/report",
      reportPayload(AIRPORT, json.sessionId, AIRPORT_ASSISTANT),
    ) as any);
    const response = await reportGET(new Request(`http://localhost/api/case/report/${json.sessionId}`, {
      headers: { "x-report-token": json.reportToken },
    }) as any, { params: { sessionId: json.sessionId } });
    const projection = await response.json();
    expect(projection.evaluatorType).toBe("consulting");
    expect(projection.score.dimension_scores).toHaveLength(5);
  });
});
