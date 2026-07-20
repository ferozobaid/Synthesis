"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CASE_STATES, type CaseExhibit, type CaseScore, type CaseState } from "@/lib/types";
import { ChatBubble } from "@/components/ui/ChatBubble";
import { ExhibitCard } from "@/components/ui/ExhibitCard";
import { StageTracker } from "@/components/ui/StageTracker";
import { SectionLabel } from "@/components/ui/primitives";
import { to100 } from "@/components/ui/verdict";

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
  action: string;
  exhibit: CaseExhibit | null;
  timestamp: string;
}

export interface CaseVoiceProjection {
  caseId: "beautify";
  caseTitle: string;
  openingText: string;
  readinessStatus: "awaiting" | "confirmed";
  readinessConfirmedAt: string | null;
  conversationStatus: "active" | "paused";
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
  caseId: "beautify";
  caseTitle: string;
  openingPrompt: string;
  createdAt: number;
}

export interface PendingCaseVoiceReadResult {
  pending: PendingCaseVoiceCapability | null;
  expired: boolean;
}

interface CaseBootstrap {
  sessionId: string;
  projectionToken: string;
  openingPrompt: string;
  caseTitle: string;
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
      value.caseId === "beautify" &&
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
    metadata: { sessionId: bootstrap.sessionId, caseId: "beautify" },
  };
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
    projection.caseId !== "beautify" ||
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
  caseId,
  onComplete,
}: {
  caseId: string;
  onComplete?: (score: CaseScore) => void;
}) {
  const configured = Boolean(WEB_KEY && ASSISTANT_ID);
  const [status, setStatus] = useState<CaseVoiceStatus>("idle");
  const [muted, setMuted] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [capability, setCapability] = useState<PendingCaseVoiceCapability | null>(null);
  const [projection, setProjection] = useState<CaseVoiceProjection | null>(null);
  const [liveCaption, setLiveCaption] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(CASE_VOICE_TRANSCRIPT_DEFAULT_EXPANDED);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [timerEndedAt, setTimerEndedAt] = useState<number | null>(null);

  const vapiRef = useRef<VapiLike | null>(null);
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
    onCompleteRef.current?.(score);
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
    endedAtRef.current = Date.now();
    setTimerEndedAt(endedAtRef.current);
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

  const start = useCallback(async () => {
    if (!configured || caseId !== "beautify" || callActiveRef.current) return;
    teardown();
    clearCaseVoicePending();
    completionReportedRef.current = false;
    recoveredRef.current = false;
    endedAtRef.current = null;
    firstNotFoundAtRef.current = null;
    projectionRef.current = null;
    setProjection(null);
    setCapability(null);
    setLiveCaption(null);
    setShowTranscript(false);
    setTimerEndedAt(null);
    setTimerNow(Date.now());
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
        body: JSON.stringify({ module: "case", caseId: "beautify" }),
      });
      if (attempt !== startAttemptRef.current) return;
      if (!response.ok) throw new Error("Could not start the Beautify voice session.");
      const bootstrap = (await response.json()) as Partial<CaseBootstrap>;
      if (attempt !== startAttemptRef.current) return;
      if (
        typeof bootstrap.sessionId !== "string" ||
        typeof bootstrap.projectionToken !== "string" ||
        typeof bootstrap.openingPrompt !== "string" ||
        typeof bootstrap.caseTitle !== "string"
      ) {
        throw new Error("The Beautify voice session did not initialise.");
      }

      const pending: PendingCaseVoiceCapability = {
        sessionId: bootstrap.sessionId,
        projectionToken: bootstrap.projectionToken,
        caseId: "beautify",
        caseTitle: bootstrap.caseTitle,
        openingPrompt: bootstrap.openingPrompt,
        createdAt: Date.now(),
      };
      writeCaseVoicePending(pending);
      setCapability(pending);

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
        const text = caseVoiceLiveCaption(message);
        if (!text) return;
        setLiveCaption(text);
      });

      const startedCall = await vapi.start(
        ASSISTANT_ID!,
        caseVoiceStartOverrides(bootstrap as CaseBootstrap),
      ) as {
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
      teardown();
      clearCaseVoicePending();
      setCapability(null);
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not start the Case voice interview.");
    }
  }, [caseId, configured, handleCallEnd, setCallIsActive, teardown]);

  const endCall = useCallback(() => {
    const latest = projectionRef.current;
    startAttemptRef.current += 1;
    teardown();
    endedAtRef.current = Date.now();
    setTimerEndedAt(endedAtRef.current);
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
    return () => {
      startAttemptRef.current += 1;
      teardown();
    };
  }, [teardown]);

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
    const running =
      projection?.readinessStatus === "confirmed" &&
      callActive &&
      !projection.complete &&
      timerEndedAt === null;
    if (!running) return;
    setTimerNow(Date.now());
    const timer = setInterval(() => setTimerNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [callActive, projection?.complete, projection?.readinessStatus, timerEndedAt]);

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
  const elapsed = formatCaseVoiceElapsed(
    caseVoiceElapsedMilliseconds(
      projection?.readinessConfirmedAt ?? null,
      timerNow,
      timerEndedAt,
    ),
  );

  if (caseId !== "beautify") {
    return (
      <p role="status" style={{ color: "var(--ink-3)", fontSize: 13, margin: "18px 0 0" }}>
        Live voice is available for Beautify only in this release.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div
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
            BEAUTIFY LIVE VOICE
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {statusLabel(status)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div
            aria-label="Case interview timer"
            style={{
              minWidth: 62,
              padding: "7px 10px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 9, color: "var(--ink-4)", fontWeight: 600 }}>CASE TIME</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink)", fontWeight: 600 }}>
              {elapsed}
            </div>
          </div>
          {controls.start && (
            <button type="button" onClick={start} disabled={!configured} style={buttonStyle("solid", !configured)}>
              {status === "idle" ? "Start voice interview" : "Start new interview"}
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
              <div style={{ border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", minWidth: 0 }}>
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

            <div style={{ minWidth: 0 }}>
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
