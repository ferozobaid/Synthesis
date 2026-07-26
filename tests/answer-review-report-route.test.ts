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
import { caseStageAnchorManifest, CASE_REPORT_STAGES } from "@/lib/voice/case-transcript";
import {
  CASE_VOICE_QUESTION_ANCHOR_VERSION,
  CASE_VOICE_STAGE_ANCHOR_VERSION,
} from "@/lib/voice/case-native-config";
import { ANSWER_MAX_CHARS_PER_TURN } from "@/lib/voice/case-answer-projection";
import type { CaseVoiceSession } from "@/lib/voice/types";

const SECRET = "answer-review-secret";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";
const CLICKSTREAM = "data_engineer_clickstream";
const DA_ASSISTANT = "asst-da-round";
const DE_ASSISTANT = "asst-de-round";
const CS_ASSISTANT = "asst-clickstream";

const ANSWER =
  "I would filter valid orders, join customers, aggregate revenue by month and region, and reconcile totals with a duplicate check.";

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

async function bootstrap(caseId: string) {
  const res = await sessionPOST(
    request("http://localhost/api/vapi/session", { module: "case", caseId }) as any,
  );
  return (await res.json()) as any;
}

function stored(sessionId: string): CaseVoiceSession {
  return redisStore.get(`voice-session:${sessionId}`)!.value as CaseVoiceSession;
}

async function readReport(sessionId: string, token: string) {
  const res = await reportGET(
    new Request(`http://localhost/api/case/report/${sessionId}`, {
      headers: { "x-report-token": token },
    }) as any,
    { params: { sessionId } },
  );
  return { res, json: (await res.json()) as any };
}

/** Build a webhook transcript, including material that must never be projected. */
function messages(
  anchors: string[],
  answers: (string | null)[],
): Array<{ role: string; message: string }> {
  const out: Array<{ role: string; message: string }> = [
    // System material is dropped by the normalizer and must never surface.
    { role: "system", message: "SYSTEM PROMPT: target elements and red flags follow." },
    { role: "assistant", message: "Welcome, say ready to begin." },
    { role: "user", message: "ready" },
  ];
  anchors.forEach((anchor, index) => {
    out.push({ role: "assistant", message: `${anchor} Please walk me through it.` });
    const answer = answers[index];
    if (answer !== null) out.push({ role: "user", message: answer });
  });
  return out;
}

function payload(
  sessionId: string,
  caseId: string,
  assistantId: string,
  msgs: Array<{ role: string; message: string }>,
  callId = "call-1",
) {
  return {
    message: {
      type: "end-of-call-report",
      call: { id: callId, assistantId },
      artifact: { variableValues: { sessionId, caseId }, messages: msgs },
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  process.env.UPSTASH_REDIS_REST_KV_REST_API_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN = "test-token";
  process.env.VAPI_DATA_ANALYST_TECHNICAL_ROUND_ASSISTANT_ID = DA_ASSISTANT;
  process.env.VAPI_DATA_ENGINEER_TECHNICAL_ROUND_ASSISTANT_ID = DE_ASSISTANT;
  process.env.VAPI_DATA_ENGINEER_ASSISTANT_ID = CS_ASSISTANT;
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("Data Analyst question answers", () => {
  const manifest = questionAnchorManifest(DA_ROUND, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
  const anchors = manifest.order.map((id) => manifest.anchors[id]);

  it("returns one answer group per question, keyed by the scoring question id", async () => {
    const session = await bootstrap(DA_ROUND);
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(session.sessionId, DA_ROUND, DA_ASSISTANT, messages(anchors, anchors.map(() => ANSWER))),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.answers).toHaveLength(5);
    expect(json.answers.map((a: any) => a.id)).toEqual(manifest.order);
    // The ids line up with the per-question score rows the UI attaches to.
    expect(json.score.dimension_scores.map((d: any) => d.dimension)).toEqual(manifest.order);
    expect(json.answers[0].turns[0].text).toBe(ANSWER);
    expect(json.answers[0].question).toContain(anchors[0]);
  });

  it("preserves turn ordering within a question", async () => {
    const session = await bootstrap(DA_ROUND);
    const msgs = messages([anchors[0]], [ANSWER]);
    msgs.push({ role: "user", message: "And then I would validate the totals." });
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(session.sessionId, DA_ROUND, DA_ASSISTANT, msgs),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.answers[0].turns.map((t: any) => t.text)).toEqual([
      ANSWER,
      "And then I would validate the totals.",
    ]);
  });
});

describe("Data Engineer question answers", () => {
  const manifest = questionAnchorManifest(DE_ROUND, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
  const anchors = manifest.order.map((id) => manifest.anchors[id]);

  it("returns one answer group per question", async () => {
    const session = await bootstrap(DE_ROUND);
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(session.sessionId, DE_ROUND, DE_ASSISTANT, messages(anchors, anchors.map(() => ANSWER))),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.answers.map((a: any) => a.id)).toEqual(manifest.order);
  });
});

describe("Clickstream stage answers", () => {
  const manifest = caseStageAnchorManifest(CLICKSTREAM, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const anchors = CASE_REPORT_STAGES.map((stage) => manifest.anchors[stage]);

  it("returns one answer group per observed stage with technical labels", async () => {
    const session = await bootstrap(CLICKSTREAM);
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(session.sessionId, CLICKSTREAM, CS_ASSISTANT, messages(anchors, anchors.map(() => ANSWER))),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.evaluatorType).toBe("technical_system_design");
    expect(json.answers.map((a: any) => a.id)).toEqual([...CASE_REPORT_STAGES]);
    expect(json.answers.map((a: any) => a.label)).toEqual([
      "Clarification",
      "High-level design",
      "Ingestion & schema",
      "Scale & stream design",
      "Reliability & edge cases",
      "Final recommendation",
    ]);
  });

  it("bounds a very long answer and flags the truncation", async () => {
    const session = await bootstrap(CLICKSTREAM);
    const long = `${ANSWER} ${"x".repeat(ANSWER_MAX_CHARS_PER_TURN + 800)}`;
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(session.sessionId, CLICKSTREAM, CS_ASSISTANT, messages(anchors, anchors.map(() => long))),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    const turn = json.answers[0].turns[0];
    expect(turn.text.length).toBeLessThanOrEqual(ANSWER_MAX_CHARS_PER_TURN + 1);
    expect(turn.truncated).toBe(true);
    expect(json.answers[0].truncated).toBe(true);
  });
});

describe("partial reports, refresh, authorization, and legacy safety", () => {
  const manifest = questionAnchorManifest(DA_ROUND, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
  const anchors = manifest.order.map((id) => manifest.anchors[id]);

  async function seedPartial() {
    const session = await bootstrap(DA_ROUND);
    // Only the first two questions are reached and answered.
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(
          session.sessionId,
          DA_ROUND,
          DA_ASSISTANT,
          messages(anchors.slice(0, 2), [ANSWER, ANSWER]),
        ),
      ) as any,
    );
    return session;
  }

  it("a partial report shows only the captured answers", async () => {
    const session = await seedPartial();
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.partial).toBe(true);
    expect(json.answers).toHaveLength(2);
    expect(json.answers.map((a: any) => a.id)).toEqual(manifest.order.slice(0, 2));
  });

  it("survives refresh: a fresh read with the same token returns identical answers", async () => {
    const session = await seedPartial();
    const first = await readReport(session.sessionId, session.reportToken);
    const second = await readReport(session.sessionId, session.reportToken);
    expect(second.json.answers).toEqual(first.json.answers);
    expect(second.json.answers).toHaveLength(2);
  });

  it("works after the call ended — no Vapi connection is involved in the read", async () => {
    const session = await seedPartial();
    expect(stored(session.sessionId).reportStatus).toBe("done");
    const { res, json } = await readReport(session.sessionId, session.reportToken);
    expect(res.status).toBe(200);
    expect(json.answers.length).toBeGreaterThan(0);
  });

  it("rejects an unauthorized report read (no answers leak)", async () => {
    const session = await seedPartial();
    const bad = await readReport(session.sessionId, "wrong-token");
    expect(bad.res.status).toBe(404);
    expect(bad.json.answers).toBeUndefined();

    const missing = await reportGET(
      new Request(`http://localhost/api/case/report/${session.sessionId}`) as any,
      { params: { sessionId: session.sessionId } },
    );
    expect(missing.status).toBe(404);
  });

  it("renders legacy reports safely: no stored transcript projects to an empty list", async () => {
    const session = await seedPartial();
    // Simulate a report written before answer projection existed.
    const record = stored(session.sessionId);
    redisStore.set(`voice-session:${session.sessionId}`, {
      value: { ...record, normalizedTranscript: null },
    });
    const { res, json } = await readReport(session.sessionId, session.reportToken);
    expect(res.status).toBe(200);
    expect(json.status).toBe("done");
    expect(json.answers).toEqual([]);
    // The rest of the report is unaffected.
    expect(json.score.dimension_scores).toHaveLength(5);
  });

  it("never projects system messages or private vocabulary", async () => {
    const session = await seedPartial();
    const { json } = await readReport(session.sessionId, session.reportToken);
    const serialized = JSON.stringify(json.answers);
    for (const forbidden of [
      "SYSTEM PROMPT",
      "target elements",
      "red flags",
      "acceptable_alternatives",
      "red_flags",
      "strong_answer_outline",
      "reportFencingToken",
      "expectedAssistantId",
      "max_tokens",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  it("consulting cases project no answers (their report surface is unchanged)", async () => {
    process.env.VAPI_AIRPORT_ASSISTANT_ID = "asst-airport";
    process.env.CASE_VOICE_ARCHITECTURE = "vapi_native";
    const stageManifest = caseStageAnchorManifest(
      "airport_profitability",
      CASE_VOICE_STAGE_ANCHOR_VERSION,
    )!;
    const stageAnchors = CASE_REPORT_STAGES.map((stage) => stageManifest.anchors[stage]);
    const session = await bootstrap("airport_profitability");
    await reportPOST(
      request(
        "http://localhost/api/vapi/case/report",
        payload(
          session.sessionId,
          "airport_profitability",
          "asst-airport",
          messages(stageAnchors, stageAnchors.map(() => ANSWER)),
        ),
      ) as any,
    );
    const { json } = await readReport(session.sessionId, session.reportToken);
    expect(json.evaluatorType).toBe("consulting");
    expect(json.answers).toEqual([]);
    delete process.env.CASE_VOICE_ARCHITECTURE;
    delete process.env.VAPI_AIRPORT_ASSISTANT_ID;
  });
});
