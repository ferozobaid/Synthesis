import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    async eval() { return 0; }
  },
}));

import { POST as sessionPOST } from "@/app/api/vapi/session/route";
import { GET as solutionGET } from "@/app/api/case/report/[sessionId]/solution/route";
import { GET as reportGET } from "@/app/api/case/report/[sessionId]/route";
import { questionAnchorManifest } from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import type {
  CasePostCallReport,
  CaseVoiceSession,
  QuestionBankPostCallReport,
} from "@/lib/voice/types";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";
const AIRPORT = "airport_profitability";

const CS_ASSISTANT = "asst-clickstream";
const DA_ASSISTANT = "asst-da-round";
const DE_ASSISTANT = "asst-de-round";
const AIRPORT_ASSISTANT = "asst-airport";

function score(overall: number | null, dimensions: string[]) {
  return {
    overall,
    dimension_scores: dimensions.map((dimension) => ({
      dimension: dimension as any,
      score: overall,
      justification: "Observed performance.",
      evidence: "Candidate evidence.",
    })),
    summary: "A concise qualitative summary.",
    strengths: ["Named a durable buffer."],
    improvements: ["Quantify the windowing choice."],
    next_focus: ["Practice stating grain first."],
    stage_feedback: [],
    improved_framework_outline: ["Producers, log, processing, serving."],
    improved_recommendation_outline: ["State the architecture and the trade-off."],
    quantitative_assessment: "Throughput and latency were tied to the design.",
  };
}

function stageReport(): CasePostCallReport {
  const stages = ["clarification", "framework", "analysis", "data_reveal", "pressure_test", "recommendation"] as const;
  return {
    partial: false,
    observedStages: [...stages],
    answeredStages: [...stages],
    missingStages: [],
    partialReasons: [],
    score: score(4, [
      "requirements_clarification",
      "pipeline_design",
      "etl_elt_strategy",
      "batch_streaming_tradeoffs",
      "storage_modeling",
      "scalability_performance",
      "reliability_fault_tolerance",
      "data_quality_deduplication",
      "observability_operations",
      "tradeoff_communication",
    ]),
  };
}

function bankReport(caseId: string, partial = false): QuestionBankPostCallReport {
  const order = questionAnchorManifest(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION)!.order;
  return {
    partial,
    observedQuestions: partial ? order.slice(0, 2) : [...order],
    answeredQuestions: partial ? order.slice(0, 2) : [...order],
    missingQuestions: partial ? order.slice(2) : [],
    partialReasons: partial ? ["missing_anchor"] : [],
    score: score(partial ? null : 4, [...order]),
  };
}

async function bootstrap(caseId: string) {
  const response = await sessionPOST(new Request("http://localhost/api/vapi/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: "case", caseId }),
  }) as any);
  const json = (await response.json()) as any;
  return { sessionId: json.sessionId as string, reportToken: json.reportToken as string };
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

function markDone(
  sessionId: string,
  opts: {
    stage?: CasePostCallReport | null;
    bank?: QuestionBankPostCallReport | null;
    status?: CaseVoiceSession["reportStatus"];
  },
) {
  const record = stored(sessionId);
  record.reportStatus = opts.status ?? "done";
  record.finalReport = opts.stage ?? null;
  record.finalQuestionBankReport = opts.bank ?? null;
  record.normalizedTranscript = [
    { role: "candidate", text: "PRIVATE raw transcript sentence.", ordinal: 0 } as any,
  ];
}

function solutionRequest(sessionId: string, token: string) {
  return solutionGET(
    new Request(`http://localhost/api/case/report/${sessionId}/solution`, {
      headers: { "x-report-token": token },
    }) as any,
    { params: { sessionId } },
  );
}

beforeEach(() => {
  redisStore.clear();
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
  process.env.VAPI_DATA_ENGINEER_ASSISTANT_ID = CS_ASSISTANT;
  process.env.VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID = DA_ASSISTANT;
  process.env.VAPI_DATA_ENGINEER_TECHNICAL_ROUND_ASSISTANT_ID = DE_ASSISTANT;
  process.env.VAPI_AIRPORT_ASSISTANT_ID = AIRPORT_ASSISTANT;
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("1. Clickstream worked solution", () => {
  it("returns 200 with a complete worked architecture (was 404)", async () => {
    const { sessionId, reportToken } = await bootstrap(CLICKSTREAM);
    markDone(sessionId, { stage: stageReport() });
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const { solution } = await response.json();
    expect(solution.caseId).toBe(CLICKSTREAM);
    expect(solution.caseTitle).toBe("Clickstream Data Pipeline");
  });

  it("covers every required architecture topic", async () => {
    const { sessionId, reportToken } = await bootstrap(CLICKSTREAM);
    markDone(sessionId, { stage: stageReport() });
    const { solution } = await (await solutionRequest(sessionId, reportToken)).json();
    const text = JSON.stringify(solution).toLowerCase();
    for (const topic of [
      "producer",
      "ingestion",
      "schema",
      "partition",
      "stream",
      "sessionization",
      "daily active users",
      "trending pages",
      "bronze",
      "latency",
      "availability",
      "replay",
      "deduplicat",
      "eventually consistent",
      "exactly-once",
    ]) {
      expect(text.includes(topic)).toBe(true);
    }
  });

  it("omits calculation sections it does not author, and carries its prose sections", async () => {
    const { sessionId, reportToken } = await bootstrap(CLICKSTREAM);
    markDone(sessionId, { stage: stageReport() });
    const { solution } = await (await solutionRequest(sessionId, reportToken)).json();
    expect(solution.calculations).toBeUndefined();
    expect(solution.pressureTest).toBeUndefined();
    expect(solution.framework.points.length).toBeGreaterThan(0);
    expect(solution.additionalSections.length).toBeGreaterThan(0);
    expect(solution.exampleRecommendation.points.length).toBeGreaterThan(0);
  });
});

describe("2–3. technical round worked solutions", () => {
  for (const [label, caseId] of [
    ["Data Analyst", DA_ROUND],
    ["Data Engineer", DE_ROUND],
  ] as const) {
    it(`${label} Technical Round returns 200 (was 404)`, async () => {
      const { sessionId, reportToken } = await bootstrap(caseId);
      markDone(sessionId, { bank: bankReport(caseId) });
      const response = await solutionRequest(sessionId, reportToken);
      expect(response.status).toBe(200);
      const { solution } = await response.json();
      expect(solution.caseId).toBe(caseId);
    });

    it(`${label} returns one worked answer per question, in bank order`, async () => {
      const order = questionAnchorManifest(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION)!.order;
      const { sessionId, reportToken } = await bootstrap(caseId);
      markDone(sessionId, { bank: bankReport(caseId) });
      const { solution } = await (await solutionRequest(sessionId, reportToken)).json();
      expect(solution.questions).toHaveLength(5);
      expect(solution.questions.map((q: any) => q.questionId)).toEqual(order);
      for (const question of solution.questions) {
        expect(question.points.length).toBeGreaterThan(0);
        expect(question.title.length).toBeGreaterThan(0);
      }
    });

    it(`${label} releases the solution for a partial report too`, async () => {
      const { sessionId, reportToken } = await bootstrap(caseId);
      markDone(sessionId, { bank: bankReport(caseId, true) });
      expect((await solutionRequest(sessionId, reportToken)).status).toBe(200);
    });
  }
});

describe("4–5. authorization is unchanged", () => {
  it("rejects a request with no token", async () => {
    const { sessionId } = await bootstrap(CLICKSTREAM);
    markDone(sessionId, { stage: stageReport() });
    const response = await solutionGET(
      new Request(`http://localhost/api/case/report/${sessionId}/solution`) as any,
      { params: { sessionId } },
    );
    expect(response.status).toBe(404);
  });

  it("rejects a wrong report token for every technical case", async () => {
    for (const [caseId, mark] of [
      [CLICKSTREAM, () => ({ stage: stageReport() })],
      [DA_ROUND, () => ({ bank: bankReport(DA_ROUND) })],
      [DE_ROUND, () => ({ bank: bankReport(DE_ROUND) })],
    ] as const) {
      const { sessionId } = await bootstrap(caseId);
      markDone(sessionId, mark());
      const response = await solutionRequest(sessionId, "wrong-token");
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("rejects an unknown session", async () => {
    expect((await solutionRequest("no-such-session", "any-token")).status).toBe(404);
  });
});

describe("6. unsupported and legacy reports fail safely", () => {
  it("rejects pending, processing, and failed technical reports", async () => {
    for (const status of ["pending", "processing", "failed"] as const) {
      const { sessionId, reportToken } = await bootstrap(DA_ROUND);
      markDone(sessionId, { bank: null, status });
      expect((await solutionRequest(sessionId, reportToken)).status).toBe(404);
    }
  });

  it("a done report for a case with no authored solution still 404s (no crash)", async () => {
    const { sessionId, reportToken } = await bootstrap(CLICKSTREAM);
    const record = stored(sessionId);
    record.reportStatus = "done";
    record.finalReport = stageReport();
    // Simulate a legacy/unmapped case id on an otherwise valid session.
    record.caseId = "retired_case_id";
    expect((await solutionRequest(sessionId, reportToken)).status).toBe(404);
  });

  it("a legacy session with no stored transcript still returns its solution", async () => {
    const { sessionId, reportToken } = await bootstrap(DE_ROUND);
    const record = stored(sessionId);
    record.reportStatus = "done";
    record.finalQuestionBankReport = bankReport(DE_ROUND);
    record.normalizedTranscript = null;
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const { solution } = await response.json();
    expect(solution.questions).toHaveLength(5);
  });
});

describe("7. no private evaluator content is exposed", () => {
  const PRIVATE_TERMS = [
    "target_elements",
    "target elements",
    "acceptable_alternatives",
    "acceptable alternatives",
    "red_flags",
    "red flags",
    "strong_answer_outline",
    "answer_key",
    "hint_ladder",
    "rubric",
    "anchors",
    "weight",
    "pass_threshold",
    "system prompt",
    "private interviewer guidance",
    "assistantid",
    "webhook",
    "max_tokens",
    "evaluator_type",
    "scoring",
  ];

  for (const caseId of [CLICKSTREAM, DA_ROUND, DE_ROUND]) {
    it(`${caseId} exposes no private evaluator vocabulary`, async () => {
      const { sessionId, reportToken } = await bootstrap(caseId);
      markDone(
        sessionId,
        caseId === CLICKSTREAM ? { stage: stageReport() } : { bank: bankReport(caseId) },
      );
      const { solution } = await (await solutionRequest(sessionId, reportToken)).json();
      const text = JSON.stringify(solution).toLowerCase();
      for (const term of PRIVATE_TERMS) {
        expect(text.includes(term)).toBe(false);
      }
      // Nor the transcript, session, or token material.
      expect(text.includes("private raw transcript")).toBe(false);
      expect(text.includes(reportToken.toLowerCase())).toBe(false);
      expect(text.includes(sessionId.toLowerCase())).toBe(false);
    });
  }

  it("no worked-solution sentence is copied from the private question-bank JSON", () => {
    const solutions = readFileSync(join(process.cwd(), "lib/voice/case-worked-solutions.ts"), "utf8");
    for (const role of ["data_analyst", "data_engineer"]) {
      const bank = JSON.parse(
        readFileSync(join(process.cwd(), `context/technical/${role}.json`), "utf8"),
      );
      for (const question of bank.questions) {
        const privateStrings: string[] = [
          ...question.answer_key.strong_answer_outline,
          ...question.answer_key.acceptable_alternatives,
          ...question.answer_key.red_flags,
          ...question.target_elements.map((t: any) => t.description),
          ...question.adaptive.hint_ladder,
        ];
        for (const value of privateStrings) {
          // Verbatim reuse of any private grading string would be a leak.
          expect(solutions.includes(value)).toBe(false);
        }
      }
    }
  });

  it("the solution registry is never imported by a client component", () => {
    for (const component of [
      "components/CaseNativeVoiceInterview.tsx",
      "components/CaseVoiceInterview.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), component), "utf8");
      expect(src.includes('from "@/lib/voice/case-worked-solutions"')).toBe(false);
    }
  });
});

describe("8. existing consulting solutions still work", () => {
  it("Airport still returns its five-section solution unchanged", async () => {
    const { sessionId, reportToken } = await bootstrap(AIRPORT);
    markDone(sessionId, { stage: { ...stageReport(), score: score(4, ["structure"]) } });
    const response = await solutionRequest(sessionId, reportToken);
    expect(response.status).toBe(200);
    const { solution } = await response.json();
    expect(solution.caseId).toBe(AIRPORT);
    expect(solution.calculations.steps[0].result).toBe("24,000");
    expect(solution.calculations.steps.at(-1).result).toBe("SAR 4,240,000");
    expect(solution.pressureTest.steps.at(-1).result).toBe("SAR 450,000");
    expect(solution.questions).toBeUndefined();
    expect(solution.additionalSections).toBeUndefined();
  });
});

describe("9. reports and answer review are unaffected", () => {
  it("the report response never carries worked-solution content", async () => {
    const { sessionId, reportToken } = await bootstrap(DA_ROUND);
    markDone(sessionId, { bank: bankReport(DA_ROUND) });
    const response = await reportGET(
      new Request(`http://localhost/api/case/report/${sessionId}`, {
        headers: { "x-report-token": reportToken },
      }) as any,
      { params: { sessionId } },
    );
    const projection = await response.json();
    expect(Object.keys(projection)).not.toContain("solution");
    expect(Object.keys(projection)).not.toContain("questions");
    expect(JSON.stringify(projection)).not.toContain("How to approach this round");
    // The answer-review field is still present and unchanged in shape.
    expect(Array.isArray(projection.answers)).toBe(true);
  });

  it("fetching a solution does not mutate the stored session or its report", async () => {
    const { sessionId, reportToken } = await bootstrap(CLICKSTREAM);
    markDone(sessionId, { stage: stageReport() });
    const before = JSON.stringify(stored(sessionId));
    await solutionRequest(sessionId, reportToken);
    expect(JSON.stringify(stored(sessionId))).toBe(before);
  });
});
