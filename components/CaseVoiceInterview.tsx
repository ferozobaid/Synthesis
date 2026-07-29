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
} from "@/lib/voice/case-native-live";
import { isTechnicalNativeCase, nativeProgressDefinition } from "@/lib/voice/native-progress";
import {
  CaseClockAuthError,
  caseClockRemainingMs,
  caseClockSkewOffsetMs,
  createCaseClockController,
  isAuthoritativeClock,
  type CaseClockController,
  type CaseClockSnapshot,
} from "@/lib/voice/case-clock-sync";
import {
  advanceNativeCurrentQuestion,
  initialNativeCurrentQuestion,
  type NativeCurrentQuestionState,
} from "@/lib/voice/native-current-question";
import { nativeCaseBrief } from "@/lib/voice/native-case-brief";
import CaseNativeVoiceInterview, {
  clearPendingNativeCaseReport,
  readPendingNativeCaseReport,
  parseCompletedAt,
  writePendingNativeCaseReport,
  type CompletedCaseReport,
  type PendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";
import { useReadiness, type CaseOutcome } from "@/components/readiness-store";
import { InterviewerAvatar } from "@/components/interviewer/InterviewerAvatar";
import {
  createUserSpeakingTracker,
  mapCaseVoiceToAvatarMode,
  quantizeLevel,
  shouldPublishLevel,
} from "@/components/interviewer/avatarState";

const WEB_KEY = process.env.NEXT_PUBLIC_VAPI_WEB_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_CASE_ASSISTANT_ID;

const POLL_INTERVAL_MS = 1_000;
const LEVEL_PUBLISH_MS = 120;
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
  caseTrack?: PreviewCaseTrack | null;
  caseRole?: PreviewCaseTechnicalRole | null;
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
  /** Stable identity for a completed custom-LLM attempt; null until complete. */
  outcomeId?: string | null;
  /** Server ISO instant of completion; null until the case is complete. */
  completedAt?: string | null;
  exhibits: CaseExhibit[];
  turns: CaseVoiceProjectedTurn[];
  /** Server-owned clock (absent on legacy sessions, which simply have no deadline). */
  maxDurationSeconds?: number | null;
  caseStartedAt?: string | null;
  caseExpiresAt?: string | null;
  serverNow?: string;
  timedOut?: boolean;
  updatedAt: string;
}

export interface PendingCaseVoiceCapability {
  sessionId: string;
  projectionToken: string;
  caseId: string;
  caseTrack?: PreviewCaseTrack;
  caseRole?: PreviewCaseTechnicalRole;
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
  caseTrack?: PreviewCaseTrack;
  caseRole?: PreviewCaseTechnicalRole | null;
  caseTitle: string;
  caseDescription?: string | null;
  maxDurationSeconds: number;
}

export interface NativeCaseBootstrap {
  architecture: "vapi_native";
  sessionId: string;
  assistantId: string;
  reportToken: string;
  reportStatus: "pending";
  caseId: string;
  caseTrack?: PreviewCaseTrack;
  caseRole?: PreviewCaseTechnicalRole | null;
  caseTitle: string;
  maxDurationSeconds: number;
}

export interface NativeCaseVoiceTranscriptLine {
  role: "assistant" | "user";
  text: string;
  sequence: number;
}

export type PreviewCaseTrack = "strategy" | "technical";
export type PreviewCaseTechnicalRole = "data_engineering" | "data_analyst";

export interface PreviewCaseChoice {
  id: string;
  title: string;
  description: string;
  track: PreviewCaseTrack;
  /** Present only for track: "technical" entries. */
  role?: PreviewCaseTechnicalRole;
  /** Authored difficulty and its derived maximum duration (absent on legacy responses). */
  difficultyStars?: number;
  maxDurationSeconds?: number;
}

/** "★★★☆☆" for a 3-of-5 rating; empty when the catalog omitted a difficulty. */
export function caseDifficultyLabel(stars: number | undefined): string {
  if (typeof stars !== "number" || !Number.isFinite(stars)) return "";
  const filled = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/** "15 min" for a duration in seconds; empty when the catalog omitted one. */
export function caseDurationLabel(seconds: number | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  return `${Math.round(seconds / 60)} min`;
}

type GridTrack = "case" | "technical";
type TechnicalRoleId = PreviewCaseTechnicalRole;

/** Presentational metadata for every technical role card, active or upcoming. */
const TECHNICAL_ROLE_META: Array<{
  id: TechnicalRoleId;
  title: string;
  description: string;
  focus: string;
}> = [
  {
    id: "data_engineering",
    title: "Data Engineering",
    description:
      "Prepare for data modeling, pipeline design, reliability, and production trade-offs.",
    focus: "Pipelines · modeling · reliability",
  },
  {
    id: "data_analyst",
    title: "Data Analyst",
    description:
      "Practice the judgment behind SQL, metrics, experimentation, and analytical storytelling.",
    focus: "SQL · metrics · experimentation",
  },
];

/** Catalog-driven classification helpers. No case id is ever hardcoded here. */
export function strategyCatalogCases(catalog: PreviewCaseChoice[]): PreviewCaseChoice[] {
  return catalog.filter((entry) => entry.track === "strategy");
}

export function technicalCatalogCasesByRole(
  catalog: PreviewCaseChoice[],
): Partial<Record<PreviewCaseTechnicalRole, PreviewCaseChoice[]>> {
  const out: Partial<Record<PreviewCaseTechnicalRole, PreviewCaseChoice[]>> = {};
  for (const entry of catalog) {
    if (entry.track !== "technical" || !entry.role) continue;
    (out[entry.role] ??= []).push(entry);
  }
  return out;
}

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

/**
 * Outer Vapi call-duration safety net, in seconds, added ONLY to the value sent
 * to `vapi.start()` — never to the server-authoritative deadline, clock API,
 * countdown, card label, warnings, or session snapshot.
 *
 * Vapi's `maxDurationSeconds` is enforced from call CONNECT, while the
 * Synthesis case clock starts later — at readiness confirmation (custom-LLM)
 * or at anchor-detected case opening (native). Without this buffer, Vapi can
 * hard-end the call before the candidate's countdown reaches zero, cutting a
 * 15/20-minute case short. The buffer covers connect time, the readiness
 * exchange, and (for native) the time to speak the case opening plus the
 * clock-start round trip.
 */
export const VAPI_CASE_DURATION_SAFETY_BUFFER_SECONDS = 180;

/** The value to send Vapi for `maxDurationSeconds`: the case duration plus the safety buffer. */
export function vapiMaxDurationSeconds(caseMaxDurationSeconds: number): number {
  return caseMaxDurationSeconds + VAPI_CASE_DURATION_SAFETY_BUFFER_SECONDS;
}

export function caseVoiceStartOverrides(bootstrap: CaseBootstrap) {
  return {
    maxDurationSeconds: vapiMaxDurationSeconds(bootstrap.maxDurationSeconds),
    variableValues: {
      sessionId: bootstrap.sessionId,
      openingPrompt: bootstrap.openingPrompt,
      caseTitle: bootstrap.caseTitle,
    },
    metadata: { sessionId: bootstrap.sessionId, caseId: bootstrap.caseId },
  };
}

export function nativeCaseVoiceStartOverrides(
  bootstrap: Pick<NativeCaseBootstrap, "sessionId" | "caseId" | "maxDurationSeconds">,
) {
  return {
    maxDurationSeconds: vapiMaxDurationSeconds(bootstrap.maxDurationSeconds),
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

const VALID_TRACKS: readonly PreviewCaseTrack[] = ["strategy", "technical"];
const VALID_TECHNICAL_ROLES: readonly PreviewCaseTechnicalRole[] = ["data_engineering", "data_analyst"];

/** Load the selectable Preview LLM cases. Any failure (or empty list) is an error state. */
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
            typeof (entry as PreviewCaseChoice).description === "string" &&
            VALID_TRACKS.includes((entry as PreviewCaseChoice).track) &&
            ((entry as PreviewCaseChoice).role === undefined ||
              VALID_TECHNICAL_ROLES.includes((entry as PreviewCaseChoice).role as PreviewCaseTechnicalRole)),
        ).map((entry) => ({
          ...entry,
          // Difficulty/duration are presentational here; the SERVER snapshots the
          // authoritative duration at session creation, never the browser.
          difficultyStars:
            typeof entry.difficultyStars === "number" ? entry.difficultyStars : undefined,
          maxDurationSeconds:
            typeof entry.maxDurationSeconds === "number" ? entry.maxDurationSeconds : undefined,
        }))
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

/**
 * The clock snapshot carried by a custom-LLM projection, or null when the case has
 * not started (or the session predates server-owned timing). Custom-LLM polls this
 * endpoint continuously, so the skew offset stays current without extra requests.
 */
export function caseVoiceProjectionClock(
  projection: CaseVoiceProjection | null,
): CaseClockSnapshot | null {
  if (!projection?.serverNow) return null;
  return {
    maxDurationSeconds: projection.maxDurationSeconds ?? null,
    caseStartedAt: projection.caseStartedAt ?? null,
    caseExpiresAt: projection.caseExpiresAt ?? null,
    serverNow: projection.serverNow,
    timedOut: projection.timedOut ?? false,
  };
}

/** Map a clock response to a snapshot, converting a rejected capability. */
async function readCaseClockResponse(response: Response): Promise<CaseClockSnapshot> {
  // 401/403/404 mean the capability or session is not usable — retrying cannot fix
  // it, so surface a distinct error the controller stops on.
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    throw new CaseClockAuthError();
  }
  if (!response.ok) throw new Error("case clock unavailable");
  return (await response.json()) as CaseClockSnapshot;
}

/** GET the native case clock. */
export async function fetchCaseClock(
  pending: Pick<PendingNativeCaseReport, "sessionId" | "reportToken">,
  fetcher: typeof fetch = fetch,
): Promise<CaseClockSnapshot> {
  return readCaseClockResponse(
    await fetcher(`/api/case/session/${encodeURIComponent(pending.sessionId)}/clock`, {
      headers: { "x-report-token": pending.reportToken },
    }),
  );
}

/** POST to start the native case clock. Safe to repeat: the server is first-write-wins. */
export async function startCaseClock(
  pending: Pick<PendingNativeCaseReport, "sessionId" | "reportToken">,
  fetcher: typeof fetch = fetch,
): Promise<CaseClockSnapshot> {
  return readCaseClockResponse(
    await fetcher(`/api/case/session/${encodeURIComponent(pending.sessionId)}/clock`, {
      method: "POST",
      headers: { "x-report-token": pending.reportToken },
    }),
  );
}

/** Remaining-time thresholds (ms) that raise a countdown warning, each once. */
export const CASE_TIMER_WARNING_THRESHOLDS_MS: readonly number[] = [
  5 * 60_000,
  2 * 60_000,
  1 * 60_000,
] as const;

/**
 * The tightest warning band the remaining time has entered — the smallest
 * threshold that is still >= remainingMs. Null when outside every band.
 * e.g. 90s remaining → the 2-minute band; 30s remaining → the 1-minute band.
 */
export function caseTimerWarningThreshold(remainingMs: number | null): number | null {
  if (remainingMs === null) return null;
  const entered = CASE_TIMER_WARNING_THRESHOLDS_MS.filter(
    (threshold) => remainingMs <= threshold,
  );
  return entered.length > 0 ? Math.min(...entered) : null;
}

/** Thresholds newly crossed between two remaining-time readings. */
export function crossedCaseTimerWarnings(
  previousRemainingMs: number | null,
  remainingMs: number | null,
): number[] {
  if (remainingMs === null) return [];
  return CASE_TIMER_WARNING_THRESHOLDS_MS.filter(
    (threshold) =>
      remainingMs <= threshold &&
      (previousRemainingMs === null || previousRemainingMs > threshold),
  );
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
    outcomeId: typeof projection.outcomeId === "string" ? projection.outcomeId : null,
    completedAt:
      typeof projection.completedAt === "string" ? projection.completedAt : null,
    exhibits: uniqueCaseExhibits(projection.exhibits as CaseExhibit[]),
    turns: projection.turns as CaseVoiceProjectedTurn[],
    // Server-owned clock. Anything malformed normalizes to "no deadline" rather
    // than a bogus one — the countdown is only ever drawn from a valid server pair.
    maxDurationSeconds:
      typeof projection.maxDurationSeconds === "number" ? projection.maxDurationSeconds : null,
    caseStartedAt:
      typeof projection.caseStartedAt === "string" ? projection.caseStartedAt : null,
    caseExpiresAt:
      typeof projection.caseExpiresAt === "string" ? projection.caseExpiresAt : null,
    serverNow: typeof projection.serverNow === "string" ? projection.serverNow : undefined,
    timedOut: projection.timedOut === true,
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

/**
 * Minimum functional presentation of a case's stored result. Strategy and
 * Technical read the same per-case contract, so a technical round shows its score
 * even though it never moves Case readiness. Visual pass is a Codex task.
 */
export function caseOutcomeSummary(outcome: CaseOutcome | undefined): string | null {
  if (!outcome || outcome.latestScore === null) return null;
  const parts = [`Latest ${outcome.latestScore}/100${outcome.latestWasPartial ? " (provisional)" : ""}`];
  if (outcome.bestScore !== null && outcome.bestScore !== outcome.latestScore) {
    parts.push(`Best ${outcome.bestScore}/100${outcome.bestWasPartial ? " (provisional)" : ""}`);
  }
  parts.push(`${outcome.attemptCount} attempt${outcome.attemptCount === 1 ? "" : "s"}`);
  if (outcome.lastCompletedAt != null && outcome.lastCompletedAt > 0) {
    parts.push(new Date(outcome.lastCompletedAt).toLocaleDateString());
  }
  return parts.join(" · ");
}

/** Shared card grid for any track/role's case list — Strategy and Technical alike. */
function CaseCardGrid({
  cases,
  selectedCaseId,
  onSelect,
  outcomes,
}: {
  cases: PreviewCaseChoice[];
  selectedCaseId: string | null;
  onSelect: (id: string) => void;
  outcomes: Record<string, CaseOutcome>;
}) {
  return (
    <div className="case-picker-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
      {cases.map((entry) => {
        const selected = selectedCaseId === entry.id;
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(entry.id)}
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
            {caseDifficultyLabel(entry.difficultyStars) && (
              <div className="case-picker-card__meta" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  aria-label={`Difficulty ${entry.difficultyStars} of 5`}
                  style={{ fontSize: 12, color: "var(--secondary)", letterSpacing: ".06em" }}
                >
                  {caseDifficultyLabel(entry.difficultyStars)}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--ink-4)" }}>
                  {caseDurationLabel(entry.maxDurationSeconds)}
                </span>
              </div>
            )}
            {caseOutcomeSummary(outcomes[entry.id]) && (
              <div
                className="case-picker-card__outcome"
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  color: outcomes[entry.id]?.latestWasPartial ? "var(--partial)" : "var(--ink-3)",
                }}
              >
                {caseOutcomeSummary(outcomes[entry.id])}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Shared "Start voice interview" action for any track/role's case list. */
function StartVoiceInterviewButton({ canStart, onStart }: { canStart: boolean; onStart: () => void }) {
  return (
    <div className="case-picker-actions" style={{ marginTop: 16 }}>
      <button
        type="button"
        disabled={!canStart}
        onClick={onStart}
        style={buttonStyle("solid", !canStart)}
      >
        Start voice interview
      </button>
    </div>
  );
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
  onComplete?: (
    outcome: CompletedCaseReport,
    context?: { preserveNativeReport?: boolean },
  ) => void;
}) {
  // Native sessions receive their closed-mapped assistant id from bootstrap;
  // only the public Web SDK key is needed before the architecture is known.
  const configured = Boolean(WEB_KEY);
  // Per-case results so each card can show its own latest/best/attempts.
  const { state: readinessState } = useReadiness();
  const caseOutcomes = readinessState.caseOutcomes;
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
  // The ONE deadline, always server-issued. Null means no countdown is shown —
  // a client-side fallback deadline is never invented.
  const [clock, setClock] = useState<{
    snapshot: CaseClockSnapshot;
    offsetMs: number;
  } | null>(null);
  const [timerWarning, setTimerWarning] = useState<number | null>(null);
  const [nativeLiveProgress, setNativeLiveProgress] = useState(
    initialNativeCaseLiveProgress,
  );
  const [currentQuestion, setCurrentQuestion] = useState<NativeCurrentQuestionState | null>(null);
  // Optional avatar audio-level enhancement; absent Vapi level events leave
  // these at their defaults, which renders as plain "listening".
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [level, setLevel] = useState(0);

  const vapiRef = useRef<VapiLike | null>(null);
  const assistantLevelRef = useRef(0);
  const localLevelRef = useRef(0);
  const speakingTrackerRef = useRef(createUserSpeakingTracker());
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
  // One controller at a time; the ref is what makes duplicate effect runs harmless.
  const clockControllerRef = useRef<CaseClockController | null>(null);
  const warnedThresholdsRef = useRef<Set<number>>(new Set());
  const lastRemainingRef = useRef<number | null>(null);
  const autoEndedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const nativeLiveProgressRef = useRef(nativeLiveProgress);
  nativeLiveProgressRef.current = nativeLiveProgress;
  onCompleteRef.current = onComplete;
  statusRef.current = status;

  const setCallIsActive = useCallback((active: boolean) => {
    callActiveRef.current = active;
    setCallActive(active);
  }, []);

  const teardown = useCallback(() => {
    const vapi = vapiRef.current;
    vapiRef.current = null;
    assistantLevelRef.current = 0;
    localLevelRef.current = 0;
    speakingTrackerRef.current.reset();
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

  /**
   * Custom-LLM completion. The FSM only reaches `complete` after running the whole
   * case, so these are never partial. Without a server outcome id there is no
   * stable identity to deduplicate against, so nothing is recorded.
   */
  const reportCompletion = useCallback((projection: CaseVoiceProjection) => {
    if (completionReportedRef.current) return;
    if (!projection.score || !projection.outcomeId) return;
    completionReportedRef.current = true;
    clearCaseVoicePending();
    clearPendingNativeCaseReport();
    onCompleteRef.current?.({
      score: projection.score,
      partial: false,
      outcomeId: projection.outcomeId,
      // Parsed once here, at the projection-to-outcome boundary.
      completedAt: parseCompletedAt(projection.completedAt),
      caseId: projection.caseId,
      caseTrack: projection.caseTrack === "technical" ? "technical" : "strategy",
    });
  }, []);

  /** Native completion; the outcome (including its track) comes from the report. */
  const reportNativeCompletion = useCallback((outcome: CompletedCaseReport) => {
    if (completionReportedRef.current) return;
    completionReportedRef.current = true;
    clearCaseVoicePending();
    clearPendingNativeCaseReport();
    onCompleteRef.current?.(outcome, { preserveNativeReport: true });
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
      reportCompletion(latest);
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
    setCurrentQuestion(null);
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
          typeof bootstrap.caseTitle !== "string" ||
          typeof bootstrap.maxDurationSeconds !== "number"
        ) {
          throw new Error("The native Case session did not initialise.");
        }
        const pending: PendingNativeCaseReport = {
          sessionId: bootstrap.sessionId,
          assistantId: bootstrap.assistantId,
          reportToken: bootstrap.reportToken,
          caseId: bootstrap.caseId,
          caseTrack: bootstrap.caseTrack,
          caseRole: bootstrap.caseRole ?? undefined,
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
          typeof customBootstrap.caseTitle !== "string" ||
          typeof customBootstrap.maxDurationSeconds !== "number"
        ) {
          throw new Error("The voice case session did not initialise.");
        }

        const pending: PendingCaseVoiceCapability = {
          sessionId: customBootstrap.sessionId,
          projectionToken: customBootstrap.projectionToken,
          caseId: customBootstrap.caseId,
          caseTrack: customBootstrap.caseTrack,
          caseRole: customBootstrap.caseRole ?? undefined,
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
      // Optional avatar enhancement: assistant output + local mic levels.
      // Registration failures must never block call setup.
      try {
        vapi.on("volume-level", (payload) => {
          if (attempt !== startAttemptRef.current) return;
          assistantLevelRef.current = typeof payload === "number" ? payload : 0;
        });
        vapi.on("local-volume-level", (payload) => {
          if (attempt !== startAttemptRef.current) return;
          localLevelRef.current = typeof payload === "number" ? payload : 0;
        });
      } catch {
        /* level visualization is optional */
      }
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
            setCurrentQuestion((current) =>
              advanceNativeCurrentQuestion(
                current ?? initialNativeCurrentQuestion(pending.caseId),
                pending.caseId,
                finalizedLine,
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
      reportCompletion(latest);
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

  // Throttled avatar level publisher: samples the refs the Vapi level
  // listeners write into and only re-renders when the speaking flag or
  // quantized level actually moves. Runs only while a call is live.
  useEffect(() => {
    if (!callActive) {
      setUserSpeaking(false);
      setLevel(0);
      return;
    }
    const timer = window.setInterval(() => {
      const speaking = speakingTrackerRef.current.sample(localLevelRef.current, Date.now());
      setUserSpeaking((prev) => (prev === speaking ? prev : speaking));
      const raw =
        statusRef.current === "speaking" ? assistantLevelRef.current : localLevelRef.current;
      const next = quantizeLevel(raw);
      setLevel((prev) => (shouldPublishLevel(prev, next) ? next : prev));
    }, LEVEL_PUBLISH_MS);
    return () => window.clearInterval(timer);
  }, [callActive]);

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
          if (!callActiveRef.current) reportCompletion(next);
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

  // Custom-LLM: the clock rides along on the projection this path already polls at
  // 1 Hz, so the skew offset is continuously refreshed with no extra requests.
  useEffect(() => {
    const snapshot = caseVoiceProjectionClock(projection);
    if (!isAuthoritativeClock(snapshot)) return;
    const offsetMs = caseClockSkewOffsetMs(snapshot, Date.now());
    setClock({ snapshot, offsetMs });
  }, [projection]);

  // Native: ask the server to start the clock once the case genuinely begins, with
  // bounded retries. GET-before-POST means a remount restores an existing deadline
  // instead of restarting it, and can also recover a start that previously failed.
  useEffect(() => {
    const pending = nativeLiveCapability;
    if (!pending) {
      clockControllerRef.current?.dispose();
      clockControllerRef.current = null;
      return;
    }
    if (!clockControllerRef.current) {
      clockControllerRef.current = createCaseClockController({
        fetchClock: () => fetchCaseClock(pending),
        startClock: () => startCaseClock(pending),
        // Only the anchor-detected case opening authorizes a start request.
        hasCaseStarted: () => nativeLiveProgressRef.current.startedAt !== null,
        isActive: () => callActiveRef.current,
        onSnapshot: (snapshot, receivedAtMs) => {
          setClock({ snapshot, offsetMs: caseClockSkewOffsetMs(snapshot, receivedAtMs) });
        },
      });
    }
    // Idempotent: repeated renders and repeated anchor detections cannot start a
    // second retry loop.
    clockControllerRef.current.ensure();
  }, [nativeLiveCapability, nativeLiveProgress.startedAt]);

  useEffect(() => () => {
    clockControllerRef.current?.dispose();
    clockControllerRef.current = null;
  }, []);

  // Tick whenever a live deadline exists — not merely while a call is attached, or
  // the countdown would freeze.
  useEffect(() => {
    if (!clock || timerEndedAt !== null) return;
    setTimerNow(Date.now());
    const timer = setInterval(() => setTimerNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [clock, timerEndedAt]);

  // Warnings at 5m / 2m / 1m, each raised once, and a single graceful auto-end at
  // zero. The server is independently authoritative on expiry, so a missed tick
  // costs nothing.
  useEffect(() => {
    if (!clock || timerEndedAt !== null) return;
    const remaining = caseClockRemainingMs(clock.snapshot, timerNow, clock.offsetMs);
    if (remaining === null) return;

    for (const threshold of crossedCaseTimerWarnings(lastRemainingRef.current, remaining)) {
      if (warnedThresholdsRef.current.has(threshold)) continue;
      warnedThresholdsRef.current.add(threshold);
      setTimerWarning(threshold);
    }
    lastRemainingRef.current = remaining;

    if (remaining > 0 || autoEndedRef.current) return;
    autoEndedRef.current = true;
    // Route through the existing graceful path so the normal report and scoring
    // pipeline runs exactly as it does for any other end of call.
    if (callActiveRef.current) endCall();
  }, [clock, endCall, timerEndedAt, timerNow]);

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
  // Countdown from the server deadline only. With no deadline (case not started
  // yet, clock unreachable, or a legacy session) the timer shows a neutral state
  // rather than a second, client-authoritative notion of case time.
  const remainingMs = caseClockRemainingMs(
    clock?.snapshot ?? null,
    timerEndedAt ?? timerNow,
    clock?.offsetMs ?? 0,
  );
  const timerLabel =
    remainingMs === null
      ? nativeLiveCapability !== null && nativeLiveProgress.startedAt === null
        ? "Waiting to begin"
        : "Timing unavailable"
      : formatCaseVoiceElapsed(remainingMs);
  const timerPending = remainingMs === null;

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
    setCurrentQuestion(null);
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
    setSelectedCaseId(null);
  };

  const chooseTrack = (track: GridTrack) => {
    setSelectedTrack(track);
    setSelectedTechnicalRole(null);
    setSelectedCaseId(null);
  };

  const chooseTechnicalRole = (role: TechnicalRoleId) => {
    setSelectedTechnicalRole(role);
    setSelectedCaseId(null);
  };

  const backToTechnicalRoles = () => {
    setSelectedTechnicalRole(null);
    setSelectedCaseId(null);
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
    const strategyCases = strategyCatalogCases(catalog);
    const technicalByRole = technicalCatalogCasesByRole(catalog);
    const activeRoleCases = selectedTechnicalRole ? technicalByRole[selectedTechnicalRole] ?? [] : [];
    const selectedRoleMeta = TECHNICAL_ROLE_META.find((role) => role.id === selectedTechnicalRole);
    const anyTechnicalRoleActive = TECHNICAL_ROLE_META.some(
      (role) => (technicalByRole[role.id] ?? []).length > 0,
    );

    return (
      <div className="grid-hub" style={{ marginTop: 18 }}>
        {selectedTrack === null && (
          <section className="grid-track-selector" aria-labelledby="grid-track-heading">
            <div className="grid-track-intro">
              <SectionLabel style={{ marginBottom: 11 }}>Choose your simulation</SectionLabel>
              <h2 id="grid-track-heading">Where do you want to train?</h2>
              <p>
                Enter a live strategy case, or start a technical interview for a specific
                data role.
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
                onClick={() => chooseTrack("case")}
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
                onClick={() => chooseTrack("technical")}
              >
                <span className="grid-track-card__top">
                  <span className="grid-track-card__icon" aria-hidden="true">⌁</span>
                  <span className="grid-track-card__index">02</span>
                </span>
                <span className="grid-track-card__title">Technical Interviews</span>
                <span className="grid-track-card__copy">
                  Live voice interviews by data role.
                </span>
                <span className="grid-track-card__meta">
                  Data Engineering · Data Analyst <span aria-hidden="true">→</span>
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
                  Your score counts toward Interview Readiness, alongside technical rounds.
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
                <CaseCardGrid cases={strategyCases} selectedCaseId={selectedCaseId} onSelect={setSelectedCaseId} outcomes={caseOutcomes} />
                <StartVoiceInterviewButton
                  canStart={availability.canStart}
                  onStart={() => {
                    if (availability.canStart && selectedCaseId) void start(selectedCaseId);
                  }}
                />
              </>
            )}

            {(notice || error) && (
              <p role="status" style={{ margin: "12px 2px 0", fontSize: 12, color: error ? "var(--gap)" : "var(--ink-3)" }}>
                {error ?? notice}
              </p>
            )}
          </section>
        )}

        {selectedTrack === "technical" && selectedTechnicalRole === null && (
          <section className="technical-simulation surface-card" aria-labelledby="technical-simulation-heading">
            <button type="button" className="grid-all-tracks" onClick={showAllTracks}>
              <span aria-hidden="true">←</span> All tracks
            </button>
            <div className="grid-track-header">
              <div>
                <SectionLabel style={{ marginBottom: 9 }}>Technical Interviews</SectionLabel>
                <h2 id="technical-simulation-heading">Choose your role</h2>
                <p>
                  Data Engineering and Data Analyst are live.
                </p>
              </div>
              <span className="grid-track-status">{anyTechnicalRoleActive ? "Live voice" : "Coming soon"}</span>
            </div>
            <div className="technical-role-grid">
              {TECHNICAL_ROLE_META.map((role) => {
                const roleCases = technicalByRole[role.id] ?? [];
                const active = roleCases.length > 0;
                return (
                  <button
                    key={role.id}
                    type="button"
                    aria-pressed={false}
                    className="technical-role-card"
                    onClick={() => chooseTechnicalRole(role.id)}
                  >
                    <span className="technical-role-card__top">
                      <span className="technical-role-card__glyph" aria-hidden="true">
                        {role.id === "data_analyst" ? "◌" : "⌘"}
                      </span>
                      <span>{active ? "Live voice" : "Coming soon"}</span>
                    </span>
                    <span className="technical-role-card__title">{role.title}</span>
                    <span className="technical-role-card__copy">{role.description}</span>
                    <span className="technical-role-card__focus">{role.focus}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {selectedTrack === "technical" && selectedTechnicalRole !== null && activeRoleCases.length > 0 && (
          <section className="case-voice-picker surface-card" aria-labelledby="technical-role-cases-heading">
            <button type="button" className="grid-all-tracks" onClick={backToTechnicalRoles}>
              <span aria-hidden="true">←</span> Roles
            </button>
            <div className="grid-track-header">
              <div>
                <SectionLabel style={{ marginBottom: 9 }}>Technical Interviews · {selectedRoleMeta?.title}</SectionLabel>
                <h2 id="technical-role-cases-heading">Choose a case</h2>
                <p>
                  Your score counts toward Interview Readiness, alongside strategy cases.
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
            {availability.showCases && (
              <>
                <CaseCardGrid cases={activeRoleCases} selectedCaseId={selectedCaseId} onSelect={setSelectedCaseId} outcomes={caseOutcomes} />
                <StartVoiceInterviewButton
                  canStart={availability.canStart}
                  onStart={() => {
                    if (availability.canStart && selectedCaseId) void start(selectedCaseId);
                  }}
                />
              </>
            )}
            {(notice || error) && (
              <p role="status" style={{ margin: "12px 2px 0", fontSize: 12, color: error ? "var(--gap)" : "var(--ink-3)" }}>
                {error ?? notice}
              </p>
            )}
          </section>
        )}

        {selectedTrack === "technical" && selectedTechnicalRole !== null && activeRoleCases.length === 0 && (
          <section className="technical-simulation surface-card" aria-labelledby="technical-role-preview-heading">
            <button type="button" className="grid-all-tracks" onClick={backToTechnicalRoles}>
              <span aria-hidden="true">←</span> Roles
            </button>
            <div className="grid-track-header">
              <div>
                <SectionLabel style={{ marginBottom: 9 }}>Technical Interviews</SectionLabel>
                <h2 id="technical-role-preview-heading">{selectedRoleMeta?.title}</h2>
              </div>
              <span className="grid-track-status">Coming soon</span>
            </div>
            <div className="technical-role-preview" role="status" aria-live="polite">
              <div>
                <SectionLabel style={{ marginBottom: 7 }}>Selected role</SectionLabel>
                <h3>{selectedRoleMeta?.title}</h3>
              </div>
              <p>
                Technical interview rounds for this role will appear here when they are ready.
                No readiness score or application data is changed by this preview.
              </p>
              <span>Coming soon</span>
            </div>
          </section>
        )}
      </div>
    );
  }

  const avatarMode = mapCaseVoiceToAvatarMode({
    status,
    muted,
    userSpeaking,
    conversationStatus: projection?.conversationStatus,
    liveStatus: projection?.liveStatus,
  });

  return (
    <div className="case-voice-session" style={{ marginTop: 18 }}>
      <InterviewerAvatar
        mode={avatarMode}
        level={level}
        variant="panel"
        captionKicker="Case interviewer / The GRID"
      />
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
            aria-label="Case interview time remaining"
            className={`case-voice-timer${timerWarning !== null ? " is-warning" : ""}`}
            style={{
              minWidth: timerPending ? 118 : 62,
              padding: "7px 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "var(--ink-4)", fontWeight: 600 }}>TIME LEFT</div>
            <div
              aria-live={timerWarning !== null ? "polite" : "off"}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: timerPending ? 10 : 14,
                color: timerWarning !== null ? "var(--partial)" : "var(--ink)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {timerLabel}
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
          <NativeLiveProgressPanel
            caseId={nativeLiveCapability.caseId}
            stageIndex={nativeLiveProgress.stageIndex}
          />

          {/* The three technical native experiences only; the strategy cases
              keep their existing live surface unchanged. */}
          {isTechnicalNativeCase(nativeLiveCapability.caseId) && (
            <NativeCurrentQuestionPanel
              state={currentQuestion ?? initialNativeCurrentQuestion(nativeLiveCapability.caseId)}
            />
          )}

          <NativeCaseBriefPanel
            caseId={nativeLiveCapability.caseId}
            stageIndex={nativeLiveProgress.stageIndex}
          />

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

/**
 * Evaluator-aware live progress. The step vocabulary and count come from the
 * case's progress definition, so the strategy cases keep their consulting stages
 * while the technical experiences show their own steps and their own "n of N".
 */
function NativeLiveProgressPanel({
  caseId,
  stageIndex,
}: {
  caseId: string;
  stageIndex: number;
}) {
  const definition = nativeProgressDefinition(caseId);
  if (!definition) return null;
  return (
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
      aria-label={definition.ariaLabel}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
      }}>
        <SectionLabel>{definition.panelLabel}</SectionLabel>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--ink-3)",
        }}>
          {Math.max(0, stageIndex + 1)} of {definition.steps.length}
        </span>
      </div>
      <StageTracker
        stages={definition.steps.map((step) => step.label)}
        currentIdx={stageIndex}
      />
    </div>
  );
}

/**
 * The question the candidate is currently being asked. Shows the configured
 * readiness line until the first canonical anchor is spoken, then the complete
 * spoken question, then any substantive follow-up probe. Acknowledgements never
 * clear it. Body text is always verbatim assistant speech the candidate already
 * heard — no prompt, guidance, rubric, or metadata can reach this panel.
 */
function NativeCurrentQuestionPanel({ state }: { state: NativeCurrentQuestionState }) {
  return (
    <div
      style={{
        marginTop: 14,
        padding: "14px 16px",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
      aria-label="Current question"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        <SectionLabel>Current question</SectionLabel>
        {state.title && (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{state.title}</span>
        )}
        {state.kind === "probe" && (
          <span style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--accent)",
          }}>
            Follow-up
          </span>
        )}
      </div>
      <p
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.6,
          color: state.kind === "readiness" ? "var(--ink-3)" : "var(--ink)",
        }}
      >
        {state.text}
      </p>
    </div>
  );
}

/**
 * Persistent brief for the system-design case and a collapsed round overview for
 * the two question-bank rounds. Airport and GCC Gym resolve to null and show
 * nothing.
 *
 * The Clickstream brief reveals progressively: it is derived purely from the
 * current progress step, so it renders nothing before the interview starts and
 * reconstructs identically after a refresh without any separate reveal state.
 * Only the open/closed disclosure is local.
 */
function NativeCaseBriefPanel({
  caseId,
  stageIndex,
}: {
  caseId: string;
  stageIndex: number;
}) {
  const brief = nativeCaseBrief(caseId, stageIndex);
  const [open, setOpen] = useState(brief?.defaultOpen ?? false);
  if (!brief) return null;
  return (
    <div
      style={{
        marginTop: 14,
        padding: "14px 16px",
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="case-brief-panel"
        onClick={() => setOpen((current) => !current)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          gap: 12,
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          color: "var(--ink)",
        }}
      >
        <SectionLabel>{brief.title}</SectionLabel>
        <span aria-hidden style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {open ? "\u25b2" : "\u25bc"}
        </span>
      </button>
      <div id="case-brief-panel" hidden={!open}>
        {open && (
          <>
            <p style={{ margin: "8px 0 12px", fontSize: 12, color: "var(--ink-3)" }}>
              {brief.intro}
            </p>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: 16,
            }}>
              {brief.sections.map((section) => (
                <div key={section.heading}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--ink)",
                    marginBottom: 7,
                  }}>
                    {section.heading}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                    {section.items.map((item) => (
                      <li key={item} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
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
