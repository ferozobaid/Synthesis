import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CASE_VOICE_PENDING_KEY,
  CASE_VOICE_PENDING_TTL_MS,
  CaseProjectionUnavailableError,
  appendCaseVoiceTranscript,
  caseVoiceControls,
  caseVoiceStartOverrides,
  caseVoiceToolError,
  fetchCaseVoiceProjection,
  mergeCaseVoiceTranscript,
  readCaseVoicePending,
  shouldApplyCaseProjection,
  uniqueCaseExhibits,
  writeCaseVoicePending,
  type CaseVoiceProjection,
  type PendingCaseVoiceCapability,
} from "@/components/CaseVoiceInterview";
import type { CaseExhibit, CaseScore } from "@/lib/types";

const SCORE: CaseScore = {
  dimension_scores: [
    { dimension: "structure", score: 4, justification: "Clear structure." },
    { dimension: "hypothesis", score: 4, justification: "Tested a hypothesis." },
    { dimension: "quant", score: 5, justification: "Correct payback." },
    { dimension: "synthesis", score: 4, justification: "Used both exhibits." },
    { dimension: "communication", score: 4, justification: "Concise." },
  ],
  overall: 4.2,
  strengths: ["Strong economics"],
  improvements: ["Tighten risks"],
  next_focus: ["Pressure test"],
};

const EXHIBITS: CaseExhibit[] = [
  {
    id: "exhibit_investment",
    title: "Investment",
    stage: "data_reveal",
    synthesized: false,
    data: { payback: 1.28 },
  },
  {
    id: "exhibit_competitor_bots",
    title: "Competitor bots",
    stage: "data_reveal",
    synthesized: true,
    data: { leader: "Lena" },
  },
];

function projection(overrides: Partial<CaseVoiceProjection> = {}): CaseVoiceProjection {
  return {
    caseId: "beautify",
    caseTitle: "Beautify - Virtual Beauty Advisors",
    stage: "intro",
    stageIndex: 0,
    complete: false,
    turnSeq: 0,
    lastAction: null,
    score: null,
    exhibits: [],
    messages: [],
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

function capability(createdAt = 100_000): PendingCaseVoiceCapability {
  return {
    sessionId: "case-session-1",
    projectionToken: "projection-token-1",
    caseId: "beautify",
    caseTitle: "Beautify - Virtual Beauty Advisors",
    openingPrompt: "Beautify is considering a virtual-advisor shift. What is your initial view?",
    createdAt,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  } as unknown as Storage;
  return { values, storage };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CaseVoiceInterview Vapi start contract", () => {
  it("passes only the Beautify bootstrap variables and session metadata to Vapi", () => {
    const bootstrap = {
      sessionId: "case-session-1",
      projectionToken: "never-forward-this-token",
      openingPrompt: "Here is the authored opening.",
      caseTitle: "Beautify - Virtual Beauty Advisors",
    };

    expect(caseVoiceStartOverrides(bootstrap)).toEqual({
      variableValues: {
        sessionId: "case-session-1",
        openingPrompt: "Here is the authored opening.",
        caseTitle: "Beautify - Virtual Beauty Advisors",
      },
      metadata: { sessionId: "case-session-1", caseId: "beautify" },
    });
    expect(JSON.stringify(caseVoiceStartOverrides(bootstrap))).not.toContain("never-forward-this-token");
  });

  it("exposes explicit Start, mute/unmute, and End control states", () => {
    expect(caseVoiceControls("idle", false)).toEqual({ start: true, mute: false, end: false });
    expect(caseVoiceControls("connecting", true)).toEqual({ start: false, mute: true, end: true });
    expect(caseVoiceControls("listening", true)).toEqual({ start: false, mute: true, end: true });
    expect(caseVoiceControls("ended", false)).toEqual({ start: true, mute: false, end: false });
  });
});

describe("CaseVoiceInterview protected projection synchronization", () => {
  it("polls the protected endpoint with the projection capability", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(projection({ stage: "clarification", stageIndex: 1, turnSeq: 1 })), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await fetchCaseVoiceProjection(capability(), fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/api/case/voice/case-session-1", {
      headers: { "x-case-voice-token": "projection-token-1" },
    });
    expect(result.stage).toBe("clarification");
    expect(result.stageIndex).toBe(1);
  });

  it("accepts forward stage sequences and ignores duplicate or stale projections", () => {
    const current = projection({ stage: "framework", stageIndex: 2, turnSeq: 2 });
    const duplicate = projection({ stage: "framework", stageIndex: 2, turnSeq: 2 });
    const stale = projection({ stage: "clarification", stageIndex: 1, turnSeq: 1 });
    const next = projection({ stage: "analysis", stageIndex: 3, turnSeq: 3 });

    expect(shouldApplyCaseProjection(current, duplicate)).toBe(false);
    expect(shouldApplyCaseProjection(current, stale)).toBe(false);
    expect(shouldApplyCaseProjection(current, next)).toBe(true);
  });

  it("renders exhibits once and preserves backend-authored order", () => {
    const result = uniqueCaseExhibits([
      EXHIBITS[0],
      EXHIBITS[0],
      EXHIBITS[1],
      EXHIBITS[1],
    ]);

    expect(result.map((exhibit) => exhibit.id)).toEqual([
      "exhibit_investment",
      "exhibit_competitor_bots",
    ]);
  });

  it("keeps repeated projection events from duplicating live transcript lines", () => {
    const live = [
      { role: "assistant" as const, text: "Opening prompt" },
      { role: "user" as const, text: "My answer" },
    ];
    const messages = [
      { role: "candidate" as const, stage: "intro" as const, text: "My answer", action: null },
      {
        role: "interviewer" as const,
        stage: "clarification" as const,
        text: "What would you clarify?",
        action: "advance",
      },
    ];

    expect(mergeCaseVoiceTranscript(live, messages)).toEqual([
      { role: "assistant", text: "Opening prompt" },
      { role: "user", text: "My answer" },
      { role: "assistant", text: "What would you clarify?" },
    ]);
  });

  it("does not duplicate the seeded opening when Vapi emits the same final transcript", () => {
    const opening = { role: "assistant" as const, text: "Opening prompt" };

    expect(appendCaseVoiceTranscript([opening], { ...opening, text: "  Opening   prompt " })).toEqual([
      opening,
    ]);
  });

  it("treats the completed scoring projection as a terminal update", () => {
    const recommendation = projection({
      stage: "recommendation",
      stageIndex: 6,
      turnSeq: 8,
    });
    const complete = projection({
      stage: "scoring",
      stageIndex: 7,
      turnSeq: 9,
      complete: true,
      score: SCORE,
    });

    expect(shouldApplyCaseProjection(recommendation, complete)).toBe(true);
    expect(complete.score).toEqual(SCORE);
    expect(complete.score?.dimension_scores).toHaveLength(5);
  });

  it("maps an expired or unauthorized projection to a capability error", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    await expect(fetchCaseVoiceProjection(capability(), fetcher as typeof fetch)).rejects.toBeInstanceOf(
      CaseProjectionUnavailableError,
    );
  });
});

describe("CaseVoiceInterview refresh recovery", () => {
  it("persists and restores the projection capability without exposing it to Vapi", () => {
    const pending = capability(90_000);
    const { storage } = memoryStorage();

    writeCaseVoicePending(pending, storage);

    expect(readCaseVoicePending(100_000, storage)).toEqual({ pending, expired: false });
    expect(storage.setItem).toHaveBeenCalledWith(CASE_VOICE_PENDING_KEY, JSON.stringify(pending));
  });

  it("clears an expired recovered session", () => {
    const now = 200_000_000;
    const pending = capability(now - CASE_VOICE_PENDING_TTL_MS - 1);
    const { storage, values } = memoryStorage({
      [CASE_VOICE_PENDING_KEY]: JSON.stringify(pending),
    });

    expect(readCaseVoicePending(now, storage)).toEqual({ pending: null, expired: true });
    expect(values.has(CASE_VOICE_PENDING_KEY)).toBe(false);
  });

  it("surfaces backend tool failures without reading stage data from the transcript", () => {
    const message = {
      type: "tool-calls-result",
      toolCallResult: {
        result: JSON.stringify({ error: "turn_in_progress", stage: "analysis" }),
      },
    };

    expect(caseVoiceToolError(message)).toBe("turn_in_progress");
    expect(caseVoiceToolError({ type: "transcript", transcript: "stage: scoring" })).toBeNull();
  });
});
