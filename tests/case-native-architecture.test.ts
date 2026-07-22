import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CASE_VOICE_STAGE_ANCHOR_VERSION,
  resolveCaseVoiceArchitecture,
  resolveNativeCaseAssistant,
  storedCaseVoiceArchitecture,
} from "@/lib/voice/case-native-config";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  mapCaseTranscript,
} from "@/lib/voice/case-transcript";
import { issueReportCapability, verifyReportCapability } from "@/lib/voice/report-capability";
import {
  normalizeVoiceTranscript,
  VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS,
} from "@/lib/voice/transcript";
import { scoreCasePostCall } from "@/lib/voice/case-post-call-scorer";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import {
  clearPendingNativeCaseReport,
  fullAuthoritativeCaseScore,
  readPendingNativeCaseReport,
  writePendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";

const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";
const airportManifest = readFileSync("context/vapi/airport-profitability-assistant-v1.md", "utf8");
const gymManifest = readFileSync("context/vapi/gcc-premium-gym-assistant-v1.md", "utf8");

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function fullTranscript(caseId = AIRPORT) {
  const manifest = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  return normalizeVoiceTranscript(CASE_REPORT_STAGES.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    { role: "user", message: `My ${stage} answer has a clear hypothesis, because evidence supports it, and I would test the result.` },
  ])).turns;
}

beforeEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("native Case architecture and closed configuration", () => {
  it("resolves missing stored architecture to custom_llm", () => {
    expect(storedCaseVoiceArchitecture({})).toBe("custom_llm");
  });

  it("uses the environment only when resolving a new bootstrap", () => {
    expect(resolveCaseVoiceArchitecture({ CASE_VOICE_ARCHITECTURE: "vapi_native" })).toBe("vapi_native");
    expect(storedCaseVoiceArchitecture({ architecture: "custom_llm" })).toBe("custom_llm");
  });

  it("defaults invalid architecture values to custom_llm", () => {
    expect(resolveCaseVoiceArchitecture({ CASE_VOICE_ARCHITECTURE: "native-ish" })).toBe("custom_llm");
  });

  it("maps Airport only to the server-owned Airport assistant", () => {
    expect(resolveNativeCaseAssistant(AIRPORT, { VAPI_AIRPORT_ASSISTANT_ID: "asst-airport" }))
      .toMatchObject({ assistantId: "asst-airport", assistantConfigVersion: "airport-profitability-assistant-v1" });
  });

  it("maps Gym only to the server-owned Gym assistant", () => {
    expect(resolveNativeCaseAssistant(GYM, { VAPI_GCC_GYM_ASSISTANT_ID: "asst-gym" }))
      .toMatchObject({ assistantId: "asst-gym", assistantConfigVersion: "gcc-premium-gym-assistant-v1" });
  });

  it("rejects unknown cases and unconfigured assistants", () => {
    expect(resolveNativeCaseAssistant("beautify", { VAPI_AIRPORT_ASSISTANT_ID: "x" })).toBeNull();
    expect(resolveNativeCaseAssistant(AIRPORT, {})).toBeNull();
  });
});

describe("module-neutral report capability", () => {
  it("stores a hash distinct from the plaintext token", () => {
    const capability = issueReportCapability();
    expect(capability.token).toHaveLength(64);
    expect(capability.tokenHash).toHaveLength(64);
    expect(capability.tokenHash).not.toBe(capability.token);
  });

  it("verifies with a constant-length digest and rejects the wrong token", () => {
    const capability = issueReportCapability();
    expect(verifyReportCapability(capability.token, capability.tokenHash)).toBe(true);
    expect(verifyReportCapability("wrong", capability.tokenHash)).toBe(false);
  });
});

describe("generic transcript normalization", () => {
  it("retains only assistant and candidate text with stable ordinals", () => {
    const result = normalizeVoiceTranscript([
      { role: "system", message: "secret prompt" },
      { role: "assistant", message: "  Hello   there " },
      { role: "tool", message: "raw payload" },
      { role: "user", transcript: " My answer " },
      { role: "assistant", message: "" },
    ]);
    expect(result.turns).toEqual([
      { role: "assistant", text: "Hello there", ordinal: 0 },
      { role: "candidate", text: "My answer", ordinal: 1 },
    ]);
  });

  it("does not accept summaries or raw webhook fields as a transcript source", () => {
    expect(normalizeVoiceTranscript({ summary: "candidate secret", transcript: "raw" }).turns).toEqual([]);
  });

  it("bounds individual transcript entries", () => {
    const result = normalizeVoiceTranscript([{ role: "user", message: "x".repeat(VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS + 10) }]);
    expect(result.truncated).toBe(true);
    expect(result.turns[0].text).toHaveLength(VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS);
  });
});

describe("canonical stage mapping", () => {
  it("loads a versioned manifest for both assistants", () => {
    expect(caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)?.caseId).toBe(AIRPORT);
    expect(caseStageAnchorManifest(GYM, CASE_VOICE_STAGE_ANCHOR_VERSION)?.caseId).toBe(GYM);
    expect(caseStageAnchorManifest(AIRPORT, "wrong-version")).toBeNull();
  });

  it("maps exact assistant anchors in order", () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, fullTranscript())!;
    expect(mapped.observedStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.partial).toBe(false);
  });

  it("never lets candidate speech advance a stage", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const transcript = normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.clarification },
      { role: "user", message: manifest.anchors.framework },
    ]).turns;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, transcript)!;
    expect(mapped.observedStages).toEqual(["clarification"]);
    expect(mapped.turns.at(-1)?.stage).toBe("clarification");
  });

  it("keeps assistant probes and candidate corrections in the current stage", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const transcript = normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "First answer" },
      { role: "assistant", message: "What else would you include?" },
      { role: "user", message: "I would add economics." },
    ]).turns;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, transcript)!;
    expect(mapped.turns.every((turn) => turn.stage === "framework")).toBe(true);
  });

  it("marks missing stages as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "A structured answer." },
    ]).turns)!;
    expect(mapped.partial).toBe(true);
    expect(mapped.missingStages).toContain("recommendation");
  });

  it("marks a Recommendation anchor followed by immediate hangup as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const messages = CASE_REPORT_STAGES.flatMap((stage) => stage === "recommendation"
      ? [{ role: "assistant", message: manifest.anchors[stage] }]
      : [
          { role: "assistant", message: manifest.anchors[stage] },
          { role: "user", message: `Candidate response for ${stage}.` },
        ]);
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalizeVoiceTranscript(messages).turns,
    )!;
    expect(mapped.observedStages).toContain("recommendation");
    expect(mapped.partial).toBe(true);
  });

  it("marks a required middle stage with no subsequent candidate response as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const messages = CASE_REPORT_STAGES.flatMap((stage) => stage === "analysis"
      ? [{ role: "assistant", message: manifest.anchors[stage] }]
      : [
          { role: "assistant", message: manifest.anchors[stage] },
          { role: "user", message: `Candidate response for ${stage}.` },
        ]);
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalizeVoiceTranscript(messages).turns,
    )!;
    expect(mapped.observedStages).toContain("analysis");
    expect(mapped.partial).toBe(true);
  });

  it("marks an otherwise complete truncated normalization as partial", () => {
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      fullTranscript(),
      { truncated: true },
    )!;
    expect(mapped.observedStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.partial).toBe(true);
  });

  it("marks all required anchors and subsequent answers as full when not truncated", () => {
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      fullTranscript(),
      { truncated: false },
    )!;
    expect(mapped.partial).toBe(false);
  });

  it("assistant manifests contain anchors but no scoring or answer material", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("Canonical stage openings");
      expect(manifest).not.toMatch(/scoring rubric|target_solution|answer key|preferred recommendation|protected calculation/i);
    }
  });
});

describe("dedicated post-call scoring", () => {
  it("produces a full five-dimension report without FSM inventions", async () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, fullTranscript())!;
    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.partial).toBe(false);
    expect(result.report.score.dimension_scores).toHaveLength(5);
    expect(JSON.stringify(result.report)).not.toMatch(/hints_used|stage_attempts|exhibits_revealed|evaluations/);
  });

  it("does not fabricate an overall score for a partial transcript", async () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "I would use customer, economics, and execution buckets." },
    ]).turns)!;
    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);
    expect(result.ok && result.report.score.overall).toBeNull();
  });

  it("fails an empty or unusable transcript instead of creating a fake score", async () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, [])!;
    await expect(scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped))
      .resolves.toEqual({ ok: false, failureCode: "empty_transcript" });
  });
});

describe("native client capability recovery", () => {
  it("persists and recovers the capability for 115 minutes", () => {
    const target = memoryStorage();
    const pending = { sessionId: "s", reportToken: "t", caseId: AIRPORT, caseTitle: "Airport", assistantId: "a", createdAt: 100 };
    writePendingNativeCaseReport(pending, target);
    expect(readPendingNativeCaseReport(101, target)).toEqual(pending);
    clearPendingNativeCaseReport(target);
    expect(readPendingNativeCaseReport(101, target)).toBeNull();
  });

  it("expires old recovery capabilities", () => {
    const target = memoryStorage();
    writePendingNativeCaseReport({ sessionId: "s", reportToken: "t", caseId: AIRPORT, caseTitle: "Airport", assistantId: "a", createdAt: 0 }, target);
    expect(readPendingNativeCaseReport(116 * 60 * 1_000, target)).toBeNull();
  });

  it("updates readiness only for a full authoritative report", () => {
    const base = {
      caseId: AIRPORT,
      caseTitle: "Airport",
      observedStages: [...CASE_REPORT_STAGES],
      missingStages: [],
      failureCode: null,
      score: {
        overall: 4,
        dimension_scores: ["structure", "hypothesis", "quant", "synthesis", "communication"].map((dimension) => ({ dimension, score: 4, justification: "Observed.", evidence: "Evidence." })),
        strengths: [], improvements: [], next_focus: [],
      },
    } as any;
    expect(fullAuthoritativeCaseScore({ ...base, status: "done", partial: false })).not.toBeNull();
    expect(fullAuthoritativeCaseScore({ ...base, status: "done", partial: true })).toBeNull();
    expect(fullAuthoritativeCaseScore({ ...base, status: "failed", partial: false })).toBeNull();
  });
});
