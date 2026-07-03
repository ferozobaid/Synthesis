import { describe, it, expect } from "vitest";
import { appendTranscript } from "@/components/useSpeechRecognition";

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
});
