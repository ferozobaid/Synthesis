import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));

vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return { ...actual, complete: completeMock };
});

import {
  parseCasePostCallModelScores,
  scoreCasePostCall,
} from "@/lib/voice/case-post-call-scorer";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  mapCaseTranscript,
} from "@/lib/voice/case-transcript";
import { CASE_VOICE_STAGE_ANCHOR_VERSION } from "@/lib/voice/case-native-config";
import { normalizeVoiceTranscript } from "@/lib/voice/transcript";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";

const AIRPORT = "airport_profitability";
const EXPECTED_DIMENSIONS = [
  "structure",
  "hypothesis_driven_thinking",
  "quantitative_reasoning",
  "synthesis",
  "communication",
] as const;

function mappedFullTranscript() {
  const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  const normalized = normalizeVoiceTranscript(CASE_REPORT_STAGES.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    {
      role: "user",
      message: `For ${stage}, I would structure the evidence, test a hypothesis, quantify the result, and synthesize an answer.`,
    },
  ]));
  return mapCaseTranscript(
    AIRPORT,
    CASE_VOICE_STAGE_ANCHOR_VERSION,
    normalized.turns,
    { truncated: normalized.truncated },
  )!;
}

function proposal(rows: Array<{ dimension: string; score: number }>): string {
  return JSON.stringify({ dimensionScores: rows });
}

function validRows(score = 4) {
  return EXPECTED_DIMENSIONS.map((dimension) => ({ dimension, score }));
}

async function deterministicReport() {
  process.env.SYNTHESIS_USE_MOCKS = "true";
  const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mappedFullTranscript());
  expect(result.ok).toBe(true);
  return result;
}

async function expectDeterministicFallback(modelOutput: string) {
  const expected = await deterministicReport();
  process.env.SYNTHESIS_USE_MOCKS = "false";
  completeMock.mockResolvedValueOnce(modelOutput);
  const actual = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mappedFullTranscript());
  expect(completeMock).toHaveBeenCalledTimes(1);
  expect(actual).toEqual(expected);
  if (actual.ok) {
    expect(actual.report.partial).toBe(false);
    expect(actual.report.score.overall).not.toBeNull();
  }
}

beforeEach(() => {
  completeMock.mockReset();
});

afterEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("Case post-call exact model dimension contract", () => {
  it("accepts exactly the five unique required dimensions", () => {
    expect(parseCasePostCallModelScores({ dimensionScores: validRows() })).toEqual({
      structure: 4,
      hypothesis_driven_thinking: 4,
      quantitative_reasoning: 4,
      synthesis: 4,
      communication: 4,
    });
  });

  it("rejects a missing dimension and uses the deterministic fallback", async () => {
    await expectDeterministicFallback(proposal(validRows().slice(0, 4)));
  });

  it("rejects duplicate dimensions and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[2] = { dimension: "hypothesis_driven_thinking", score: 5 } as any;
    await expectDeterministicFallback(proposal(rows));
  });

  it("rejects unknown dimensions and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[2] = { dimension: "commercial_magic", score: 5 } as any;
    await expectDeterministicFallback(proposal(rows));
  });

  it("rejects invalid scores and uses the deterministic fallback", async () => {
    const rows = validRows();
    rows[0] = { dimension: "structure", score: 6 };
    await expectDeterministicFallback(proposal(rows));
  });
});
