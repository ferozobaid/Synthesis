import { describe, expect, it } from "vitest";
import {
  AVATAR_MODES,
  AVATAR_MODE_META,
  createUserSpeakingTracker,
  mapCaseVoiceToAvatarMode,
  mapVoiceStatusToAvatarMode,
  quantizeLevel,
  shouldPublishLevel,
  type AvatarMode,
  type BehaviouralVoiceStatusLike,
  type CaseVoiceStatusLike,
} from "@/components/interviewer/avatarState";

const BEHAVIOURAL_STATUSES: BehaviouralVoiceStatusLike[] = [
  "idle",
  "connecting",
  "listening",
  "speaking",
  "processing",
  "done",
  "timeout",
  "failed",
  "error",
];

const CASE_STATUSES: CaseVoiceStatusLike[] = [
  "idle",
  "connecting",
  "listening",
  "speaking",
  "recovering",
  "ended",
  "completed",
  "expired",
  "error",
];

describe("mapVoiceStatusToAvatarMode (behavioural)", () => {
  it("maps every status for the quiet unmuted path", () => {
    const expected: Record<BehaviouralVoiceStatusLike, AvatarMode> = {
      idle: "ready",
      connecting: "connecting",
      listening: "listening",
      speaking: "speaking",
      processing: "processing",
      done: "complete",
      timeout: "disconnected",
      failed: "disconnected",
      error: "disconnected",
    };
    for (const status of BEHAVIOURAL_STATUSES) {
      expect(mapVoiceStatusToAvatarMode(status, false, false)).toBe(expected[status]);
    }
  });

  it("shows muted only while listening", () => {
    expect(mapVoiceStatusToAvatarMode("listening", true, false)).toBe("muted");
    expect(mapVoiceStatusToAvatarMode("listening", true, true)).toBe("muted");
    // Assistant speech and terminal states outrank mute.
    expect(mapVoiceStatusToAvatarMode("speaking", true, false)).toBe("speaking");
    expect(mapVoiceStatusToAvatarMode("processing", true, false)).toBe("processing");
    expect(mapVoiceStatusToAvatarMode("done", true, false)).toBe("complete");
    expect(mapVoiceStatusToAvatarMode("error", true, true)).toBe("disconnected");
  });

  it("shows userSpeaking only while listening and unmuted", () => {
    expect(mapVoiceStatusToAvatarMode("listening", false, true)).toBe("userSpeaking");
    expect(mapVoiceStatusToAvatarMode("speaking", false, true)).toBe("speaking");
    expect(mapVoiceStatusToAvatarMode("idle", false, true)).toBe("ready");
  });
});

describe("mapCaseVoiceToAvatarMode", () => {
  const base = { muted: false, userSpeaking: false } as const;

  it("maps every status for the active unmuted path", () => {
    const expected: Record<CaseVoiceStatusLike, AvatarMode> = {
      idle: "ready",
      connecting: "connecting",
      listening: "listening",
      speaking: "speaking",
      recovering: "processing",
      ended: "complete",
      completed: "complete",
      expired: "disconnected",
      error: "disconnected",
    };
    for (const status of CASE_STATUSES) {
      expect(mapCaseVoiceToAvatarMode({ ...base, status })).toBe(expected[status]);
    }
  });

  it("projection pause overrides both listening and speaking", () => {
    expect(
      mapCaseVoiceToAvatarMode({ ...base, status: "listening", conversationStatus: "paused" }),
    ).toBe("paused");
    expect(
      mapCaseVoiceToAvatarMode({ ...base, status: "speaking", conversationStatus: "paused" }),
    ).toBe("paused");
    // Pause outranks mute and user speech.
    expect(
      mapCaseVoiceToAvatarMode({
        status: "listening",
        muted: true,
        userSpeaking: true,
        conversationStatus: "paused",
      }),
    ).toBe("paused");
  });

  it("concluded_unscored reads as complete even mid-call", () => {
    expect(
      mapCaseVoiceToAvatarMode({ ...base, status: "listening", liveStatus: "concluded_unscored" }),
    ).toBe("complete");
    expect(
      mapCaseVoiceToAvatarMode({
        ...base,
        status: "speaking",
        conversationStatus: "paused",
        liveStatus: "concluded_unscored",
      }),
    ).toBe("complete");
  });

  it("applies mute and userSpeaking only while listening", () => {
    expect(mapCaseVoiceToAvatarMode({ ...base, status: "listening", muted: true })).toBe("muted");
    expect(
      mapCaseVoiceToAvatarMode({ ...base, status: "listening", userSpeaking: true }),
    ).toBe("userSpeaking");
    expect(
      mapCaseVoiceToAvatarMode({ status: "listening", muted: true, userSpeaking: true }),
    ).toBe("muted");
    expect(mapCaseVoiceToAvatarMode({ ...base, status: "speaking", muted: true })).toBe("speaking");
    expect(mapCaseVoiceToAvatarMode({ status: "ended", muted: true, userSpeaking: true })).toBe(
      "complete",
    );
  });
});

describe("AVATAR_MODE_META", () => {
  it("covers every mode with a label and caption", () => {
    expect(Object.keys(AVATAR_MODE_META).sort()).toEqual([...AVATAR_MODES].sort());
    for (const mode of AVATAR_MODES) {
      expect(AVATAR_MODE_META[mode].label.length).toBeGreaterThan(0);
      expect(AVATAR_MODE_META[mode].caption.length).toBeGreaterThan(0);
    }
  });

  it("never announces the high-churn conversational modes", () => {
    expect(AVATAR_MODE_META.listening.announce).toBe("");
    expect(AVATAR_MODE_META.userSpeaking.announce).toBe("");
    expect(AVATAR_MODE_META.ready.announce).toBe("");
    // The state changes a screen-reader user cannot see must announce.
    for (const mode of ["muted", "paused", "complete", "disconnected"] as const) {
      expect(AVATAR_MODE_META[mode].announce.length).toBeGreaterThan(0);
    }
  });
});

describe("quantizeLevel / shouldPublishLevel", () => {
  it("clamps and quantizes", () => {
    expect(quantizeLevel(-1)).toBe(0);
    expect(quantizeLevel(2)).toBe(1);
    expect(quantizeLevel(Number.NaN)).toBe(0);
    expect(quantizeLevel(0.5)).toBe(0.5);
    expect(quantizeLevel(0.52)).toBe(0.5);
    expect(quantizeLevel(0.53)).toBeCloseTo(0.55);
  });

  it("publishes only when the quantized value moves", () => {
    expect(shouldPublishLevel(0.5, 0.52)).toBe(false);
    expect(shouldPublishLevel(0.5, 0.58)).toBe(true);
    expect(shouldPublishLevel(0, 0.01)).toBe(false);
    expect(shouldPublishLevel(0, 0.04)).toBe(true);
  });
});

describe("createUserSpeakingTracker", () => {
  it("requires consecutive loud samples to enter", () => {
    const tracker = createUserSpeakingTracker();
    expect(tracker.sample(0.5, 0)).toBe(false);
    expect(tracker.sample(0.05, 120)).toBe(false); // streak broken
    expect(tracker.sample(0.5, 240)).toBe(false);
    expect(tracker.sample(0.5, 360)).toBe(true); // second consecutive loud sample
  });

  it("holds through brief dips and exits after sustained silence", () => {
    const tracker = createUserSpeakingTracker();
    tracker.sample(0.4, 0);
    tracker.sample(0.4, 120);
    expect(tracker.sample(0.02, 300)).toBe(true); // short dip: still speaking
    expect(tracker.sample(0.02, 500)).toBe(true);
    expect(tracker.sample(0.02, 800)).toBe(false); // ≥600ms of quiet
  });

  it("ignores sub-threshold noise", () => {
    const tracker = createUserSpeakingTracker();
    for (let i = 0; i < 10; i++) {
      expect(tracker.sample(0.08, i * 120)).toBe(false);
    }
  });

  it("resets cleanly", () => {
    const tracker = createUserSpeakingTracker();
    tracker.sample(0.5, 0);
    tracker.sample(0.5, 120);
    expect(tracker.sample(0.5, 240)).toBe(true);
    tracker.reset();
    expect(tracker.sample(0.5, 360)).toBe(false);
  });
});
