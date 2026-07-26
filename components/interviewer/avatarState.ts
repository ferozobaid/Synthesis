/**
 * Pure state model for the shared interviewer avatar.
 *
 * No React or DOM imports: everything here is unit-testable under the
 * node-environment vitest setup. The voice status unions are structural
 * copies of the unions exported by `components/VoiceInterview.tsx` and
 * `components/CaseVoiceInterview.tsx` — call-site inference in those
 * components keeps the copies honest at compile time without coupling
 * this module to their browser-heavy internals.
 */

export type AvatarMode =
  | "ready"
  | "connecting"
  | "speaking"
  | "userSpeaking"
  | "listening"
  | "processing"
  | "muted"
  | "paused"
  | "complete"
  | "disconnected";

export const AVATAR_MODES: readonly AvatarMode[] = [
  "ready",
  "connecting",
  "speaking",
  "userSpeaking",
  "listening",
  "processing",
  "muted",
  "paused",
  "complete",
  "disconnected",
];

/** Structural copy of `VoiceStatus` from components/VoiceInterview.tsx. */
export type BehaviouralVoiceStatusLike =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "processing"
  | "done"
  | "timeout"
  | "failed"
  | "error";

/** Structural copy of `CaseVoiceStatus` from components/CaseVoiceInterview.tsx. */
export type CaseVoiceStatusLike =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "recovering"
  | "ended"
  | "completed"
  | "expired"
  | "error";

/**
 * Behavioural voice → avatar mode.
 * Precedence: terminal states > assistant speech > muted > user speech.
 * Mute only overrides "listening": while the interviewer is speaking the
 * avatar keeps narrating the interviewer; the mute button carries the state.
 */
export function mapVoiceStatusToAvatarMode(
  status: BehaviouralVoiceStatusLike,
  muted: boolean,
  userSpeaking: boolean,
): AvatarMode {
  switch (status) {
    case "idle":
      return "ready";
    case "connecting":
      return "connecting";
    case "speaking":
      return "speaking";
    case "processing":
      return "processing";
    case "done":
      return "complete";
    case "timeout":
    case "failed":
    case "error":
      return "disconnected";
    case "listening":
      if (muted) return "muted";
      if (userSpeaking) return "userSpeaking";
      return "listening";
  }
}

export interface CaseAvatarInput {
  status: CaseVoiceStatusLike;
  muted: boolean;
  userSpeaking: boolean;
  /** Backend projection: "paused" when the interviewer parked the session. */
  conversationStatus?: "active" | "paused";
  /** Backend projection: "concluded_unscored" once the session concluded. */
  liveStatus?: "active" | "concluded_unscored";
}

/**
 * Case voice → avatar mode. A user-initiated "ended" call is a completed
 * session, not a failure; only "expired"/"error" read as disconnected.
 */
export function mapCaseVoiceToAvatarMode(input: CaseAvatarInput): AvatarMode {
  const { status, muted, userSpeaking, conversationStatus, liveStatus } = input;
  switch (status) {
    case "idle":
      return "ready";
    case "connecting":
      return "connecting";
    case "recovering":
      return "processing";
    case "completed":
    case "ended":
      return "complete";
    case "expired":
    case "error":
      return "disconnected";
    case "speaking":
    case "listening": {
      if (liveStatus === "concluded_unscored") return "complete";
      if (conversationStatus === "paused") return "paused";
      if (status === "speaking") return "speaking";
      if (muted) return "muted";
      if (userSpeaking) return "userSpeaking";
      return "listening";
    }
  }
}

export interface AvatarModeMeta {
  /** Monitor label shown on the CRT screen. */
  label: string;
  /** Stage caption strong text. */
  caption: string;
  /** Whether the status dot should read as live (pulsing). */
  live: boolean;
  /** Sentence for the aria-live announcer; "" means never announce. */
  announce: string;
}

export const AVATAR_MODE_META: Record<AvatarMode, AvatarModeMeta> = {
  ready: {
    label: "Interviewer ready",
    caption: "Ready when you are",
    live: false,
    announce: "",
  },
  connecting: {
    label: "Connecting",
    caption: "Connecting you now",
    live: false,
    announce: "Connecting to your interviewer.",
  },
  speaking: {
    label: "Interviewer speaking",
    caption: "Interviewer speaking",
    live: true,
    announce: "The interviewer is speaking.",
  },
  userSpeaking: {
    label: "Hearing you",
    caption: "We hear you",
    live: true,
    announce: "",
  },
  listening: {
    label: "Listening",
    caption: "Listening now",
    live: true,
    announce: "",
  },
  processing: {
    label: "Thinking",
    caption: "Working on it",
    live: true,
    announce: "Processing your interview.",
  },
  muted: {
    label: "Mic muted",
    caption: "Microphone muted",
    live: false,
    announce: "Your microphone is muted.",
  },
  paused: {
    label: "Paused",
    caption: "Session paused",
    live: false,
    announce: "The interview is paused.",
  },
  complete: {
    label: "Session complete",
    caption: "Session complete",
    live: false,
    announce: "The interview session is complete.",
  },
  disconnected: {
    label: "Connection lost",
    caption: "Connection lost",
    live: false,
    announce: "The interview connection was lost.",
  },
};

/** Clamp a raw audio level into [0, 1] and quantize it to coarse steps. */
export function quantizeLevel(level: number, step = 0.05): number {
  if (!Number.isFinite(level)) return 0;
  const clamped = Math.min(1, Math.max(0, level));
  return Math.round(clamped / step) * step;
}

/** Publish only when the quantized level actually moved. */
export function shouldPublishLevel(prev: number, next: number, step = 0.05): boolean {
  return quantizeLevel(prev, step) !== quantizeLevel(next, step);
}

export interface UserSpeakingTrackerOptions {
  /** Level at or above which a sample counts as speech. */
  enterThreshold?: number;
  /** Consecutive speech samples required before entering "speaking". */
  enterFrames?: number;
  /** Silence duration (ms) before leaving "speaking". */
  exitMs?: number;
}

export interface UserSpeakingTracker {
  /** Feed one volume sample; returns the current speaking flag. */
  sample(level: number, nowMs: number): boolean;
  reset(): void;
}

/**
 * Hysteresis so the avatar does not flicker between "listening" and
 * "hearing you": speech requires a couple of loud samples in a row to
 * enter, and only decays after a sustained quiet window.
 */
export function createUserSpeakingTracker(
  options: UserSpeakingTrackerOptions = {},
): UserSpeakingTracker {
  const enterThreshold = options.enterThreshold ?? 0.12;
  const enterFrames = options.enterFrames ?? 2;
  const exitMs = options.exitMs ?? 600;

  let speaking = false;
  let loudStreak = 0;
  let lastLoudAt = -Infinity;

  return {
    sample(level: number, nowMs: number): boolean {
      const loud = quantizeLevel(level, 0.01) >= enterThreshold;
      if (loud) {
        loudStreak += 1;
        lastLoudAt = nowMs;
        if (!speaking && loudStreak >= enterFrames) speaking = true;
      } else {
        loudStreak = 0;
        if (speaking && nowMs - lastLoudAt >= exitMs) speaking = false;
      }
      return speaking;
    },
    reset() {
      speaking = false;
      loudStreak = 0;
      lastLoudAt = -Infinity;
    },
  };
}
