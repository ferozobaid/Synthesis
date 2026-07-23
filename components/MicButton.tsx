"use client";

import type { SpeechRecognitionStatus } from "./useSpeechRecognition";

/**
 * Microphone toggle for voice answer input.
 *
 * Purely presentational plus a click handler — all recognition logic lives in
 * `useSpeechRecognition`. Renders nothing when the browser has no speech
 * support, so the caller's text path stands alone without an inert button.
 */
interface MicButtonProps {
  supported: boolean;
  listening: boolean;
  status: SpeechRecognitionStatus;
  onStart: () => void;
  onStop: () => void;
}

export default function MicButton({ supported, listening, status, onStart, onStop }: MicButtonProps) {
  if (!supported) return null;

  const requestingPermission = status === "requesting_permission";
  const active = listening || requestingPermission;
  const label = requestingPermission
    ? "Requesting microphone…"
    : listening
      ? "Listening… tap to stop"
      : "Speak answer";

  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      disabled={requestingPermission}
      aria-pressed={listening}
      aria-busy={requestingPermission}
      aria-label={
        requestingPermission ? "Requesting microphone permission" : listening ? "Stop voice input" : "Start voice input"
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
        border: `1px solid ${active ? "var(--gap)" : "var(--line)"}`,
        background: active ? "var(--gap-tint)" : "var(--surface-2)",
        color: active ? "var(--gap)" : "var(--ink-2)",
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: requestingPermission ? "wait" : "pointer",
        opacity: requestingPermission ? 0.85 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: active ? "var(--gap)" : "var(--ink-4)",
          animation: active ? "pulseDot 1.2s ease-in-out infinite" : "none",
        }}
      />
      {label}
    </button>
  );
}
