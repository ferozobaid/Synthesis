import { describe, expect, it } from "vitest";
import {
  candidateRevisionRelation,
  isReadinessOnlyConfirmation,
  isCandidateRevision,
  readinessDisposition,
} from "@/lib/voice/case-turn-sync";

describe("Case voice candidate turn synchronization", () => {
  it("recognizes a strict-superset transcript as a revision without message IDs", () => {
    const relation = candidateRevisionRelation(
      "I have three clarifying questions.",
      "I have three clarifying questions. What time horizon should we use?",
    );

    expect(relation).toBe("new-superset");
    expect(isCandidateRevision(relation)).toBe(true);
  });

  it("recognizes an in-place self-correction as the same evolving utterance", () => {
    const relation = candidateRevisionRelation(
      "I have three clarifying questions about what factors Beautify should consider.",
      "I have three clarifying questions. No, actually, cut that. What time horizon should we use?",
    );

    expect(relation).toBe("correction");
    expect(isCandidateRevision(relation)).toBe(true);
  });

  it("does not treat unrelated answers as revisions", () => {
    expect(candidateRevisionRelation(
      "What time horizon should we use?",
      "I would structure the problem around customers, competitors, capabilities, and economics.",
    )).toBe("none");
  });

  it("accepts natural readiness confirmations but keeps negative responses waiting", () => {
    expect(readinessDisposition("Ready")).toBe("ready");
    expect(readinessDisposition("Yes, I’m ready")).toBe("ready");
    expect(readinessDisposition("Let's begin")).toBe("ready");
    expect(readinessDisposition("Not yet, give me a moment")).toBe("not-ready");
    expect(isReadinessOnlyConfirmation("Yes, I’m ready")).toBe(true);
    expect(isReadinessOnlyConfirmation("Yes, I’m ready. What is the time horizon?")).toBe(false);
  });
});
