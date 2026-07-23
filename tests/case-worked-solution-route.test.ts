import { beforeEach, describe, expect, it, vi } from "vitest";
import airportCaseRecord from "@/context/cases/airport-profitability.json";
import gymCaseRecord from "@/context/cases/gcc-premium-gym.json";

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
    async eval() { return 0; }
  },
}));

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { GET as reportGET } from "@/app/api/case/report/[sessionId]/route";
import { GET as solutionGET } from "@/app/api/case/report/[sessionId]/solution/route";
import { GET as catalogGET } from "@/app/api/case/catalog/route";
import type { CasePostCallReport, CaseVoiceSession } from "@/lib/voice/types";

const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";
const AIRPORT_ASSISTANT = "airport-assistant-server-owned";
const GYM_ASSISTANT = "gym-assistant-server-owned";

function baseScore(overall: number | null) {
  return {
    overall,
    dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"].map((dimension) => ({
      dimension: dimension as any,
      score: overall,
      justification: "Observed performance.",
      evidence: "Candidate evidence.",
    })),
    summary: "A concise qualitative summary.",
    strengths: ["Commercial reasoning was a relative strength."],
    improvements: ["Make the leading hypothesis more explicit."],
    next_focus: ["Practice concise, hypothesis-led communication."],
    stage_feedback: [],
    improved_framework_outline: ["Define the decision, structure the drivers, and identify the tests."],
    improved_recommendation_outline: ["Lead with the decision, support it, and close with risks and next steps."],
    quantitative_assessment: "The quantitative approach was clear and linked to the decision.",
  };
}

function fullReport(): CasePostCallReport {
  return {
    partial: false,
    observedStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    answeredStages: ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"],
    missingStages: [],
    partialReasons: [],
    score: baseScore(4),
  };
}

function partialReport(): CasePostCallReport {
  return {
    partial: true,
    observedStages: ["clarification", "framework"],
    answeredStages: ["clarification", "framework"],
    missingStages: ["analysis", "data_reveal", "pressure_test", "recommendation"],
    partialReasons: ["missing_anchor"],
    score: { ...baseScore(null) },
  };
}

async function bootstrap(caseId: string) {
  const response = await sessionPOST(new Request("http://localhost/api/vapi/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "case", caseId }),
  }) as any);
  const json = await response.json() as any;
  return { sessionId: json.sessionId as string, reportToken: json.reportToken as string };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function markReport(sessionId: string, report: CasePostCallReport | null, status: CaseVoiceSession["reportStatus"]) {
  const record = stored(sessionId);
  record.reportStatus = status;
  record.finalReport = report;
  record.normalizedTranscript = [{ role: "candidate", text: "PRIVATE raw transcript.", ordinal: 0 } as any];
}

function solutionRequest(sessionId: string, token: string) {
  return solutionGET(new Request(`http://localhost/api/case/report/${sessionId}/solution`, {
    headers: { "x-report-token": token },
  }) as any, { params: { sessionId } });
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
  process.env.VAPI_AIRPORT_ASSISTANT_ID = AIRPORT_ASSISTANT;
  process.env.VAPI_GCC_GYM_ASSISTANT_ID = GYM_ASSISTANT;
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("protected worked-solution endpoint", () => {
  it("returns the Airport solution for a valid completed full report", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const { solution } = await response.json();
    expect(solution.caseId).toBe(AIRPORT);
    expect(solution.caseTitle).toBe("Airport Profitability");
    expect(solution.disclaimer).toBe("This is one strong approach, not the only valid answer.");
    expect(solution.calculations.steps.map((s: any) => s.result)).toContain("SAR 4,240,000");
    expect(solution.pressureTest.steps.map((s: any) => s.result)).toContain("SAR 450,000");
  });

  it("returns the solution for a valid completed partial report", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, partialReport(), "done");
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const { solution } = await response.json();
    expect(solution.caseId).toBe(AIRPORT);
    expect(solution.framework.points.length).toBeGreaterThan(0);
  });

  it("rejects a pending report", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    // reportStatus starts as "pending" at bootstrap.
    expect(stored(sessionId).reportStatus).toBe("pending");
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(404);
  });

  it("rejects a processing and a failed report", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, null, "processing");
    expect((await solutionRequest(sessionId, reportToken)).status).toBe(404);
    markReport(sessionId, null, "failed");
    expect((await solutionRequest(sessionId, reportToken)).status).toBe(404);
  });

  it("rejects an unknown session", async () => {
    const response = await solutionRequest("no-such-session", "any-token");
    expect(response.status).toBe(404);
  });

  it("rejects an expired session", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    redisStore.delete(`voice-session:${sessionId}`); // simulate TTL expiry
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(404);
  });

  it("rejects a missing token", async () => {
    const { sessionId } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const response = await solutionGET(new Request(`http://localhost/api/case/report/${sessionId}/solution`) as any, {
      params: { sessionId },
    });
    expect(response.status).toBe(404);
  });

  it("rejects a mismatched token", async () => {
    const { sessionId } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const response = await solutionRequest(sessionId, "wrong-token");
    expect(response.status).toBe(404);
  });

  it("gives Airport only Airport content", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const body = await (await solutionRequest(sessionId, reportToken)).text();
    expect(body).toContain("SAR 4,240,000");
    expect(body).not.toContain("USD 56,700,000");
    expect(body).not.toContain("GCC Premium Gym");
  });

  it("gives Gym only Gym content", async () => {
    const { sessionId, reportToken } = await bootstrap(GYM);
    markReport(sessionId, fullReport(), "done");
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("USD 56,700,000");
    expect(body).toContain("approximately 8 locations");
    expect(body).not.toContain("SAR 4,240,000");
    expect(body).not.toContain("Airport Profitability");
  });

  it("never serializes rubrics, evaluator prompts, weights, notes, or protected fields", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const body = await (await solutionRequest(sessionId, reportToken)).text();
    expect(body).not.toMatch(/scoring_rubric|rubric|evaluator|weight|anchors|target_solution_notes|internal|reportTokenHash|fencing|transcript/i);
    // The exact internal answer-key prose from the case JSON must not appear.
    expect(body).not.toContain((airportCaseRecord as any).target_solution_notes);
    expect(body).not.toContain((gymCaseRecord as any).target_solution_notes);
    const { solution } = JSON.parse(body);
    expect(Object.keys(solution).sort()).toEqual([
      "analysisApproach", "calculations", "caseId", "caseTitle", "disclaimer", "exampleRecommendation", "framework", "pressureTest", "version",
    ]);
  });

  it("sends the solution with no-store cache behavior", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not include the solution in the normal report polling response", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markReport(sessionId, fullReport(), "done");
    const response = await reportGET(new Request(`http://localhost/api/case/report/${sessionId}`, {
      headers: { "x-report-token": reportToken },
    }) as any, { params: { sessionId } });
    const body = await response.text();
    expect(body).not.toMatch(/worked|disclaimer|4,240,000|pressureTest|exampleRecommendation/i);
    const projection = JSON.parse(body);
    expect(projection).not.toHaveProperty("solution");
  });

  it("does not include the solution in the catalog/bootstrap response", async () => {
    const catalog = await (await catalogGET()).text();
    expect(catalog).not.toMatch(/worked|disclaimer|4,240,000|56,700,000|framework|calculations/i);
    const { reportToken } = await bootstrap(AIRPORT);
    // The bootstrap payload returns only a capability token, never solution text.
    expect(reportToken).toMatch(/^[a-f0-9]{64}$/);
  });
});
