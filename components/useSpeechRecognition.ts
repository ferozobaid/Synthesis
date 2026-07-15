"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Merge a finalised speech chunk onto existing answer text. Inserts a single
 * separating space only when the existing text doesn't already end in
 * whitespace and isn't empty. Pure and browser-independent, so it is unit-
 * tested directly.
 */
export function appendTranscript(existing: string, addition: string): string {
  const cleaned = addition.trim();
  if (!cleaned) return existing;
  if (!existing) return cleaned;
  return /\s$/.test(existing) ? `${existing}${cleaned}` : `${existing} ${cleaned}`;
}

export type SpeechRecognitionStatus =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "stopped"
  | "permission_denied"
  | "unsupported"
  | "no_speech"
  | "recognition_error";

/** Human-friendly, non-technical messages for each failure mode. */
const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed":
    "Microphone access was blocked. Allow it in your browser, or just type your answer.",
  "service-not-allowed":
    "Microphone access was blocked. Allow it in your browser, or just type your answer.",
  "audio-capture":
    "No microphone was found. Please connect one, or type your answer instead.",
  "no-speech": "I didn't catch anything. Try again, or type your answer.",
  network:
    "Voice recognition needs an internet connection and couldn't reach the service. Please type your answer.",
  aborted: "",
  "language-not-supported":
    "Voice input isn't available for this language in your browser. Please type your answer.",
  "bad-grammar": "Something went wrong with voice input. Please type your answer.",
};

const STATUS_MESSAGES: Record<SpeechRecognitionStatus, string | null> = {
  idle: null,
  requesting_permission:
    "Choose Allow in the browser prompt to dictate, or keep typing your answer.",
  listening: null,
  stopped: "Voice input stopped. You can edit the transcript or keep typing.",
  permission_denied:
    "Microphone access was blocked. Allow it in your browser, or type your answer.",
  unsupported: "Voice input is not supported in this browser. Please type your answer.",
  no_speech: "No speech detected. Try again, or type your answer.",
  recognition_error: "Voice input is not working right now. Please type your answer.",
};

export function statusForSpeechError(error: string): SpeechRecognitionStatus {
  if (error === "not-allowed" || error === "service-not-allowed") return "permission_denied";
  if (error === "no-speech") return "no_speech";
  if (error === "aborted") return "stopped";
  return "recognition_error";
}

export function getSpeechStatusMessage(
  status: SpeechRecognitionStatus,
  errorMessage: string | null = null,
): string | null {
  return errorMessage ?? STATUS_MESSAGES[status];
}

export interface UseSpeechRecognition {
  /** True only when the browser exposes the Web Speech API. */
  supported: boolean;
  /** True while actively listening. */
  listening: boolean;
  /** Current recoverable voice-input lifecycle state. */
  status: SpeechRecognitionStatus;
  /** Words recognised so far in the current utterance, not yet finalised. */
  interimTranscript: string;
  /** Friendly error message, or null when there is nothing wrong. */
  error: string | null;
  /** Friendly lifecycle message, including non-error states. */
  message: string | null;
  /** Begin listening. Finalised phrases are handed to `onFinalResult`. */
  start: () => void;
  /** Stop listening. */
  stop: () => void;
}

interface Options {
  /** Called with each finalised chunk of speech (already trimmed, non-empty). */
  onFinalResult: (text: string) => void;
  lang?: string;
}

/**
 * Wraps the browser Web Speech API in a small, safe React surface.
 *
 * Design notes:
 * - Chrome/Edge only in practice; `supported` is false elsewhere and the caller
 *   is expected to fall back to plain text entry.
 * - Finalised results are pushed out via `onFinalResult` so the caller controls
 *   how they merge into existing text (we append, never overwrite).
 * - Interim results are exposed separately for live "listening…" feedback and
 *   are deliberately NOT committed to the answer until finalised.
 * - The recogniser is torn down on unmount to avoid a dangling microphone.
 */
export function useSpeechRecognition({
  onFinalResult,
  lang = "en-US",
}: Options): UseSpeechRecognition {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<SpeechRecognitionStatus>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const runningRef = useRef(false);
  const terminalStatusRef = useRef<SpeechRecognitionStatus | null>(null);
  // Keep the latest callback without forcing recogniser re-creation.
  const onFinalResultRef = useRef(onFinalResult);
  useEffect(() => {
    onFinalResultRef.current = onFinalResult;
  }, [onFinalResult]);

  // Create the recogniser once, on mount, if the browser supports it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      setStatus("unsupported");
      return;
    }
    setSupported(true);
    setStatus("idle");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const cleaned = transcript.trim();
          if (cleaned) onFinalResultRef.current(cleaned);
        } else {
          interim += transcript;
        }
      }
      setInterimTranscript(interim);
    };

    recognition.onstart = () => {
      runningRef.current = true;
      terminalStatusRef.current = null;
      setListening(true);
      setStatus("listening");
      setError(null);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" fires on a normal stop(); it isn't a user-facing error.
      const nextStatus = statusForSpeechError(event.error);
      terminalStatusRef.current = nextStatus;
      runningRef.current = false;
      setListening(false);
      setInterimTranscript("");

      if (nextStatus === "stopped") {
        setStatus("stopped");
        setError(null);
        return;
      }

      setStatus(nextStatus);
      setError(
        ERROR_MESSAGES[event.error] ??
          getSpeechStatusMessage(nextStatus) ??
          "Voice input isn't working right now. Please type your answer.",
      );
    };

    recognition.onend = () => {
      runningRef.current = false;
      setListening(false);
      setInterimTranscript("");
      if (terminalStatusRef.current) {
        terminalStatusRef.current = null;
        return;
      }
      setStatus("stopped");
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped — nothing to clean up */
      }
      runningRef.current = false;
      terminalStatusRef.current = null;
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setStatus("unsupported");
      setError(null);
      return;
    }
    if (runningRef.current) return;

    runningRef.current = true;
    terminalStatusRef.current = null;
    setError(null);
    setStatus("requesting_permission");
    setInterimTranscript("");
    try {
      recognition.start();
    } catch {
      runningRef.current = false;
      setListening(false);
      setStatus("recognition_error");
      setError("Voice input couldn't start. Please type your answer.");
    }
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || !runningRef.current) return;
    terminalStatusRef.current = null;
    try {
      recognition.stop();
    } catch {
      /* not started — nothing to stop */
    }
    runningRef.current = false;
    setListening(false);
    setStatus("stopped");
    setError(null);
    setInterimTranscript("");
  }, []);

  return {
    supported,
    listening,
    status,
    interimTranscript,
    error,
    message: getSpeechStatusMessage(status, error),
    start,
    stop,
  };
}
