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
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
        listening
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-slate-300 text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          listening ? "animate-pulse bg-red-500" : "bg-slate-400"
        }`}
      />
      {listening ? "Listening… tap to stop" : "Speak answer"}
    </button>
  );
}
