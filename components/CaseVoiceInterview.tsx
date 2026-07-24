"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CASE_STATES, type CaseExhibit, type CaseScore, type CaseState } from "@/lib/types";
import { ChatBubble } from "@/components/ui/ChatBubble";
import { ExhibitCard } from "@/components/ui/ExhibitCard";
import { StageTracker } from "@/components/ui/StageTracker";
import { SectionLabel } from "@/components/ui/primitives";
import { to100 } from "@/components/ui/verdict";
import {
  NATIVE_CASE_LIVE_STAGE_LABELS,
  advanceNativeCaseLiveProgress,
  endNativeCaseLiveProgress,
  initialNativeCaseLiveProgress,
  nativeCaseLiveElapsedMilliseconds,
} from "@/lib/voice/case-native-live";
import CaseNativeVoiceInterview, {
  clearPendingNativeCaseReport,
  readPendingNativeCaseReport,
  writePendingNativeCaseReport,
  type PendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";

const WEB_KEY = process.env.NEXT_PUBLIC_VAPI_WEB_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_CASE_ASSISTANT_ID;

const POLL_INTERVAL_MS = 1_000;
const ENDED_POLL_GRACE_MS = 120_000;
const PROJECTION_404_GRACE_MS = 3_000;
const TRANSCRIPT_CAP = 200;
export const CASE_VOICE_PENDING_TTL_MS = 115 * 60 * 1_000;
export const CASE_VOICE_PENDING_KEY = "synthesis.voice.case.beautify.pending.v1";
export const CASE_VOICE_TRANSCRIPT_DEFAULT_EXPANDED = false;

const STAGE_LABEL: Record<CaseState, string> = {
  intro: "Intro",
  clarification: "Clarify",
  framework: "Framework",
  analysis: "Analysis",
  data_reveal: "Data",
  pressure_test: "Pressure",
  recommendation: "Recommend",
  scoring: "Score",
};

const ACTION_LABEL: Record<string, string> = {
  reveal: "New exhibit",
  hint: "Hint",
  pressure_test: "Pressure test",
};

interface VapiLike {
  on(event: string, cb: (payload?: unknown) => void): void;
  removeAllListeners?: () => void;
  start(assistant: string, overrides?: unknown): Promise<unknown>;
  stop(): Promise<void>;
  setMuted?(muted: boolean): void;
}

export type CaseVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "recovering"
  | "ended"
  | "completed"
  | "expired"
  | "error";

export interface CaseVoiceTranscriptLine {
  role: "assistant" | "user";
  text: string;
  turnSeq: number;
  action: string | null;
}

export interface CaseVoiceProjectedTurn {
  turnSeq: number;
  candidateText: string;
  interviewerText: string;
  stage: CaseState;
  stageBefore?: CaseState;
  stageAfter?: CaseState;
  candidateAction?: string;
  action: string;
  scorable?: boolean;
  exhibit: CaseExhibit | null;
  timestamp: string;
}

export interface CaseVoiceProjection {
  caseId: string;
  caseTitle: string;
  openingText: string;
  readinessStatus: "awaiting" | "confirmed";
  readinessConfirmedAt: string | null;
  conversationStatus: "active" | "paused";
  liveStatus: "active" | "concluded_unscored";
  concludedAt: string | null;
  stage: CaseState;
  stageIndex: number;
  complete: boolean;
  turnSeq: number;
  responseSeq: number;
  lastAction: string | null;
  score: CaseScore | null;
  exhibits: CaseExhibit[];
  turns: CaseVoiceProjectedTurn[];
  updatedAt: string;
}

export interface PendingCaseVoiceCapability {
  sessionId: string;
  projectionToken: string;
  caseId: string;
  caseTitle: string;
  openingPrompt: string;
  createdAt: number;
}

export interface PendingCaseVoiceReadResult {
  pending: PendingCaseVoiceCapability | null;
  expired: boolean;
}

export interface CaseBootstrap {
  architecture?: "custom_llm";
  sessionId: string;
  projectionToken: string;
  openingPrompt: string;
  caseId: string;
  caseTitle: string;
  caseDescription?: string | null;
}

export interface NativeCaseBootstrap {
  architecture: "vapi_native";
  sessionId: string;
  assistantId: string;
  reportToken: string;
  reportStatus: "pending";
  caseId: string;
  caseTitle: string;
}

export interface NativeCaseVoiceTranscriptLine {
  role: "assistant" | "user";
  text: string;
  sequence: number;
}

export interface PreviewCaseChoice {
  id: string;
  title: string;
  description: string;
}

type GridTrack = "case" | "technical";
type TechnicalRoleId = "data_analyst" | "data_engineer";

const TECHNICAL_ROLE_PREVIEWS: Array<{
  id: TechnicalRoleId;
  title: string;
  description: string;
  focus: string;
}> = [
  {
    id: "data_analyst",
    title: "Data Analyst",
    description:
      "Practice the judgment behind SQL, metrics, experimentation, and analytical storytelling.",
    focus: "SQL · metrics · experimentation",
  },
  {
    id: "data_engineer",
    title: "Data Engineer",
    description:
      "Prepare for data modeling, pipeline design, reliability, and production trade-offs.",
    focus: "Pipelines · modeling · reliability",
  },
];

export class CaseProjectionUnavailableError extends Error {
  constructor() {
    super("Case voice session not found or projection token rejected.");
    this.name = "CaseProjectionUnavailableError";
  }
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isCaseVoicePendingExpired(
  pending: Partial<PendingCaseVoiceCapability> | null,
  now = Date.now(),
): boolean {
  return (
    !pending ||
    typeof pending.createdAt !== "number" ||
    !Number.isFinite(pending.createdAt) ||
    now - pending.createdAt >= CASE_VOICE_PENDING_TTL_MS
  );
}

export function clearCaseVoicePending(storage = browserStorage()): void {
  try {
    storage?.removeItem(CASE_VOICE_PENDING_KEY);
  } catch {
    /* local recovery is best-effort */
  }
}

export function writeCaseVoicePending(
  pending: PendingCaseVoiceCapability,
  storage = browserStorage(),
): void {
  try {
    storage?.setItem(CASE_VOICE_PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* local recovery is best-effort */
  }
}

export function readCaseVoicePending(
  now = Date.now(),
  storage = browserStorage(),
): PendingCaseVoiceReadResult {
  try {
    const raw = storage?.getItem(CASE_VOICE_PENDING_KEY);
    if (!raw) return { pending: null, expired: false };
    const value = JSON.parse(raw) as Partial<PendingCaseVoiceCapability>;
    const valid =
      typeof value.caseId === "string" &&
      value.caseId.length > 0 &&
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      typeof value.projectionToken === "string" &&
      value.projectionToken.length > 0 &&
      typeof value.caseTitle === "string" &&
      typeof value.openingPrompt === "string" &&
      typeof value.createdAt === "number";
    if (!valid || isCaseVoicePendingExpired(value, now)) {
      clearCaseVoicePending(storage);
      return { pending: null, expired: true };
    }
    return { pending: value as PendingCaseVoiceCapability, expired: false };
  } catch {
    clearCaseVoicePending(storage);
    return { pending: null, expired: true };
  }
}

export function caseVoiceStartOverrides(bootstrap: CaseBootstrap) {
  return {
    variableValues: {
      sessionId: bootstrap.sessionId,
      openingPrompt: bootstrap.openingPrompt,
      caseTitle: bootstrap.caseTitle,
    },
    metadata: { sessionId: bootstrap.sessionId, caseId: bootstrap.caseId },
  };
}

export function nativeCaseVoiceStartOverrides(
  bootstrap: Pick<NativeCaseBootstrap, "sessionId" | "caseId">,
) {
  return {
    variableValues: {
      sessionId: bootstrap.sessionId,
      caseId: bootstrap.caseId,
    },
  };
}

export function caseVoiceCallStartContract(
  bootstrap: CaseBootstrap | NativeCaseBootstrap,
  customAssistantId: string | undefined,
): { assistantId: string; overrides: ReturnType<typeof caseVoiceStartOverrides> | ReturnType<typeof nativeCaseVoiceStartOverrides> } {
  if (bootstrap.architecture === "vapi_native") {
    return {
      assistantId: bootstrap.assistantId,
      overrides: nativeCaseVoiceStartOverrides(bootstrap),
    };
  }
  if (!customAssistantId) throw new Error("Case voice is not configured for this deployment.");
  return {
    assistantId: customAssistantId,
    overrides: caseVoiceStartOverrides(bootstrap),
  };
}

export async function startCaseVoiceSdkCall(
  vapi: Pick<VapiLike, "start">,
  contract: ReturnType<typeof caseVoiceCallStartContract>,
): Promise<unknown> {
  return vapi.start(contract.assistantId, contract.overrides);
}

export function shouldPreserveNativeCaseReportAfterStartFailure(
  pending: PendingNativeCaseReport | null,
): pending is PendingNativeCaseReport {
  return pending !== null;
}

export function nativeCaseVoiceTranscriptLine(
  message: unknown,
  sequence: number,
): NativeCaseVoiceTranscriptLine | null {
  const value = message as {
    type?: unknown;
    role?: unknown;
    transcriptType?: unknown;
    transcript?: unknown;
  } | null;
  const type = typeof value?.type === "string" ? value.type : "";
  const final = value?.transcriptType === "final" || type.includes('transcriptType="final"');
  if (
    !value ||
    (type !== "transcript" && !type.startsWith("transcript[")) ||
    !final ||
    (value.role !== "assistant" && value.role !== "user")
  ) {
    return null;
  }
  const text = typeof value.transcript === "string" ? value.transcript.trim() : "";
  return text ? { role: value.role, text, sequence } : null;
}

export function appendNativeCaseVoiceTranscript(
  current: NativeCaseVoiceTranscriptLine[],
  next: NativeCaseVoiceTranscriptLine,
): NativeCaseVoiceTranscriptLine[] {
  const previous = current.at(-1);
  if (previous?.role === next.role && previous.text === next.text) return current;
  const appended = [...current, next];
  return appended.length > TRANSCRIPT_CAP ? appended.slice(-TRANSCRIPT_CAP) : appended;
}

export function nativeCaseReportPollingReady(
  pending: PendingNativeCaseReport | null,
  callActive: boolean,
): pending is PendingNativeCaseReport {
  return pending !== null && !callActive;
}

export function gridTrackSelectorVisible(input: {
  recoveryChecked: boolean;
  callActive: boolean;
  capability: PendingCaseVoiceCapability | null;
  nativeCapability: PendingNativeCaseReport | null;
  nativeLiveCapability: PendingNativeCaseReport | null;
}): boolean {
  return (
    input.recoveryChecked &&
    !input.callActive &&
    !input.capability &&
    !input.nativeCapability &&
    !input.nativeLiveCapability
  );
}

export function caseVoiceControls(
  status: CaseVoiceStatus,
  callActive: boolean,
  sdkReady = callActive,
) {
  return {
    start:
      !callActive &&
      (status === "idle" || status === "ended" || status === "expired" || status === "error"),
    mute: callActive && sdkReady,
    end: callActive,
  };
}

export type CaseCatalogStatus = "loading" | "loaded" | "error";

/** Load the two selectable Preview LLM cases. Any failure (or empty list) is an error state. */
export async function fetchPreviewCatalog(
  fetcher: typeof fetch = fetch,
): Promise<{ status: "loaded" | "error"; cases: PreviewCaseChoice[] }> {
  try {
    const response = await fetcher("/api/case/catalog");
    if (!response.ok) return { status: "error", cases: [] };
    const parsed = (await response.json()) as { cases?: unknown };
    const cases = Array.isArray(parsed.cases)
      ? parsed.cases.filter(
          (entry): entry is PreviewCaseChoice =>
            Boolean(entry) &&
            typeof (entry as PreviewCaseChoice).id === "string" &&
            typeof (entry as PreviewCaseChoice).title === "string" &&
            typeof (entry as PreviewCaseChoice).description === "string",
        )
      : [];
    return cases.length > 0 ? { status: "loaded", cases } : { status: "error", cases: [] };
  } catch {
    return { status: "error", cases: [] };
  }
}

export interface CaseCatalogView {
  showLoading: boolean;
  showError: boolean;
  showCases: boolean;
  canRetry: boolean;
  canStart: boolean;
}

/**
 * Pure Start/retry availability for the catalog picker. Start is only ever
 * enabled once the catalog has loaded, voice is configured, and the candidate
 * has explicitly selected one of the loaded cases.
 */
export function caseVoiceStartAvailability(input: {
  catalogStatus: CaseCatalogStatus;
  cases: PreviewCaseChoice[];
  selectedCaseId: string | null;
  configured: boolean;
}): CaseCatalogView {
  const selectionValid =
    input.selectedCaseId !== null &&
    input.cases.some((entry) => entry.id === input.selectedCaseId);
  return {
    showLoading: input.catalogStatus === "loading",
    showError: input.catalogStatus === "error",
    showCases: input.catalogStatus === "loaded",
    canRetry: input.catalogStatus === "error",
    canStart: input.catalogStatus === "loaded" && input.configured && selectionValid,
  };
}

export function uniqueCaseExhibits(exhibits: CaseExhibit[]): CaseExhibit[] {
  const seen = new Set<string>();
  return exhibits.filter((exhibit) => {
    if (!exhibit?.id || seen.has(exhibit.id)) return false;
    seen.add(exhibit.id);
    return true;
  });
}

export function shouldApplyCaseProjection(
  current: CaseVoiceProjection | null,
  next: CaseVoiceProjection,
): boolean {
  if (!current) return true;
  if (next.turnSeq !== current.turnSeq) return next.turnSeq > current.turnSeq;
  if (next.responseSeq !== current.responseSeq) return next.responseSeq > current.responseSeq;
  if (next.openingText !== current.openingText) return true;
  if (next.readinessStatus !== current.readinessStatus) return true;
  if (next.liveStatus !== current.liveStatus) return true;
  if (!current.complete && next.complete) return true;
  if (!current.score && next.score) return true;
  if (next.turns.length > current.turns.length) return true;
  if (next.exhibits.length > current.exhibits.length) return true;
  return false;
}

export function caseVoiceTranscript(
  openingText: string,
  turns: CaseVoiceProjectedTurn[],
): CaseVoiceTranscriptLine[] {
  const ordered = [...turns].sort((a, b) => a.turnSeq - b.turnSeq);
  const seen = new Set<number>();
  const lines: CaseVoiceTranscriptLine[] = [
    { role: "assistant", text: openingText, turnSeq: 0, action: null },
  ];
  for (const turn of ordered) {
    if (seen.has(turn.turnSeq)) continue;
    seen.add(turn.turnSeq);
    lines.push({
      role: "user",
      text: turn.candidateText,
      turnSeq: turn.turnSeq,
      action: null,
    });
    lines.push({
      role: "assistant",
      text: turn.interviewerText,
      turnSeq: turn.turnSeq,
      action: turn.action,
    });
  }
  return lines.length > TRANSCRIPT_CAP ? lines.slice(-TRANSCRIPT_CAP) : lines;
}

export function caseVoiceLiveCaption(message: unknown): string | null {
  const value = message as {
    type?: string;
    role?: string;
    transcriptType?: string;
    transcript?: string;
  } | null;
  if (
    !value ||
    (value.type !== "transcript" && !value.type?.startsWith("transcript[")) ||
    value.role !== "user" ||
    (value.transcriptType !== undefined &&
      value.transcriptType !== "partial" &&
      value.transcriptType !== "final")
  ) {
    return null;
  }
  const text = typeof value.transcript === "string" ? value.transcript.trim() : "";
  return text || null;
}

export function caseVoiceRecoveryMessage(projection: CaseVoiceProjection): string {
  return projection.readinessStatus === "awaiting"
    ? "A previous pre-case session was recovered. Start a new interview when you’re ready."
    : "Your Case progress was recovered from this session. Start a new interview to continue live.";
}

export function caseVoiceElapsedMilliseconds(
  readinessConfirmedAt: string | null,
  now: number,
  endedAt: number | null = null,
): number {
  if (!readinessConfirmedAt) return 0;
  const startedAt = Date.parse(readinessConfirmedAt);
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, (endedAt ?? now) - startedAt);
}

export function formatCaseVoiceElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function caseVoiceEndedReason(payload: unknown): string | null {
  const value = payload as {
    endedReason?: unknown;
    call?: { endedReason?: unknown };
    message?: { endedReason?: unknown; call?: { endedReason?: unknown } };
  } | null;
  const candidates = [
    value?.endedReason,
    value?.call?.endedReason,
    value?.message?.endedReason,
    value?.message?.call?.endedReason,
  ];
  return candidates.find((candidate): candidate is string =>
    typeof candidate === "string" && candidate.trim().length > 0
  )?.trim() ?? null;
}

export function caseVoiceEndedNotice(endedReason: string | null): string {
  return endedReason && /silence/i.test(endedReason)
    ? "The voice call ended after a period of silence. Your backend progress from this session is preserved."
    : "The voice call ended. Your backend progress from this session is preserved.";
}

function isCaseState(value: unknown): value is CaseState {
  return typeof value === "string" && (CASE_STATES as readonly string[]).includes(value);
}

function parseProjection(value: unknown): CaseVoiceProjection {
  const projection = value as Partial<CaseVoiceProjection> | null;
  if (
    !projection ||
    typeof projection.caseId !== "string" ||
    !projection.caseId ||
    typeof projection.caseTitle !== "string" ||
    typeof projection.openingText !== "string" ||
    !isCaseState(projection.stage) ||
    typeof projection.complete !== "boolean" ||
    typeof projection.turnSeq !== "number" ||
    !Array.isArray(projection.exhibits) ||
    !Array.isArray(projection.turns) ||
    typeof projection.updatedAt !== "string"
  ) {
    throw new Error("The Case projection response was invalid.");
  }
  return {
    ...projection,
    readinessStatus: projection.readinessStatus === "awaiting" ? "awaiting" : "confirmed",
    readinessConfirmedAt:
      typeof projection.readinessConfirmedAt === "string"
        ? projection.readinessConfirmedAt
        : null,
    conversationStatus: projection.conversationStatus === "paused" ? "paused" : "active",
    liveStatus: projection.liveStatus === "concluded_unscored" ? "concluded_unscored" : "active",
    concludedAt: typeof projection.concludedAt === "string" ? projection.concludedAt : null,
    stageIndex: CASE_STATES.indexOf(projection.stage),
    responseSeq:
      typeof projection.responseSeq === "number"
        ? projection.responseSeq
        : projection.turnSeq,
    lastAction: typeof projection.lastAction === "string" ? projection.lastAction : null,
    score: projection.score ?? null,
    exhibits: uniqueCaseExhibits(projection.exhibits as CaseExhibit[]),
    turns: projection.turns as CaseVoiceProjectedTurn[],
  } as CaseVoiceProjection;
}

export async function fetchCaseVoiceProjection(
  pending: Pick<PendingCaseVoiceCapability, "sessionId" | "projectionToken">,
  fetcher: typeof fetch = fetch,
): Promise<CaseVoiceProjection> {
  const response = await fetcher(
    `/api/case/voice/${encodeURIComponent(pending.sessionId)}`,
    { headers: { "x-case-voice-token": pending.projectionToken } },
  );
  if (response.status === 404) throw new CaseProjectionUnavailableError();
  if (!response.ok) throw new Error("Could not synchronize the Case interview.");
  return parseProjection(await response.json());
}

function statusLabel(status: CaseVoiceStatus): string {
  if (status === "connecting") return "Connecting to your interviewer...";
  if (status === "listening") return "Listening - go ahead";
  if (status === "speaking") return "Interviewer is speaking...";
  if (status === "recovering") return "Recovering your Case progress...";
  if (status === "ended") return "Voice interview ended";
  if (status === "completed") return "Case complete";
  if (status === "expired") return "Voice session expired";
  if (status === "error") return "Voice interview unavailable";
  return "Voice interview ready";
}

export default function CaseVoiceInterview({
  onComplete,
}: {
  onComplete?: (score: CaseScore, context?: { preserveNativeReport?: boolean }) => void;
}) {
  // Native sessions receive their closed-mapped assistant id from bootstrap;
  // only the public Web SDK key is needed before the architecture is known.
  const configured = Boolean(WEB_KEY);
  const [catalogStatus, setCatalogStatus] = useState<CaseCatalogStatus>("loading");
  const [catalog, setCatalog] = useState<PreviewCaseChoice[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<GridTrack | null>(null);
  const [selectedTechnicalRole, setSelectedTechnicalRole] =
    useState<TechnicalRoleId | null>(null);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [status, setStatus] = useState<CaseVoiceStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [capability, setCapability] = useState<PendingCaseVoiceCapability | null>(null);
  const [nativeCapability, setNativeCapability] = useState<PendingNativeCaseReport | null>(null);
  const [nativeLiveCapability, setNativeLiveCapability] = useState<PendingNativeCaseReport | null>(null);
  const [nativeTranscript, setNativeTranscript] = useState<NativeCaseVoiceTranscriptLine[]>([]);
  const [projection, setProjection] = useState<CaseVoiceProjection | null>(null);
  const [liveCaption, setLiveCaption] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(CASE_VOICE_TRANSCRIPT_DEFAULT_EXPANDED);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [timerEndedAt, setTimerEndedAt] = useState<number | null>(null);
  const [nativeLiveProgress, setNativeLiveProgress] = useState(
    initialNativeCaseLiveProgress,
  );

  const vapiRef = useRef<VapiLike | null>(null);
  const nativeLiveCapabilityRef = useRef<PendingNativeCaseReport | null>(null);
  const projectionRef = useRef<CaseVoiceProjection | null>(null);
  const callActiveRef = useRef(false);
  const statusRef = useRef<CaseVoiceStatus>("idle");
  const recoveredRef = useRef(false);
  const endedAtRef = useRef<number | null>(null);
  const firstNotFoundAtRef = useRef<number | null>(null);
  const completionReportedRef = useRef(false);
  const startAttemptRef = useRef(0);
  const lastFinalTranscriptAtRef = useRef<number | null>(null);
  const endedReasonRef = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  statusRef.current = status;

  const setCallIsActive = useCallback((active: boolean) => {
    callActiveRef.current = active;
    setCallActive(active);
  }, []);

  const teardown = useCallback(() => {
    const vapi = vapiRef.current;
    vapiRef.current = null;
    setSdkReady(false);
    try {
      vapi?.removeAllListeners?.();
    } catch {
      /* no-op */
    }
    try {
      if (vapi) void vapi.stop().catch(() => {});
    } catch {
      /* call already ended */
    }
    setCallIsActive(false);
    setMuted(false);
  }, [setCallIsActive]);

  const reportCompletion = useCallback((score: CaseScore) => {
    if (completionReportedRef.current) return;
    completionReportedRef.current = true;
    clearCaseVoicePending();
    clearPendingNativeCaseReport();
    onCompleteRef.current?.(score);
  }, []);

  const reportNativeCompletion = useCallback((score: CaseScore) => {
    if (completionReportedRef.current) return;
    completionReportedRef.current = true;
    clearCaseVoicePending();
    clearPendingNativeCaseReport();
    onCompleteRef.current?.(score, { preserveNativeReport: true });
  }, []);

  const expireSession = useCallback(() => {
    startAttemptRef.current += 1;
    teardown();
    const expiredAt = Date.now();
    endedAtRef.current = expiredAt;
    setTimerEndedAt(expiredAt);
    clearCaseVoicePending();
    setCapability(null);
    setStatus("expired");
    setNotice(null);
    setError("This Case voice session expired or its projection token is no longer valid.");
  }, [teardown]);

  const handleCallEnd = useCallback((payload?: unknown) => {
    startAttemptRef.current += 1;
    const endedReason = caseVoiceEndedReason(payload) ?? endedReasonRef.current;
    console.info("[case-voice] lifecycle", {
      event: "call-ended",
      endedReason: endedReason ?? "unavailable",
      timestamp: new Date().toISOString(),
    });
    const vapi = vapiRef.current;
    vapiRef.current = null;
    try {
      vapi?.removeAllListeners?.();
    } catch {
      /* call has already ended */
    }
    setSdkReady(false);
    setCallIsActive(false);
    setMuted(false);
    const endedAt = Date.now();
    endedAtRef.current = endedAt;
    setTimerEndedAt(endedAt);
    setNativeLiveProgress((current) => endNativeCaseLiveProgress(current, endedAt));
    const nativePending = nativeLiveCapabilityRef.current;
    if (nativePending) {
      nativeLiveCapabilityRef.current = null;
      setNativeLiveCapability(null);
      setNativeCapability(nativePending);
      setStatus("ended");
      setError(null);
      setNotice(null);
      return;
    }
    clearCaseVoicePending();
    const latest = projectionRef.current;
    if (latest?.complete && latest.score) {
      setStatus("completed");
      reportCompletion(latest.score);
      return;
    }
    setStatus("ended");
    setError(null);
    setNotice(caseVoiceEndedNotice(endedReason));
  }, [reportCompletion, setCallIsActive]);

  const start = useCallback(async (startCaseId?: string) => {
    if (!configured || callActiveRef.current) return;
    teardown();
    clearCaseVoicePending();
    completionReportedRef.current = false;
    recoveredRef.current = false;
    endedAtRef.current = null;
    firstNotFoundAtRef.current = null;
    projectionRef.current = null;
    nativeLiveCapabilityRef.current = null;
    setProjection(null);
    setCapability(null);
    setNativeCapability(null);
    setNativeLiveCapability(null);
    setNativeTranscript([]);
    setLiveCaption(null);
    setShowTranscript(false);
    setTimerEndedAt(null);
    setTimerNow(Date.now());
    setNativeLiveProgress(initialNativeCaseLiveProgress());
    lastFinalTranscriptAtRef.current = null;
    endedReasonRef.current = null;
    setError(null);
    setNotice(null);
    setSyncError(null);
    setStatus("connecting");
    setCallIsActive(true);
    const attempt = ++startAttemptRef.current;

    try {
      const response = await fetch("/api/vapi/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: "case", ...(startCaseId ? { caseId: startCaseId } : {}) }),
      });
      if (attempt !== startAttemptRef.current) return;
      if (!response.ok) throw new Error("Could not start the voice case session.");
      const bootstrap = (await response.json()) as Partial<CaseBootstrap> | Partial<NativeCaseBootstrap>;
      if (attempt !== startAttemptRef.current) return;
      let validatedBootstrap: CaseBootstrap | NativeCaseBootstrap;
      if (bootstrap.architecture === "vapi_native") {
        if (
          typeof bootstrap.sessionId !== "string" ||
          typeof bootstrap.assistantId !== "string" ||
          typeof bootstrap.reportToken !== "string" ||
          typeof bootstrap.caseId !== "string" ||
          typeof bootstrap.caseTitle !== "string"
        ) {
          throw new Error("The native Case session did not initialise.");
        }
        const pending: PendingNativeCaseReport = {
          sessionId: bootstrap.sessionId,
          assistantId: bootstrap.assistantId,
          reportToken: bootstrap.reportToken,
          caseId: bootstrap.caseId,
          caseTitle: bootstrap.caseTitle,
          createdAt: Date.now(),
        };
        writePendingNativeCaseReport(pending);
        nativeLiveCapabilityRef.current = pending;
        setNativeLiveCapability(pending);
        validatedBootstrap = bootstrap as NativeCaseBootstrap;
      } else {
        const customBootstrap = bootstrap as Partial<CaseBootstrap>;
        if (
          typeof customBootstrap.sessionId !== "string" ||
          typeof customBootstrap.projectionToken !== "string" ||
          typeof customBootstrap.openingPrompt !== "string" ||
          typeof customBootstrap.caseId !== "string" ||
          typeof customBootstrap.caseTitle !== "string"
        ) {
          throw new Error("The voice case session did not initialise.");
        }

        const pending: PendingCaseVoiceCapability = {
          sessionId: customBootstrap.sessionId,
          projectionToken: customBootstrap.projectionToken,
          caseId: customBootstrap.caseId,
          caseTitle: customBootstrap.caseTitle,
          openingPrompt: customBootstrap.openingPrompt,
          createdAt: Date.now(),
        };
        writeCaseVoicePending(pending);
        setCapability(pending);
        validatedBootstrap = customBootstrap as CaseBootstrap;
      }

      const callContract = caseVoiceCallStartContract(validatedBootstrap, ASSISTANT_ID);

      const module = await import("@vapi-ai/web");
      if (attempt !== startAttemptRef.current) return;
      const Vapi = module.default as unknown as new (key: string) => VapiLike;
      const vapi = new Vapi(WEB_KEY!);
      vapiRef.current = vapi;
      setSdkReady(true);

      vapi.on("call-start", () => {
        if (attempt !== startAttemptRef.current) return;
        setCallIsActive(true);
        setStatus("listening");
      });
      vapi.on("speech-start", () => {
        if (attempt !== startAttemptRef.current) return;
        const now = Date.now();
        const finalizedAt = lastFinalTranscriptAtRef.current;
        console.info("[case-voice] latency", {
          event: "vapi-tts-started",
          finalizedUserToTtsMs: finalizedAt === null ? null : now - finalizedAt,
          timestamp: new Date(now).toISOString(),
        });
        lastFinalTranscriptAtRef.current = null;
        setLiveCaption(null);
        setStatus((current) => (current === "completed" ? current : "speaking"));
      });
      vapi.on("speech-end", () => {
        if (attempt !== startAttemptRef.current) return;
        setStatus((current) => (current === "completed" ? current : "listening"));
      });
      vapi.on("call-end", (payload) => {
        if (attempt !== startAttemptRef.current) return;
        handleCallEnd(payload);
      });
      vapi.on("error", (payload) => {
        if (attempt !== startAttemptRef.current) return;
        const endedReason = caseVoiceEndedReason(payload);
        console.info("[case-voice] lifecycle", {
          event: "connection-error",
          endedReason: endedReason ?? "unavailable",
          timestamp: new Date().toISOString(),
        });
        if (endedReason && /silence/i.test(endedReason)) {
          handleCallEnd(payload);
          return;
        }
        if (nativeLiveCapabilityRef.current) {
          handleCallEnd(payload);
          return;
        }
        startAttemptRef.current += 1;
        teardown();
        const failedAt = Date.now();
        endedAtRef.current = failedAt;
        setTimerEndedAt(failedAt);
        clearCaseVoicePending();
        setCapability(null);
        setNotice(null);
        setStatus("error");
        setError("The Vapi connection failed. Start a new voice interview.");
      });
      vapi.on("message", (message) => {
        if (attempt !== startAttemptRef.current) return;
        const endedReason = caseVoiceEndedReason(message);
        if (endedReason) endedReasonRef.current = endedReason;
        const transcript = message as { role?: unknown; transcriptType?: unknown } | null;
        if (transcript?.role === "user" && transcript.transcriptType === "final") {
          const finalizedAt = Date.now();
          lastFinalTranscriptAtRef.current = finalizedAt;
          console.info("[case-voice] latency", {
            event: "user-transcript-finalized",
            timestamp: new Date(finalizedAt).toISOString(),
          });
        }
        if (nativeLiveCapabilityRef.current) {
          const finalizedLine = nativeCaseVoiceTranscriptLine(message, 0);
          if (finalizedLine) {
            const pending = nativeLiveCapabilityRef.current;
            setNativeLiveProgress((current) =>
              advanceNativeCaseLiveProgress(
                current,
                pending.caseId,
                finalizedLine,
                Date.now(),
              )
            );
          }
          setNativeTranscript((current) => {
            const line = nativeCaseVoiceTranscriptLine(
              message,
              (current.at(-1)?.sequence ?? 0) + 1,
            );
            return line ? appendNativeCaseVoiceTranscript(current, line) : current;
          });
        }
        const text = caseVoiceLiveCaption(message);
        if (!text) return;
        setLiveCaption(text);
      });

      const startedCall = await startCaseVoiceSdkCall(vapi, callContract) as {
        id?: unknown;
        assistant?: { maxDurationSeconds?: unknown };
        maxDurationSeconds?: unknown;
      } | null;
      console.info("[case-voice] lifecycle", {
        event: "call-started",
        callIdPresent: typeof startedCall?.id === "string",
        maxDurationSeconds:
          typeof startedCall?.assistant?.maxDurationSeconds === "number"
            ? startedCall.assistant.maxDurationSeconds
            : typeof startedCall?.maxDurationSeconds === "number"
              ? startedCall.maxDurationSeconds
              : "unavailable",
        timestamp: new Date().toISOString(),
      });
      if (attempt !== startAttemptRef.current) {
        try {
          vapi.removeAllListeners?.();
          await vapi.stop();
        } catch {
          /* a cancelled connection may already be closed */
        }
        return;
      }
      setStatus((current) => (current === "connecting" ? "listening" : current));
    } catch (cause) {
      if (attempt !== startAttemptRef.current) return;
      const preserveNativeReport = shouldPreserveNativeCaseReportAfterStartFailure(
        nativeLiveCapabilityRef.current,
      );
      teardown();
      if (!preserveNativeReport) {
        nativeLiveCapabilityRef.current = null;
        clearPendingNativeCaseReport();
        setNativeLiveCapability(null);
      }
      clearCaseVoicePending();
      setCapability(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not start the Case voice interview.");
    }
  }, [configured, handleCallEnd, setCallIsActive, teardown]);

  const endCall = useCallback(() => {
    const latest = projectionRef.current;
    const nativePending = nativeLiveCapabilityRef.current;
    startAttemptRef.current += 1;
    teardown();
    const endedAt = Date.now();
    endedAtRef.current = endedAt;
    setTimerEndedAt(endedAt);
    setNativeLiveProgress((current) => endNativeCaseLiveProgress(current, endedAt));
    if (nativePending) {
      nativeLiveCapabilityRef.current = null;
      setNativeLiveCapability(null);
      setNativeCapability(nativePending);
      setStatus("ended");
      setError(null);
      setNotice(null);
      return;
    }
    clearCaseVoicePending();
    if (latest?.complete && latest.score) {
      setStatus("completed");
      reportCompletion(latest.score);
    } else {
      setStatus("ended");
      setError(null);
      setNotice("You ended the voice call. Your backend progress from this session is preserved.");
    }
  }, [reportCompletion, teardown]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        vapiRef.current?.setMuted?.(next);
      } catch {
        setError("The microphone state could not be changed.");
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const nativePending = readPendingNativeCaseReport();
    if (nativePending) {
      setNativeCapability(nativePending);
      setStatus("recovering");
      setRecoveryChecked(true);
      return () => {
        startAttemptRef.current += 1;
        teardown();
      };
    }
    const { pending, expired } = readCaseVoicePending();
    if (pending) {
      recoveredRef.current = true;
      endedAtRef.current = Date.now();
      setCapability(pending);
      setStatus("recovering");
    } else if (expired) {
      setStatus("expired");
      setError("The saved Case voice session expired. Start a new interview.");
    }
    setRecoveryChecked(true);
    return () => {
      startAttemptRef.current += 1;
      teardown();
    };
  }, [teardown]);

  // Load the two selectable Preview LLM cases. Distinguishes loading / loaded /
  // error so the picker never offers Start (or bootstraps) without a selection.
  const loadCatalog = useCallback(async () => {
    setCatalogStatus("loading");
    const { status, cases } = await fetchPreviewCatalog();
    setCatalog(cases);
    setCatalogStatus(status);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!capability) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const next = await fetchCaseVoiceProjection(capability);
        if (cancelled) return;
        firstNotFoundAtRef.current = null;
        setSyncError(null);
        const previous = projectionRef.current;
        if (shouldApplyCaseProjection(previous, next)) {
          projectionRef.current = next;
          setProjection(next);
          if (
            next.turnSeq > (previous?.turnSeq ?? 0) ||
            next.responseSeq > (previous?.responseSeq ?? 0) ||
            next.openingText !== previous?.openingText
          ) {
            setLiveCaption(null);
          }
        }

        if (next.complete && next.score) {
          setTimerEndedAt((current) => current ?? Date.parse(next.updatedAt));
          setStatus("completed");
          if (!callActiveRef.current) reportCompletion(next.score);
          return;
        }
        if (recoveredRef.current && statusRef.current === "recovering") {
          recoveredRef.current = false;
          const recoveredEnd = endedAtRef.current ?? Date.now();
          endedAtRef.current = recoveredEnd;
          setTimerEndedAt(recoveredEnd);
          clearCaseVoicePending();
          setStatus("ended");
          setError(null);
          setNotice(caseVoiceRecoveryMessage(next));
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof CaseProjectionUnavailableError) {
          const now = Date.now();
          if (firstNotFoundAtRef.current === null) firstNotFoundAtRef.current = now;
          if (now - firstNotFoundAtRef.current >= PROJECTION_404_GRACE_MS) {
            expireSession();
            return;
          }
          setSyncError("Confirming the Case session...");
        } else {
          setSyncError("Live synchronization was interrupted. Retrying...");
        }
      }

      const endedAt = endedAtRef.current;
      if (
        !cancelled &&
        !(endedAt !== null && Date.now() - endedAt >= ENDED_POLL_GRACE_MS)
      ) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [capability, expireSession, reportCompletion]);

  useEffect(() => {
    const nativeRunning =
      nativeLiveCapability !== null &&
      nativeLiveProgress.startedAt !== null &&
      nativeLiveProgress.endedAt === null &&
      callActive;
    const customRunning =
      nativeLiveCapability === null &&
      projection?.readinessStatus === "confirmed" &&
      projection.liveStatus !== "concluded_unscored" &&
      callActive &&
      !projection.complete &&
      timerEndedAt === null;
    const running = nativeRunning || customRunning;
    if (!running) return;
    setTimerNow(Date.now());
    const timer = setInterval(() => setTimerNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [
    callActive,
    nativeLiveCapability,
    nativeLiveProgress.endedAt,
    nativeLiveProgress.startedAt,
    projection?.complete,
    projection?.liveStatus,
    projection?.readinessStatus,
    timerEndedAt,
  ]);

  const transcript = useMemo(() => {
    const openingText = projection?.openingText ?? capability?.openingPrompt ?? "";
    return openingText ? caseVoiceTranscript(openingText, projection?.turns ?? []) : [];
  }, [capability?.openingPrompt, projection?.openingText, projection?.turns]);
  const exhibits = useMemo(
    () => uniqueCaseExhibits(projection?.exhibits ?? []),
    [projection?.exhibits],
  );
  const controls = caseVoiceControls(status, callActive, sdkReady);
  const active = status === "listening" || status === "speaking" || status === "connecting";
  const nativeTimerWaiting =
    nativeLiveCapability !== null && nativeLiveProgress.startedAt === null;
  const elapsed = nativeLiveCapability
    ? formatCaseVoiceElapsed(nativeCaseLiveElapsedMilliseconds(nativeLiveProgress, timerNow))
    : formatCaseVoiceElapsed(
        caseVoiceElapsedMilliseconds(
          projection?.readinessConfirmedAt ?? null,
          timerNow,
          timerEndedAt,
        ),
      );

  // Recovery is resolved before the presentation-only track selector appears.
  // Existing session, call, and report capabilities remain the lifecycle source
  // of truth; recoveryChecked only prevents an idle-selector flash on first load.
  const showPicker = gridTrackSelectorVisible({
    recoveryChecked,
    callActive,
    capability,
    nativeCapability,
    nativeLiveCapability,
  });
  const availability = caseVoiceStartAvailability({
    catalogStatus,
    cases: catalog,
    selectedCaseId,
    configured,
  });
  const caseLabel = projection?.caseTitle
    ?? capability?.caseTitle
    ?? nativeLiveCapability?.caseTitle
    ?? catalog.find((entry) => entry.id === selectedCaseId)?.title
    ?? "Live voice";

  const resetToPicker = () => {
    startAttemptRef.current += 1;
    teardown();
    clearCaseVoicePending();
    clearPendingNativeCaseReport();
    nativeLiveCapabilityRef.current = null;
    setCapability(null);
    setNativeCapability(null);
    setNativeLiveCapability(null);
    setNativeTranscript([]);
    setNativeLiveProgress(initialNativeCaseLiveProgress());
    setProjection(null);
    projectionRef.current = null;
    endedAtRef.current = null;
    setTimerEndedAt(null);
    setSelectedCaseId(null);
    setStatus("idle");
    setError(null);
    setNotice(null);
    setSyncError(null);
  };

  const showAllTracks = () => {
    setSelectedTrack(null);
    setSelectedTechnicalRole(null);
  };

  if (!recoveryChecked) {
    return (
      <div
        className="grid-recovery-status surface-card"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="grid-recovery-status__mark" aria-hidden="true">
          ◆
        </span>
        <div>
          <SectionLabel style={{ marginBottom: 7 }}>The GRID</SectionLabel>
          <p>Checking for an active simulation…</p>
        </div>
      </div>
    );
  }

  if (nativeCaseReportPollingReady(nativeCapability, callActive)) {
    return (
      <CaseNativeVoiceInterview
        pending={nativeCapability}
        onComplete={reportNativeCompletion}
        onReset={resetToPicker}
      />
    );
  }

  if (showPicker) {
    return (
      <div className="grid-hub" style={{ marginTop: 18 }}>
        {selectedTrack === null && (
          <section className="grid-track-selector" aria-labelledby="grid-track-heading">
            <div className="grid-track-intro">
              <SectionLabel style={{ marginBottom: 11 }}>Choose your simulation</SectionLabel>
              <h2 id="grid-track-heading">Where do you want to train?</h2>
              <p>
                Enter a live strategy case now, or preview the technical interview rounds
                being built for data roles.
              </p>
              {(notice || error) && (
                <p
                  className="grid-track-intro__notice"
                  role="status"
                  style={{ color: error ? "var(--gap)" : "var(--ink-3)" }}
                >
                  {error ?? notice}
                </p>
              )}
            </div>
            <div className="grid-track-grid">
              <button
                type="button"
                className="grid-track-card grid-track-card--case"
                onClick={() => setSelectedTrack("case")}
              >
                <span className="grid-track-card__top">
                  <span className="grid-track-card__icon" aria-hidden="true">◆</span>
                  <span className="grid-track-card__index">01</span>
                </span>
                <span className="grid-track-card__title">Case Simulation</span>
                <span className="grid-track-card__copy">
                  Work through live strategy cases with an adaptive voice interviewer and
                  a scored native report.
                </span>
                <span className="grid-track-card__meta">
                  Airport · GCC Premium Gym <span aria-hidden="true">→</span>
                </span>
              </button>
              <button
                type="button"
                className="grid-track-card grid-track-card--technical"
                onClick={() => setSelectedTrack("technical")}
              >
                <span className="grid-track-card__top">
                  <span className="grid-track-card__icon" aria-hidden="true">⌁</span>
                  <span className="grid-track-card__index">02</span>
                </span>
                <span className="grid-track-card__title">Technical Simulation</span>
                <span className="grid-track-card__copy">
                  Preview role-specific technical interview rounds for Data Analyst and
                  Data Engineer paths.
                </span>
                <span className="grid-track-card__meta">
                  Role previews · Coming soon <span aria-hidden="true">→</span>
                </span>
              </button>
            </div>
          </section>
        )}

        {selectedTrack === "case" && (
          <section className="case-voice-picker surface-card" aria-labelledby="case-simulation-heading">
            <button type="button" className="grid-all-tracks" onClick={showAllTracks}>
              <span aria-hidden="true">←</span> All tracks
            </button>
            <div className="grid-track-header">
              <div>
                <SectionLabel style={{ marginBottom: 9 }}>Case Simulation</SectionLabel>
                <h2 id="case-simulation-heading">Choose a strategy case</h2>
                <p>
                  Your existing Case readiness score reflects this track only.
                </p>
              </div>
              <span className="grid-track-status">Live voice</span>
            </div>
            {!configured && (
              <p role="alert" style={{ margin: "0 2px 12px", fontSize: 12, color: "var(--gap)" }}>
                Case voice is not configured for this Preview deployment.
              </p>
            )}

            {availability.showLoading && (
              <p role="status" aria-live="polite" style={{ margin: "0 2px", fontSize: 13, color: "var(--ink-3)" }}>
                Loading cases…
              </p>
            )}

            {availability.showError && (
              <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--gap)" }}>
                  The available cases could not be loaded.
                </span>
                <button type="button" onClick={() => void loadCatalog()} style={buttonStyle("ghost")}>
                  Retry
                </button>
              </div>
            )}

            {availability.showCases && (
              <>
                <div className="case-picker-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
                  {catalog.map((entry) => {
                    const selected = selectedCaseId === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setSelectedCaseId(entry.id)}
                        className={`case-picker-card${selected ? " is-selected" : ""}`}
                        style={{
                          textAlign: "left",
                          border: `1.5px solid ${selected ? "var(--secondary)" : "var(--line)"}`,
                          borderRadius: 12,
                          background: selected ? "var(--surface-2)" : "var(--surface)",
                          padding: "16px 18px",
                          cursor: "pointer",
                          boxShadow: "var(--shadow-sm)",
                        }}
                      >
                        <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>{entry.title}</div>
                        <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>{entry.description}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="case-picker-actions" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    disabled={!availability.canStart}
                    onClick={() => {
                      if (availability.canStart && selectedCaseId) void start(selectedCaseId);
                    }}
                    style={buttonStyle("solid", !availability.canStart)}
                  >
                    Start voice interview
                  </button>
                </div>
              </>
            )}

            {(notice || error) && (
              <p role="status" style={{ margin: "12px 2px 0", fontSize: 12, color: error ? "var(--gap)" : "var(--ink-3)" }}>
                {error ?? notice}
              </p>
            )}
          </section>
        )}

        {selectedTrack === "technical" && (
          <section className="technical-simulation surface-card" aria-labelledby="technical-simulation-heading">
            <button type="button" className="grid-all-tracks" onClick={showAllTracks}>
              <span aria-hidden="true">←</span> All tracks
            </button>
            <div className="grid-track-header">
              <div>
                <SectionLabel style={{ marginBottom: 9 }}>Technical Simulation</SectionLabel>
                <h2 id="technical-simulation-heading">Choose your role</h2>
                <p>
                  Explore the shape of upcoming technical interview rounds. These previews
                  do not contribute to Case readiness.
                </p>
              </div>
              <span className="grid-track-status">Coming soon</span>
            </div>
            <div className="technical-role-grid">
              {TECHNICAL_ROLE_PREVIEWS.map((role) => {
                const selected = selectedTechnicalRole === role.id;
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={selected}
                    className={`technical-role-card${selected ? " is-selected" : ""}`}
                    onClick={() => setSelectedTechnicalRole(role.id)}
                  >
                    <span className="technical-role-card__top">
                      <span className="technical-role-card__glyph" aria-hidden="true">
                        {role.id === "data_analyst" ? "◌" : "⌘"}
                      </span>
                      <span>Preview</span>
                    </span>
                    <span className="technical-role-card__title">{role.title}</span>
                    <span className="technical-role-card__copy">{role.description}</span>
                    <span className="technical-role-card__focus">{role.focus}</span>
                  </button>
                );
              })}
            </div>
            {selectedTechnicalRole && (
              <div className="technical-role-preview" role="status" aria-live="polite">
                <div>
                  <SectionLabel style={{ marginBottom: 7 }}>Selected role</SectionLabel>
                  <h3>
                    {TECHNICAL_ROLE_PREVIEWS.find((role) => role.id === selectedTechnicalRole)?.title}
                  </h3>
                </div>
                <p>
                  Technical interview rounds for this role will appear here when they are ready.
                  No readiness score or application data is changed by this preview.
                </p>
                <span>Coming soon</span>
              </div>
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="case-voice-session" style={{ marginTop: 18 }}>
      <div
        className="case-voice-statusbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: "14px 16px",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: active ? "var(--success)" : status === "error" || status === "expired" ? "var(--gap)" : "var(--ink-4)",
            animation: active ? "pulseDot 1.2s ease-in-out infinite" : "none",
          }}
        />
        <div style={{ minWidth: 0 }} role="status" aria-live="polite">
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--secondary)", fontWeight: 600 }}>
            {caseLabel.toUpperCase()} · LIVE VOICE
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {projection?.liveStatus === "concluded_unscored"
              ? "Interview concluded · unscored"
              : statusLabel(status)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div
            aria-label="Case interview timer"
            className="case-voice-timer"
            style={{
              minWidth: nativeTimerWaiting ? 118 : 62,
              padding: "7px 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "var(--ink-4)", fontWeight: 600 }}>CASE TIME</div>
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: nativeTimerWaiting ? 10 : 14,
              color: "var(--ink)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}>
              {nativeTimerWaiting ? "Waiting to begin" : elapsed}
            </div>
          </div>
          {controls.start && (
            <button
              type="button"
              onClick={resetToPicker}
              style={buttonStyle("solid")}
            >
              Start new interview
            </button>
          )}
          {controls.mute && (
            <button type="button" onClick={toggleMute} style={buttonStyle("ghost")} aria-pressed={muted}>
              {muted ? "Unmute" : "Mute"}
            </button>
          )}
          {controls.end && (
            <button type="button" onClick={endCall} style={buttonStyle("danger")}>
              End interview
            </button>
          )}
        </div>
      </div>

      {!configured && (
        <p role="alert" style={{ margin: "9px 2px 0", fontSize: 12, color: "var(--gap)" }}>
          Case voice is not configured for this Preview deployment.
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: "9px 2px 0", fontSize: 12, color: "var(--gap)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" style={{ margin: "9px 2px 0", fontSize: 12, color: "var(--ink-3)" }}>
          {notice}
        </p>
      )}
      {syncError && (
        <p role="status" style={{ margin: "9px 2px 0", fontSize: 12, color: "var(--partial)" }}>
          {syncError}
        </p>
      )}

      {nativeLiveCapability && (
        <>
          <div
            className="case-progress-panel"
            style={{
              marginTop: 14,
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "var(--surface)",
              overflowX: "auto",
            }}
            aria-label="Live case stage progress"
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}>
              <SectionLabel>Case progress</SectionLabel>
              <span style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}>
                {Math.max(0, nativeLiveProgress.stageIndex + 1)} of {NATIVE_CASE_LIVE_STAGE_LABELS.length}
              </span>
            </div>
            <StageTracker
              stages={[...NATIVE_CASE_LIVE_STAGE_LABELS]}
              currentIdx={nativeLiveProgress.stageIndex}
            />
          </div>

          {liveCaption && (
            <div
              style={{ marginTop: 14, maxWidth: 720, opacity: 0.78 }}
              aria-label="Temporary live caption"
              aria-live="polite"
            >
              <ChatBubble role="candidate" text={liveCaption} label="Live caption" />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((current) => !current)}
              style={buttonStyle("ghost")}
            >
              {showTranscript ? "Hide transcript" : "Show transcript"} ({nativeTranscript.length})
            </button>
          </div>

          {showTranscript && (
            <div
              className="case-transcript-panel"
              style={{
                marginTop: 16,
                border: "1px solid var(--line)",
                borderRadius: 8,
                background: "var(--surface)",
                minWidth: 0,
              }}
            >
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <SectionLabel>Transcript</SectionLabel>
              </div>
              <div
                style={{
                  height: 480,
                  overflowY: "auto",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
                aria-live="polite"
              >
                {nativeTranscript.map((line) => (
                  <ChatBubble
                    key={line.sequence}
                    role={line.role === "assistant" ? "interviewer" : "candidate"}
                    text={line.text}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {projection && (
        <>
          <div style={{ marginTop: 14, padding: "14px 16px", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
            <StageTracker
              stages={CASE_STATES.map((stage) => STAGE_LABEL[stage])}
              currentIdx={projection.stageIndex}
              complete={projection.complete}
            />
          </div>

          {liveCaption && (
            <div
              style={{ marginTop: 14, maxWidth: 720, opacity: 0.78 }}
              aria-label="Temporary live caption"
              aria-live="polite"
            >
              <ChatBubble role="candidate" text={liveCaption} label="Live caption" />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              aria-expanded={showTranscript}
              onClick={() => setShowTranscript((current) => !current)}
              style={buttonStyle("ghost")}
            >
              {showTranscript ? "Hide transcript" : "Show transcript"} ({transcript.length})
            </button>
          </div>

          <div className={showTranscript ? "case-grid" : undefined} style={{ marginTop: 16 }}>
            {showTranscript && (
              <div className="case-transcript-panel" style={{ border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", minWidth: 0 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)" }}>
                <SectionLabel>Transcript</SectionLabel>
              </div>
              <div
                style={{
                  height: 480,
                  overflowY: "auto",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
                aria-live="polite"
              >
                {transcript.map((line) => (
                  <ChatBubble
                    key={`${line.turnSeq}-${line.role}`}
                    role={line.role === "assistant" ? "interviewer" : "candidate"}
                    text={line.text}
                    label={line.action ? ACTION_LABEL[line.action] : undefined}
                  />
                ))}
              </div>
              </div>
            )}

            <div className="case-exhibits-panel" style={{ minWidth: 0 }}>
              <SectionLabel style={{ marginBottom: 10 }}>Exhibits</SectionLabel>
              {exhibits.length === 0 ? (
                <div style={{ border: "1.5px dashed var(--line)", borderRadius: 12, padding: "24px 16px", textAlign: "center", background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    Exhibits will appear here when the backend interviewer reveals them.
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {exhibits.map((exhibit, index) => (
                    <ExhibitCard key={exhibit.id} exhibit={exhibit} index={index} />
                  ))}
                </div>
              )}

              {projection.complete && projection.score && (
                <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                  <SectionLabel style={{ marginBottom: 6 }}>Final Case score</SectionLabel>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 30, fontWeight: 600, color: "var(--success)" }}>
                      {to100(projection.score.overall)}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>of 100</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buttonStyle(kind: "solid" | "ghost" | "danger", disabled = false): React.CSSProperties {
  const solid = kind === "solid";
  const danger = kind === "danger";
  return {
    border: solid ? "none" : `1px solid ${danger ? "var(--gap)" : "var(--line)"}`,
    background: solid ? "var(--secondary)" : danger ? "var(--gap-tint)" : "var(--surface-2)",
    color: solid ? "#fff" : danger ? "var(--gap)" : "var(--ink-2)",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 14px",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
