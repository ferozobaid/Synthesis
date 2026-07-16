"use client";

/**
 * Behavioural voice interview — wires the existing Vapi backend into a hands-free
 * voice experience, without changing the on-screen typed flow.
 *
 * Flow: POST /api/vapi/session (module: "behavioural") to create a server-side
 * session in Redis, then launch the Vapi Web SDK with that sessionId passed as an
 * assistant variable so every `submit_behavioural_answer` tool call carries it.
 * The interview ends when a tool result reports complete: true (or the call ends).
 *
 * Progressive enhancement: when the public Vapi env vars are absent the component
 * renders nothing, so the page is unchanged wherever voice isn't configured.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// Public, browser-safe config. The server-only VAPI_WEBHOOK_SECRET / Redis creds
// are never referenced here — the tool webhook auth stays entirely server-side.
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

export default function VoiceInterview({ jdText }: { jdText?: string }) {
  const configured = !!(WEB_KEY && ASSISTANT_ID);

  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const vapiRef = useRef<VapiLike | null>(null);
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  // Keep the latest jdText without forcing the start effect to re-run.
  const jdTextRef = useRef(jdText);
  jdTextRef.current = jdText;

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
        questionList?: string;
        candidateName?: string | null;
        targetRole?: string | null;
        companyName?: string | null;
      };
      const sessionId = bootstrap.sessionId;
      if (!sessionId) throw new Error("The interview session did not initialise.");

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

      // 3) Hand the assistant the full ordered question list + context. The name
      // `questionList` must exactly match the {{questionList}} prompt variable so
      // the assistant asks every core question in order and concludes only after
      // the last one. `sessionId` is carried for post-call scoring.
      await vapi.start(ASSISTANT_ID!, {
        variableValues: {
          sessionId,
          questionList: bootstrap.questionList ?? "",
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
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

      {error && (
        <p role="alert" style={{ flexBasis: "100%", margin: "4px 0 0", fontSize: 12, color: "var(--gap)" }}>
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
