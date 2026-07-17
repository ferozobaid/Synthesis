"use client";

/**
 * Behavioural voice interview — hands-free voice layer. Vapi owns the live
 * conversation; Synthesis scores the transcript AFTER the call via the
 * assistant-level end-of-call-report webhook. There is no per-turn tool call and
 * no transcript-content trigger that ends the call.
 *
 * Flow: POST /api/vapi/session returns the ordered `questions` array, a numbered
 * `questionList`, the exact `firstQuestion`, and a one-time `reportToken`. We show
 * Q1 immediately, hand Vapi the list + first question + context via
 * variableValues, keep the displayed question in sync from final assistant
 * transcripts, and — when the call ends — poll the report status endpoint with the
 * token until the report is done/failed. A pending {sessionId, reportToken} is
 * kept in localStorage so polling resumes across a refresh. Raw transcripts live
 * only in component state and are never persisted.
 *
 * Progressive enhancement: when the public Vapi env vars are absent the component
 * renders nothing, so the page is unchanged wherever voice isn't configured.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { containment } from "@/lib/text";
import type { BehaviouralQualitativeReport } from "@/lib/behavioural/qualitative";

const WEB_KEY = process.env.NEXT_PUBLIC_VAPI_WEB_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_BEHAVIOURAL_ASSISTANT_ID;

/** Minimal surface of the Vapi Web SDK we depend on (kept version-agnostic). */
interface VapiLike {
  on(event: string, cb: (payload?: unknown) => void): void;
  removeAllListeners?: () => void;
  start(assistant: string, overrides?: unknown): Promise<unknown>;
  stop(): void;
  setMuted?(muted: boolean): void;
}

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "processing"
  | "done"
  | "timeout"
  | "failed"
  | "error";

interface Question {
  id: string;
  question: string;
}

/** The aggregate report shape the status endpoint returns (BehaviouralSummary). */
export interface VoiceReport {
  overall: number;
  dimension_averages: { dimension: string; average: number }[];
  answered: number;
  /** Total questions in the interview + how many went unanswered (partial calls). */
  total?: number;
  unanswered?: number;
  feedback: { summary: string; next_focus: string[] };
  qualitative?: BehaviouralQualitativeReport | null;
}

interface TranscriptLine {
  role: "assistant" | "user";
  text: string;
}

const QUESTION_MATCH_THRESHOLD = 0.6;
const QUESTION_SKIP_THRESHOLD = 0.8;
// Post-call scoring can be many sequential model calls; poll a realistic window.
// Bounded by both attempts and elapsed time; a local timeout is NOT a server
// failure — it preserves the pending capability so the user can resume polling.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 200;
const POLL_MAX_MS = 360_000; // ~6 minutes
export const PENDING_CLIENT_TTL_MS = 115 * 60 * 1000; // Redis TTL is 2h; expire locally just before.
export const POLL_404_GRACE_MS = 12_000;
const TRANSCRIPT_CAP = 200;
export const EXPIRED_REPORT_MESSAGE =
  "This report session expired. Start a new interview or continue in text mode.";

export const PENDING_KEY = "synthesis.voice.behavioural.pending.v1";
export interface PendingCapability {
  sessionId: string;
  reportToken: string;
  createdAt: number;
}

export interface PendingReadResult {
  pending: PendingCapability | null;
  expired: boolean;
}

export function isPendingExpired(p: Partial<PendingCapability> | null, now = Date.now()): boolean {
  if (!p || typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) return true;
  return now - p.createdAt >= PENDING_CLIENT_TTL_MS;
}

export function shouldExpireRepeated404(firstNotFoundAt: number | null, now = Date.now()): boolean {
  return firstNotFoundAt !== null && now - firstNotFoundAt >= POLL_404_GRACE_MS;
}

export function voiceOwnsManualMode(configured: boolean, status: VoiceStatus): boolean {
  if (!configured) return false;
  return (
    status === "connecting" ||
    status === "listening" ||
    status === "speaking" ||
    status === "processing" ||
    status === "timeout"
  );
}

export function readPending(now = Date.now()): PendingReadResult {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(PENDING_KEY) : null;
    if (!raw) return { pending: null, expired: false };
    const p = JSON.parse(raw);
    if (
      p &&
      typeof p.sessionId === "string" &&
      typeof p.reportToken === "string" &&
      typeof p.createdAt === "number"
    ) {
      if (isPendingExpired(p, now)) {
        clearPending();
        return { pending: null, expired: true };
      }
      return { pending: p, expired: false };
    }
    clearPending();
    return { pending: null, expired: true };
  } catch {
    clearPending();
    return { pending: null, expired: true };
  }
}
function writePending(p: PendingCapability): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify({ ...p, createdAt: p.createdAt ?? Date.now() }));
  } catch {
    /* ignore */
  }
}
function clearPending(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Order-aware match to the NEXT question the assistant should ask. Prefers the
 * immediate next question; only accepts a forward skip on a strong match, so a
 * greeting/ack that merely echoes a keyword doesn't advance. `currentQ` is the
 * last CONFIRMED question index (-1 before Q1 is actually read aloud).
 */
function nextQuestionIndex(spoken: string, questions: Question[], currentQ: number): number {
  const nextIdx = currentQ + 1;
  if (nextIdx >= questions.length) return -1;
  if (containment(questions[nextIdx].question, spoken) >= QUESTION_MATCH_THRESHOLD) return nextIdx;
  let best = -1;
  let bestScore = 0;
  for (let i = nextIdx + 1; i < questions.length; i++) {
    const score = containment(questions[i].question, spoken);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= QUESTION_SKIP_THRESHOLD ? best : -1;
}

export default function VoiceInterview({
  jdText,
  onActiveChange,
  onComplete,
}: {
  jdText?: string;
  /** True while the configured voice flow owns the screen. */
  onActiveChange?: (active: boolean) => void;
  /** Called once the post-call report is ready. */
  onComplete?: (report: VoiceReport) => void;
}) {
  const configured = !!(WEB_KEY && ASSISTANT_ID);

  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  const vapiRef = useRef<VapiLike | null>(null);
  const startedRef = useRef(false);
  const initRef = useRef(false);
  const jdTextRef = useRef(jdText);
  jdTextRef.current = jdText;
  const questionsRef = useRef<Question[]>([]);
  const currentIndexRef = useRef(-1);
  const sessionIdRef = useRef<string | null>(null);
  const reportTokenRef = useRef<string | null>(null);
  const pollCancelRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!configured) {
      onActiveChange?.(false);
      return;
    }
    // "Engaged" = the voice flow owns the screen: the live call AND the post-call
    // processing/timeout states. While engaged the page must NOT reveal the manual
    // text form (the report replaces it when done).
    onActiveChange?.(voiceOwnsManualMode(configured, status));
  }, [configured, status, onActiveChange]);

  const teardown = useCallback(() => {
    pollCancelRef.current = true;
    const vapi = vapiRef.current;
    vapiRef.current = null;
    try {
      vapi?.stop();
    } catch {
      /* already stopped */
    }
    try {
      vapi?.removeAllListeners?.();
    } catch {
      /* no-op */
    }
  }, []);

  const expireReportSession = useCallback(() => {
    clearPending();
    sessionIdRef.current = null;
    reportTokenRef.current = null;
    startedRef.current = false;
    pollCancelRef.current = true;
    setStatus("idle");
    setError(EXPIRED_REPORT_MESSAGE);
  }, []);

  // Poll the report status endpoint until done/failed, or a local timeout.
  const pollReport = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const token = reportTokenRef.current;
    if (!sessionId || !token) {
      setStatus("failed");
      setError("Missing report credentials for this session.");
      return;
    }
    pollCancelRef.current = false;
    const startedAt = Date.now();
    let firstNotFoundAt: number | null = null;
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (pollCancelRef.current) return;
      if (Date.now() - startedAt > POLL_MAX_MS) break;
      try {
        const res = await fetch(`/api/behavioural/report/${encodeURIComponent(sessionId)}`, {
          headers: { "x-report-token": token },
        });
        if (res.ok) {
          firstNotFoundAt = null;
          const data = (await res.json()) as {
            reportStatus: string;
            report?: VoiceReport | null;
            reportError?: string | null;
          };
          if (data.reportStatus === "done" && data.report) {
            clearPending();
            setStatus("done");
            onCompleteRef.current?.(data.report);
            return;
          }
          if (data.reportStatus === "failed") {
            clearPending();
            setStatus("failed");
            setError(data.reportError || "We couldn't generate your report.");
            return;
          }
          // pending / processing → keep polling
        } else if (res.status === 404) {
          const now = Date.now();
          if (firstNotFoundAt === null) firstNotFoundAt = now;
          if (shouldExpireRepeated404(firstNotFoundAt, now)) {
            expireReportSession();
            return;
          }
        }
      } catch {
        /* transient network error — retry */
      }
      await sleep(POLL_INTERVAL_MS);
    }
    // Exhausted budget with no terminal server state — a LOCAL timeout, distinct
    // from an authoritative server failure. Keep the pending capability so the
    // user can resume polling (do NOT clearPending here).
    setStatus("timeout");
    setError(null);
  }, [expireReportSession]);

  const beginPostCall = useCallback(() => {
    setStatus("processing");
    void pollReport();
  }, [pollReport]);

  const start = useCallback(async () => {
    if (!configured || startedRef.current) return;
    startedRef.current = true;
    setError(null);
    setStatus("connecting");
    setTranscript([]);
    setCurrentIndex(-1);
    currentIndexRef.current = -1;

    try {
      const res = await fetch("/api/vapi/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: "behavioural",
          jdText: jdTextRef.current ?? "",
        }),
      });
      if (!res.ok) throw new Error("Could not start the interview session.");
      const bootstrap = (await res.json()) as {
        sessionId?: string;
        reportToken?: string;
        firstQuestion?: Question | null;
        questions?: Question[];
        questionList?: string;
        candidateName?: string | null;
        targetRole?: string | null;
        companyName?: string | null;
      };
      const sessionId = bootstrap.sessionId;
      const reportToken = bootstrap.reportToken;
      if (!sessionId || !reportToken) throw new Error("The interview session did not initialise.");
      const pendingCreatedAt = Date.now();
      sessionIdRef.current = sessionId;
      reportTokenRef.current = reportToken;
      writePending({ sessionId, reportToken, createdAt: pendingCreatedAt });

      const qs = Array.isArray(bootstrap.questions) ? bootstrap.questions : [];
      questionsRef.current = qs;
      setQuestions(qs);
      // currentIndex stays -1 (Q1 unconfirmed) for MATCHING; the render shows Q1
      // immediately via a separate display index, before the assistant speaks.

      const questionList = bootstrap.questionList ?? "";
      const firstQuestion = bootstrap.firstQuestion?.question ?? qs[0]?.question ?? "";
      // Safe diagnostic — counts/lengths only, never question or answer text.
      console.info("[voice] bootstrap", {
        questionCount: qs.length,
        questionListLines: questionList ? questionList.split("\n").length : 0,
        questionListNonEmpty: questionList.trim().length > 0,
        firstQuestionNonEmpty: firstQuestion.trim().length > 0,
        passedToVapiViaVariableValues: true,
      });

      const mod = await import("@vapi-ai/web");
      const Vapi = mod.default as unknown as new (key: string) => VapiLike;
      const vapi = new Vapi(WEB_KEY!);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setStatus((s) => (s === "connecting" ? "listening" : s)));
      vapi.on("speech-start", () =>
        setStatus((s) => (s === "listening" || s === "speaking" ? "speaking" : s)),
      );
      vapi.on("speech-end", () =>
        setStatus((s) => (s === "listening" || s === "speaking" ? "listening" : s)),
      );
      vapi.on("call-end", () => {
        // Vapi ended the call; the transcript is scored post-call. Begin polling.
        beginPostCall();
      });
      vapi.on("error", () => {
        setError("Voice connection error — you can still type your answers below.");
        setStatus("error");
      });

      // Safe UI sync + live transcript, from FINAL transcripts only. Never logs
      // transcript/answer text; never ends the call from transcript content.
      vapi.on("message", (message) => {
        const m = message as {
          type?: string;
          role?: string;
          transcriptType?: string;
          transcript?: string;
        } | null;
        if (!m || m.type !== "transcript" || m.transcriptType !== "final") return;
        const spoken = typeof m.transcript === "string" ? m.transcript.trim() : "";
        if (!spoken) return;
        const role: "assistant" | "user" | null =
          m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
        if (!role) return;

        setTranscript((prev) => {
          const next = [...prev, { role, text: spoken }];
          return next.length > TRANSCRIPT_CAP ? next.slice(next.length - TRANSCRIPT_CAP) : next;
        });

        if (role === "assistant") {
          const idx = nextQuestionIndex(spoken, questionsRef.current, currentIndexRef.current);
          if (idx > currentIndexRef.current) {
            currentIndexRef.current = idx;
            setCurrentIndex(idx);
            console.info("[voice] question", { number: idx + 1, of: questionsRef.current.length });
          }
        }
      });

      await vapi.start(ASSISTANT_ID!, {
        variableValues: {
          sessionId,
          questionList,
          firstQuestion,
          targetRole: bootstrap.targetRole ?? "",
          companyName: bootstrap.companyName ?? "",
        },
        metadata: { sessionId },
      });
    } catch (e) {
      startedRef.current = false;
      teardown();
      setError(e instanceof Error ? e.message : "Could not start the voice interview.");
      setStatus("error");
    }
  }, [configured, teardown, beginPostCall]);

  const endCall = useCallback(() => {
    // Stop the mic/call; the end-of-call-report still fires, so score post-call.
    teardown();
    beginPostCall();
  }, [teardown, beginPostCall]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        vapiRef.current?.setMuted?.(next);
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  const restart = useCallback(() => {
    clearPending();
    startedRef.current = false;
    setError(null);
    void start();
  }, [start]);

  // Init once: resume polling a pending report (refresh recovery), else auto-start.
  useEffect(() => {
    if (!configured || initRef.current) return;
    initRef.current = true;
    const { pending, expired } = readPending();
    if (pending) {
      sessionIdRef.current = pending.sessionId;
      reportTokenRef.current = pending.reportToken;
      setStatus("processing");
      void pollReport();
    } else if (expired) {
      expireReportSession();
    } else {
      void start();
    }
    return teardown;
  }, [configured, start, teardown, pollReport, expireReportSession]);

  if (!configured) return null;

  const active = status === "listening" || status === "speaking";
  const label =
    status === "connecting"
      ? "Connecting to your interviewer…"
      : status === "idle"
        ? "Voice interview ready"
      : status === "speaking"
        ? "Interviewer is speaking…"
        : status === "listening"
          ? "Listening — go ahead"
          : status === "processing"
            ? "Generating your report…"
            : status === "timeout"
              ? "Still generating your report…"
              : status === "done"
                ? "Report ready"
                : status === "failed"
                  ? "Report unavailable"
                  : "Voice interview unavailable";
  const dotColor =
    status === "speaking"
      ? "var(--secondary)"
      : status === "listening"
        ? "var(--success)"
        : status === "processing" || status === "timeout"
          ? "var(--partial)"
        : status === "error" || status === "failed"
          ? "var(--gap)"
          : status === "idle"
            ? "var(--ink-4)"
          : "var(--ink-4)";

  const inCall = status === "connecting" || status === "listening" || status === "speaking";
  // Show Q1 immediately (displayIndex 0) even before it's confirmed by transcript.
  const displayIndex = questions.length > 0 ? Math.max(0, currentIndex) : -1;
  const currentQuestion = displayIndex >= 0 ? questions[displayIndex] : undefined;
  const showQuestion = !!currentQuestion && inCall;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 14,
        padding: "14px 18px",
        boxShadow: "var(--shadow-sm)",
        marginBottom: 18,
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: dotColor,
            animation: active ? "pulseDot 1.2s ease-in-out infinite" : "none",
            flex: "none",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".08em",
              color: "var(--secondary)",
              fontWeight: 600,
            }}
          >
            VOICE INTERVIEW
            {currentQuestion && questions.length > 0 && inCall
              ? ` · Q${displayIndex + 1} OF ${questions.length}`
              : ""}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>
            {label}
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status === "idle" && (
            <button type="button" onClick={start} style={btn("solid")}>
              Start voice interview
            </button>
          )}
          {inCall && (
            <>
              <button type="button" onClick={toggleMute} style={btn("ghost")}>
                {muted ? "Unmute" : "Mute"}
              </button>
              <button type="button" onClick={endCall} style={btn("ghost")}>
                End interview
              </button>
            </>
          )}
          {status === "timeout" && (
            <>
              <button type="button" onClick={beginPostCall} style={btn("solid")}>
                Keep checking
              </button>
              <button type="button" onClick={restart} style={btn("ghost")}>
                Start over
              </button>
            </>
          )}
          {(status === "done" || status === "failed" || status === "error") && (
            <button type="button" onClick={restart} style={btn("solid")}>
              {status === "done" ? "New interview" : "Try again"}
            </button>
          )}
        </div>
      </div>

      {showQuestion && (
        <div
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 11,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: ".06em",
              color: "var(--secondary)",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            CURRENT QUESTION
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, margin: 0, color: "var(--ink)" }}>
            {currentQuestion!.question}
          </p>
        </div>
      )}

      {transcript.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--ink-3)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: ".06em",
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
            }}
            aria-expanded={showTranscript}
          >
            {showTranscript ? "▾ HIDE TRANSCRIPT" : "▸ SHOW TRANSCRIPT"} ({transcript.length})
          </button>
          {showTranscript && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 220,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "var(--surface-2)",
                border: "1px solid var(--line)",
                borderRadius: 11,
                padding: "12px 14px",
              }}
            >
              {transcript.map((line, i) => (
                <div key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: line.role === "assistant" ? "var(--secondary)" : "var(--success)",
                      marginRight: 6,
                    }}
                  >
                    {line.role === "assistant" ? "INTERVIEWER" : "YOU"}
                  </span>
                  <span style={{ color: "var(--ink-2)" }}>{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status === "timeout" && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>
          This is taking longer than usual — your report may still be processing.
          Keep checking or start over; your progress is saved.
        </p>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: "var(--gap)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function btn(kind: "solid" | "ghost"): React.CSSProperties {
  return {
    border: kind === "ghost" ? "1px solid var(--line)" : "none",
    background: kind === "ghost" ? "var(--surface-2)" : "var(--secondary)",
    color: kind === "ghost" ? "var(--ink-2)" : "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 16px",
    borderRadius: 10,
    cursor: "pointer",
  };
}
