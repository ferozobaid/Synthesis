"use client";

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
  onStart: () => void;
  onStop: () => void;
}

export default function MicButton({ supported, listening, onStart, onStop }: MicButtonProps) {
  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      aria-pressed={listening}
      aria-label={listening ? "Stop voice input" : "Start voice input"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 12,
        border: `1px solid ${listening ? "var(--gap)" : "var(--line)"}`,
        background: listening ? "var(--gap-tint)" : "var(--surface)",
        color: listening ? "var(--gap)" : "var(--ink-2)",
        padding: "10px 15px",
        fontSize: 13,
        fontWeight: 620,
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: listening ? "var(--gap)" : "var(--ink-4)",
          animation: listening ? "pulseDot 1.2s ease-in-out infinite" : "none",
        }}
      />
      {listening ? "Listening… tap to stop" : "Speak answer"}
    </button>
  );
}
