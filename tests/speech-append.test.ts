import { describe, it, expect } from "vitest";
import {
  appendTranscript,
  getSpeechStatusMessage,
  statusForSpeechError,
} from "@/components/useSpeechRecognition";

describe("appendTranscript — merging dictated speech into existing text", () => {
  it("returns the addition unchanged when there is no existing text", () => {
    expect(appendTranscript("", "hello world")).toBe("hello world");
  });

  it("inserts a single space when existing text does not end in whitespace", () => {
    expect(appendTranscript("I led the team", "and we shipped it")).toBe(
      "I led the team and we shipped it",
    );
  });

  it("does not add a second space when existing text already ends in whitespace", () => {
    expect(appendTranscript("I typed this ", "then spoke this")).toBe(
      "I typed this then spoke this",
    );
  });

  it("handles a trailing newline as existing whitespace", () => {
    expect(appendTranscript("first line\n", "second part")).toBe("first line\nsecond part");
  });

  it("trims dictated chunks before appending them", () => {
    expect(appendTranscript("I owned the launch", "  and measured adoption  ")).toBe(
      "I owned the launch and measured adoption",
    );
  });

  it("ignores empty dictated chunks without changing typed text", () => {
    expect(appendTranscript("typed draft", "   ")).toBe("typed draft");
  });
});

describe("speech recognition recoverable states", () => {
  it("classifies denied microphone permission separately", () => {
    expect(statusForSpeechError("not-allowed")).toBe("permission_denied");
    expect(statusForSpeechError("service-not-allowed")).toBe("permission_denied");
  });

  it("classifies no-speech separately from generic recognition errors", () => {
    expect(statusForSpeechError("no-speech")).toBe("no_speech");
    expect(statusForSpeechError("network")).toBe("recognition_error");
  });

  it("treats aborted recognition as stopped instead of an error", () => {
    expect(statusForSpeechError("aborted")).toBe("stopped");
    expect(getSpeechStatusMessage("stopped")).toContain("stopped");
  });

  it("surfaces the permission-requested state as recoverable copy", () => {
    expect(getSpeechStatusMessage("requesting_permission")).toContain("Allow");
  });
});
