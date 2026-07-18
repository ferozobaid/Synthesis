import { describe, expect, it } from "vitest";
import {
  candidateRevisionRelation,
  isReadinessOnlyConfirmation,
  isCandidateRevision,
  readinessDisposition,
} from "@/lib/voice/case-turn-sync";
import { classifyCaseCandidateIntent } from "@/lib/voice/case-intent";
import { frameworkCoverage } from "@/lib/voice/case-conversation";

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
    expect(readinessDisposition("I’m ready now")).toBe("ready");
    expect(readinessDisposition("Yes, ready")).toBe("ready");
    expect(readinessDisposition("We can start")).toBe("ready");
    expect(readinessDisposition("Go ahead")).toBe("ready");
    expect(readinessDisposition("Not yet, give me a moment")).toBe("not-ready");
    expect(isReadinessOnlyConfirmation("Yes, I’m ready")).toBe(true);
    expect(isReadinessOnlyConfirmation("Yes, I’m ready. What is the time horizon?")).toBe(false);
  });

  it("classifies conversational meta-turns before the Case evaluator", () => {
    const context = {
      readinessStatus: "confirmed" as const,
      conversationStatus: "active" as const,
      stage: "framework" as const,
    };

    expect(classifyCaseCandidateIntent("Can I gather my thoughts for a moment?", context))
      .toBe("thinking-pause-request");
    expect(classifyCaseCandidateIntent("I’m still gathering my thoughts.", context))
      .toBe("thinking-pause-request");
    expect(classifyCaseCandidateIntent("Could you repeat the question?", context))
      .toBe("repeat-question-request");
    expect(classifyCaseCandidateIntent("What do you mean?", context))
      .toBe("repeat-question-request");
    expect(classifyCaseCandidateIntent("I’m ready to continue.", context))
      .toBe("readiness-confirmation");
    expect(classifyCaseCandidateIntent(
      "I would structure this around demand, economics, competition, and implementation risk.",
      context,
    )).toBe("substantive-case-answer");
    expect(classifyCaseCandidateIntent(
      "I think about demand, economics, competition, and implementation risk.",
      context,
    )).toBe("substantive-case-answer");
    expect(classifyCaseCandidateIntent(
      "Let me rephrase: I would structure this around demand and economics.",
      context,
    )).toBe("self-correction-revision");
  });

  it("keeps a specific meaning question in the Clarification evaluator path", () => {
    expect(classifyCaseCandidateIntent("What do you mean by virtual advisors?", {
      readinessStatus: "confirmed",
      conversationStatus: "active",
      stage: "clarification",
    })).toBe("clarification-question");
  });

  it("recognizes singular and plural internal capability branches", () => {
    expect(frameworkCoverage("I would assess Beautify's internal capability.").internalCapabilities)
      .toBe(true);
    expect(frameworkCoverage("I would assess Beautify's internal capabilities.").internalCapabilities)
      .toBe(true);
  });
});
