import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CASE_VOICE_PENDING_KEY,
  CASE_VOICE_PENDING_TTL_MS,
  CASE_VOICE_TRANSCRIPT_DEFAULT_EXPANDED,
  CaseProjectionUnavailableError,
  caseVoiceControls,
  caseVoiceElapsedMilliseconds,
  caseVoiceEndedNotice,
  caseVoiceEndedReason,
  formatCaseVoiceElapsed,
  caseVoiceLiveCaption,
  caseVoiceRecoveryMessage,
  caseVoiceStartAvailability,
  caseVoiceStartOverrides,
  caseVoiceTranscript,
  fetchCaseVoiceProjection,
  fetchPreviewCatalog,
  readCaseVoicePending,
  shouldApplyCaseProjection,
  uniqueCaseExhibits,
  writeCaseVoicePending,
  type CaseVoiceProjection,
  type PendingCaseVoiceCapability,
  type PreviewCaseChoice,
} from "@/components/CaseVoiceInterview";
import { PREVIEW_LLM_CASES } from "@/lib/voice/case-catalog";
import type { CaseExhibit, CaseScore } from "@/lib/types";

const CATALOG_CASES: PreviewCaseChoice[] = [
  { id: "airport_profitability", title: "Airport Profitability", description: "Airport case." },
  { id: "gcc_premium_gym_market_entry", title: "GCC Premium Gym Market Entry", description: "Gym case." },
];

describe("Case Voice two-case picker state", () => {
  it("cannot start an interview while the catalog is loading", () => {
    const view = caseVoiceStartAvailability({
      catalogStatus: "loading",
      cases: [],
      selectedCaseId: null,
      configured: true,
    });
    expect(view).toMatchObject({ showLoading: true, showCases: false, canStart: false, canRetry: false });
  });

  it("cannot start on a catalog error but offers Retry", () => {
    const view = caseVoiceStartAvailability({
      catalogStatus: "error",
      cases: [],
      selectedCaseId: null,
      configured: true,
    });
    expect(view).toMatchObject({ showError: true, canStart: false, canRetry: true });
  });

  it("keeps Start disabled until a valid case is explicitly selected", () => {
    const base = { catalogStatus: "loaded" as const, cases: CATALOG_CASES, configured: true };
    expect(caseVoiceStartAvailability({ ...base, selectedCaseId: null }).canStart).toBe(false);
    expect(caseVoiceStartAvailability({ ...base, selectedCaseId: "not_a_case" }).canStart).toBe(false);
    expect(caseVoiceStartAvailability({ ...base, selectedCaseId: "airport_profitability" }).canStart).toBe(true);
    expect(caseVoiceStartAvailability({ ...base, selectedCaseId: "gcc_premium_gym_market_entry" }).canStart).toBe(true);
    // Unconfigured voice can never start.
    expect(
      caseVoiceStartAvailability({ ...base, selectedCaseId: "airport_profitability", configured: false }).canStart,
    ).toBe(false);
  });

  it("loads the catalog and reloads it on retry", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ cases: CATALOG_CASES }), { status: 200 }));
    const loaded = await fetchPreviewCatalog(fetcher as unknown as typeof fetch);
    expect(loaded.status).toBe("loaded");
    expect(loaded.cases.map((entry) => entry.id)).toEqual([
      "airport_profitability",
      "gcc_premium_gym_market_entry",
    ]);
    await fetchPreviewCatalog(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports an error state on a failed or unparseable catalog fetch", async () => {
    const http500 = vi.fn(async () => new Response("nope", { status: 500 }));
    expect(await fetchPreviewCatalog(http500 as unknown as typeof fetch)).toMatchObject({ status: "error", cases: [] });
    const network = vi.fn(async () => { throw new Error("network"); });
    expect(await fetchPreviewCatalog(network as unknown as typeof fetch)).toMatchObject({ status: "error", cases: [] });
  });

  it("offers exactly the two cases and no Beautify or Diconsa options", () => {
    const ids = PREVIEW_LLM_CASES.map((entry) => entry.id);
    expect(ids).toEqual(["airport_profitability", "gcc_premium_gym_market_entry"]);
    expect(ids).not.toContain("beautify");
    expect(ids).not.toContain("diconsa");
  });
});

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
    openingText: "Opening prompt",
    readinessStatus: "awaiting",
    readinessConfirmedAt: null,
    conversationStatus: "active",
    liveStatus: "active",
    concludedAt: null,
    stage: "intro",
    stageIndex: 0,
    complete: false,
    turnSeq: 0,
    responseSeq: 0,
    lastAction: null,
    score: null,
    exhibits: [],
    turns: [],
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
  it("passes only the selected-case bootstrap variables and session metadata to Vapi", () => {
    const bootstrap = {
      sessionId: "case-session-1",
      projectionToken: "never-forward-this-token",
      openingPrompt: "Here is the authored opening.",
      caseId: "airport_profitability",
      caseTitle: "Airport Profitability",
    };

    expect(caseVoiceStartOverrides(bootstrap)).toEqual({
      variableValues: {
        sessionId: "case-session-1",
        openingPrompt: "Here is the authored opening.",
        caseTitle: "Airport Profitability",
      },
      metadata: { sessionId: "case-session-1", caseId: "airport_profitability" },
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

  it("applies a processed conversational response without incrementing Case turnSeq", () => {
    const current = projection({ turnSeq: 1, responseSeq: 2 });
    const conversationReply = projection({
      turnSeq: 1,
      responseSeq: 3,
      conversationStatus: "paused",
    });

    expect(shouldApplyCaseProjection(current, conversationReply)).toBe(true);
    expect(conversationReply.turnSeq).toBe(1);
  });

  it("applies a concluded-unscored projection without pretending completion or a score", () => {
    const current = projection({ turnSeq: 5, responseSeq: 5, liveStatus: "active" });
    const concluded = projection({
      turnSeq: 5,
      responseSeq: 5,
      liveStatus: "concluded_unscored",
      concludedAt: "2026-07-20T12:05:00.000Z",
      stage: "scoring",
      stageIndex: 7,
      complete: false,
      score: null,
    });

    expect(shouldApplyCaseProjection(current, concluded)).toBe(true);
    expect(concluded.complete).toBe(false);
    expect(concluded.score).toBeNull();
  });

  it("applies the readiness opening without requiring a scored turn", () => {
    const awaiting = projection({ openingText: "Are you ready?", readinessStatus: "awaiting" });
    const confirmed = projection({
      openingText: "Are you ready?\n\nGreat, let’s begin.\n\nAuthored prompt",
      readinessStatus: "confirmed",
    });

    expect(shouldApplyCaseProjection(awaiting, confirmed)).toBe(true);
    expect(confirmed.turnSeq).toBe(0);
    expect(confirmed.turns).toEqual([]);
    expect(caseVoiceRecoveryMessage(awaiting)).toContain("pre-case session was recovered");
    expect(caseVoiceRecoveryMessage(confirmed)).toContain("progress was recovered from this session");
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
    const turns = [
      {
        turnSeq: 1,
        candidateText: "My answer",
        interviewerText: "What would you clarify?",
        stage: "clarification" as const,
        action: "advance",
        exhibit: null,
        timestamp: "2026-07-17T12:00:00.000Z",
      },
      {
        turnSeq: 1,
        candidateText: "My answer",
        interviewerText: "What would you clarify?",
        stage: "clarification" as const,
        action: "advance",
        exhibit: null,
        timestamp: "2026-07-17T12:00:00.000Z",
      },
    ];

    expect(caseVoiceTranscript("Opening prompt", turns)).toEqual([
      { role: "assistant", text: "Opening prompt", turnSeq: 0, action: null },
      { role: "user", text: "My answer", turnSeq: 1, action: null },
      {
        role: "assistant",
        text: "What would you clarify?",
        turnSeq: 1,
        action: "advance",
      },
    ]);
  });

  it("keeps the transcript collapsed by default and orders canonical turns by turnSeq", () => {
    expect(CASE_VOICE_TRANSCRIPT_DEFAULT_EXPANDED).toBe(false);
    const turns = [
      {
        turnSeq: 2,
        candidateText: "Second answer",
        interviewerText: "Second response",
        stage: "analysis" as const,
        action: "advance",
        exhibit: null,
        timestamp: "2026-07-17T12:00:02.000Z",
      },
      {
        turnSeq: 1,
        candidateText: "First answer",
        interviewerText: "First response",
        stage: "framework" as const,
        action: "probe",
        exhibit: null,
        timestamp: "2026-07-17T12:00:01.000Z",
      },
    ];

    expect(caseVoiceTranscript("Opening", turns).map((line) => line.text)).toEqual([
      "Opening",
      "First answer",
      "First response",
      "Second answer",
      "Second response",
    ]);
  });

  it("uses the backend readiness timestamp and freezes the interview timer", () => {
    const startedAt = "2026-07-17T12:00:00.000Z";
    const now = Date.parse("2026-07-17T12:03:40.000Z");
    const endedAt = Date.parse("2026-07-17T12:02:05.000Z");

    expect(formatCaseVoiceElapsed(caseVoiceElapsedMilliseconds(null, now))).toBe("00:00");
    expect(formatCaseVoiceElapsed(caseVoiceElapsedMilliseconds(startedAt, now))).toBe("03:40");
    expect(formatCaseVoiceElapsed(caseVoiceElapsedMilliseconds(startedAt, now, endedAt))).toBe("02:05");
  });

  it("extracts an ended reason without requiring transcript or call content", () => {
    expect(caseVoiceEndedReason({ call: { endedReason: "customer-ended-call" } }))
      .toBe("customer-ended-call");
    expect(caseVoiceEndedReason({ message: { call: { endedReason: "silence-timed-out" } } }))
      .toBe("silence-timed-out");
    expect(caseVoiceEndedReason({ type: "call-end" })).toBeNull();
  });

  it("maps silence-ended calls to a neutral preserved-progress notice", () => {
    expect(caseVoiceEndedNotice("Silence")).toBe(
      "The voice call ended after a period of silence. Your backend progress from this session is preserved.",
    );
    expect(caseVoiceEndedNotice("silence-timed-out")).toContain("period of silence");
    expect(caseVoiceEndedNotice("customer-ended-call")).toBe(
      "The voice call ended. Your backend progress from this session is preserved.",
    );
  });

  it("uses only the backend projection for permanent assistant speech", () => {
    const transcript = caseVoiceTranscript("Opening prompt", []);

    expect(transcript).toEqual([
      { role: "assistant", text: "Opening prompt", turnSeq: 0, action: null },
    ]);
  });

  it("keeps partial and final Vapi transcripts as temporary captions only", () => {
    expect(caseVoiceLiveCaption({
      type: "transcript",
      role: "user",
      transcriptType: "partial",
      transcript: "What time",
    })).toBe("What time");
    expect(caseVoiceLiveCaption({
      type: "transcript",
      role: "user",
      transcriptType: "final",
      transcript: "What time horizon should we use?",
    })).toBe("What time horizon should we use?");
    expect(caseVoiceLiveCaption({
      type: "transcript",
      role: "assistant",
      transcriptType: "final",
      transcript: "Assistant speech",
    })).toBeNull();
    expect(caseVoiceTranscript("Opening prompt", [])).toHaveLength(1);
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
  it("treats an empty fresh browser state as a new session without recovery", () => {
    const { storage } = memoryStorage();

    expect(readCaseVoicePending(100_000, storage)).toEqual({
      pending: null,
      expired: false,
    });
  });

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

  it("does not expose mute until the Vapi SDK instance is ready", () => {
    expect(caseVoiceControls("connecting", true, false)).toEqual({
      start: false,
      mute: false,
      end: true,
    });
  });
});
