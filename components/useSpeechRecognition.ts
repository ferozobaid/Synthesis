"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Merge a finalised speech chunk onto existing answer text. Inserts a single
 * separating space only when the existing text doesn't already end in
 * whitespace and isn't empty. Pure and browser-independent, so it is unit-
 * tested directly.
 */
export function appendTranscript(existing: string, addition: string): string {
  if (!existing) return addition;
  return /\s$/.test(existing) ? `${existing}${addition}` : `${existing} ${addition}`;
}

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

export interface UseSpeechRecognition {
  /** True only when the browser exposes the Web Speech API. */
  supported: boolean;
  /** True while actively listening. */
  listening: boolean;
  /** Words recognised so far in the current utterance, not yet finalised. */
  interimTranscript: string;
  /** Friendly error message, or null when there is nothing wrong. */
  error: string | null;
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
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
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
      return;
    }
    setSupported(true);

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

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" fires on a normal stop(); it isn't a user-facing error.
      if (event.error !== "aborted") {
        setError(ERROR_MESSAGES[event.error] ?? "Voice input isn't working right now. Please type your answer.");
      }
      setListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
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
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || listening) return;
    setError(null);
    setInterimTranscript("");
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if called while already started; treat as a no-op.
    }
  }, [listening]);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* not started — nothing to stop */
    }
    setListening(false);
    setInterimTranscript("");
  }, []);

  return { supported, listening, interimTranscript, error, start, stop };
}
