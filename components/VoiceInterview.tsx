"use client";

/**
 * Behavioural voice interview — hands-free voice layer over the existing
 * behavioural flow. Vapi owns the live conversation; Synthesis scores the
 * transcript AFTER the call (post-call scoring is a later step). There is no
 * per-turn tool call and no transcript-content trigger that ends the call.
 *
 * Flow: POST /api/vapi/session (module: "behavioural") creates a server-side
 * session and returns the ordered `questions` array + a numbered `questionList`
 * string. We launch the Vapi Web SDK, hand the assistant `questionList` (and
 * context) via variableValues, and use the SAME ordered `questions` array as the
 * single source of truth for what to display. A safe message listener matches
 * each spoken assistant question to that ordered list to keep the on-screen
 * question in sync. The call ends only on Vapi's own `call-end` event.
 *
 * Progressive enhancement: when the public Vapi env vars are absent the component
 * renders nothing, so the page is unchanged wherever voice isn't configured.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { containment } from "@/lib/text";

// Public, browser-safe config. The server-only VAPI_WEBHOOK_SECRET / Redis creds
// are never referenced here — the webhook auth stays entirely server-side.
const WEB_KEY = process.env.NEXT_PUBLIC_VAPI_WEB_KEY;
const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_BEHAVIOURAL_ASSISTANT_ID;

/** Minimal surface of the Vapi Web SDK we depend on (kept version-agnostic). */
interface VapiLike {
  on(event: string, cb: (payload?: unknown) => void): void;
  removeAllListeners?: () => void;
  start(assistant: string, overrides?: unknown): Promise<unknown>;
  stop(): void;
}

type VoiceStatus =
  | "connecting"
  | "listening"
  | "speaking"
  | "complete"
  | "error";

interface Question {
  id: string;
  question: string;
}

/** A spoken assistant line must contain at least this fraction of a question's
 *  salient tokens to be treated as "the assistant is now asking that question". */
const QUESTION_MATCH_THRESHOLD = 0.6;

/**
 * Best match of a spoken assistant line to the ordered question list, considering
 * only the current question and those after it (never jumps backwards). Returns
 * the matched index, or -1 when nothing clears the threshold. Ties keep the
 * earliest question (strict `>` update).
 */
function matchQuestionIndex(
  spoken: string,
  questions: Question[],
  fromIndex: number,
): number {
  let best = -1;
  let bestScore = 0;
  for (let i = Math.max(0, fromIndex); i < questions.length; i++) {
    const score = containment(questions[i].question, spoken);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= QUESTION_MATCH_THRESHOLD ? best : -1;
}

export default function VoiceInterview({
  jdText,
  onActiveChange,
}: {
  jdText?: string;
  /** True while a voice call is connecting/live; the page hides the manual
   *  question so the displayed question matches what Vapi is asking. */
  onActiveChange?: (active: boolean) => void;
}) {
  const configured = !!(WEB_KEY && ASSISTANT_ID);

  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  // The ordered question set from bootstrap is the single source of truth.
  const [questions, setQuestions] = useState<Question[]>([]);
  // Which question Vapi is currently asking (-1 before the first is recognised).
  const [currentIndex, setCurrentIndex] = useState(-1);

  const vapiRef = useRef<VapiLike | null>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  const jdTextRef = useRef(jdText);
  jdTextRef.current = jdText;
  // Refs mirror the state so the (once-bound) message listener reads live values.
  const questionsRef = useRef<Question[]>([]);
  const currentIndexRef = useRef(-1);

  // Tell the page whether a voice call is active so it can hide the manual card.
  useEffect(() => {
    const active =
      status === "connecting" || status === "listening" || status === "speaking";
    onActiveChange?.(active);
  }, [status, onActiveChange]);

  const teardown = useCallback(() => {
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

  const start = useCallback(async () => {
    if (!configured || startedRef.current) return;
    startedRef.current = true;
    completedRef.current = false;
    setError(null);
    setStatus("connecting");
    setCurrentIndex(-1);
    currentIndexRef.current = -1;

    try {
      // 1) Create the server-side voice session (Redis-backed).
      const res = await fetch("/api/vapi/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: "behavioural", jdText: jdTextRef.current ?? "" }),
      });
      if (!res.ok) throw new Error("Could not start the interview session.");
      const bootstrap = (await res.json()) as {
        sessionId?: string;
        questions?: Question[];
        questionList?: string;
        candidateName?: string | null;
        targetRole?: string | null;
        companyName?: string | null;
      };
      const sessionId = bootstrap.sessionId;
      if (!sessionId) throw new Error("The interview session did not initialise.");

      const qs = Array.isArray(bootstrap.questions) ? bootstrap.questions : [];
      questionsRef.current = qs;
      setQuestions(qs);

      const questionList = bootstrap.questionList ?? "";
      // Safe diagnostic — counts/lengths ONLY, never answer text or question text.
      // Confirms questionList is non-empty, carries the full question count, and is
      // what we hand to Vapi via variableValues below.
      console.info("[voice] bootstrap", {
        questionCount: qs.length,
        questionListLines: questionList ? questionList.split("\n").length : 0,
        questionListChars: questionList.length,
        questionListNonEmpty: questionList.trim().length > 0,
        passedToVapiViaVariableValues: true,
      });

      // 2) Launch the Vapi Web SDK (client-only import; avoids SSR).
      const mod = await import("@vapi-ai/web");
      const Vapi = mod.default as unknown as new (key: string) => VapiLike;
      const vapi = new Vapi(WEB_KEY!);
      vapiRef.current = vapi;

      vapi.on("call-start", () => setStatus((s) => (completedRef.current ? s : "listening")));
      vapi.on("speech-start", () => setStatus((s) => (completedRef.current ? s : "speaking")));
      vapi.on("speech-end", () => setStatus((s) => (completedRef.current ? s : "listening")));
      vapi.on("call-end", () => {
        // Vapi owns the conversation and ends the call after the final listed
        // question; the interview concludes here (no transcript-content trigger).
        setStatus("complete");
      });
      vapi.on("error", () => {
        setError("Voice connection error — you can still type your answers below.");
        setStatus("error");
      });

      // Safe UI sync: match each FINAL assistant line to the ordered question list
      // and advance the displayed question. Never inspects/logs answer (user) text;
      // never ends the call from transcript content.
      vapi.on("message", (message) => {
        const m = message as {
          type?: string;
          role?: string;
          transcriptType?: string;
          transcript?: string;
        } | null;
        if (!m || m.type !== "transcript" || m.transcriptType !== "final") return;
        if (m.role !== "assistant") return; // ignore candidate/answer transcripts
        const spoken = typeof m.transcript === "string" ? m.transcript : "";
        if (!spoken) return;
        const idx = matchQuestionIndex(spoken, questionsRef.current, currentIndexRef.current);
        if (idx > currentIndexRef.current) {
          currentIndexRef.current = idx;
          setCurrentIndex(idx);
          // Diagnostic: position only, never text.
          console.info("[voice] question", { number: idx + 1, of: questionsRef.current.length });
        }
      });

      // 3) Hand the assistant the full ordered question list + context. The name
      // `questionList` must exactly match the {{questionList}} prompt variable so
      // the assistant asks every core question in order and concludes only after
      // the last one. `sessionId` is carried for post-call scoring.
      await vapi.start(ASSISTANT_ID!, {
        variableValues: {
          sessionId,
          questionList,
          candidateName: bootstrap.candidateName ?? "",
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
  }, [configured, teardown]);

  const end = useCallback(() => {
    completedRef.current = true;
    teardown();
    setStatus("complete");
  }, [teardown]);

  const restart = useCallback(() => {
    startedRef.current = false;
    void start();
  }, [start]);

  // Auto-start the voice conversation on mount; tear the call down on unmount.
  useEffect(() => {
    if (!configured) return;
    void start();
    return teardown;
  }, [configured, start, teardown]);

  // Never alter the page where voice isn't set up.
  if (!configured) return null;

  const active = status === "listening" || status === "speaking";
  const label =
    status === "connecting"
      ? "Connecting to your interviewer…"
      : status === "speaking"
        ? "Interviewer is speaking…"
        : status === "listening"
          ? "Listening — go ahead"
          : status === "complete"
            ? "Voice interview complete"
            : "Voice interview unavailable";
  const dotColor =
    status === "speaking"
      ? "var(--secondary)"
      : status === "listening"
        ? "var(--success)"
        : status === "error"
          ? "var(--gap)"
          : "var(--ink-4)";

  const currentQuestion = currentIndex >= 0 ? questions[currentIndex] : undefined;
  const showQuestion =
    !!currentQuestion && (status === "listening" || status === "speaking");

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
            {currentQuestion && questions.length > 0
              ? ` · Q${currentIndex + 1} OF ${questions.length}`
              : ""}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", lineHeight: 1.3 }}>
            {label}
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(status === "listening" || status === "speaking" || status === "connecting") && (
            <button type="button" onClick={end} style={btn("ghost")}>
              End interview
            </button>
          )}
          {(status === "complete" || status === "error") && (
            <button type="button" onClick={restart} style={btn("solid")}>
              {status === "error" ? "Try again" : "Restart"}
            </button>
          )}
        </div>
      </div>

      {/* The question Vapi is currently asking — the single displayed question
          while voice is active, kept in sync from the ordered bootstrap list. */}
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
