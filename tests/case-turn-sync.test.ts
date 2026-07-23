import { describe, expect, it } from "vitest";
import {
  candidateRevisionRelation,
  isReadinessOnlyConfirmation,
  isCandidateRevision,
  readinessDisposition,
  readinessSignal,
} from "@/lib/voice/case-turn-sync";
import {
  classifyCaseCandidateIntent,
  routeCaseCandidateTurn,
} from "@/lib/voice/case-intent";
import { assessCaseFramework } from "@/lib/fsm/case-framework";
import beautify from "@/context/cases/beautify.json";
import type { CaseRecord } from "@/lib/types";

const beautifyCase = beautify as unknown as CaseRecord;

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
    expect(readinessDisposition("Yes.")).toBe("ready");
    expect(readinessDisposition("Yeah.")).toBe("ready");
    expect(readinessDisposition("Yep.")).toBe("ready");
    expect(readinessDisposition("Sure.")).toBe("ready");
    expect(readinessDisposition("Ready")).toBe("ready");
    expect(readinessDisposition("Yes, I’m ready")).toBe("ready");
    expect(readinessDisposition("Let's begin")).toBe("ready");
    expect(readinessDisposition("I’m ready now")).toBe("ready");
    expect(readinessDisposition("Yes, ready")).toBe("ready");
    expect(readinessDisposition("We can start")).toBe("ready");
    expect(readinessDisposition("Go ahead")).toBe("ready");
    expect(readinessDisposition("Uh, yes, I’m ready now.")).toBe("ready");
    expect(readinessDisposition("No, not yet.")).toBe("not-ready");
    expect(readinessDisposition("Yes, but give me another minute.")).toBe("not-ready");
    expect(readinessDisposition("Not yet, give me a moment")).toBe("not-ready");
    expect(readinessSignal("Yes.")).toBe("affirmative");
    expect(readinessSignal("No, not yet.")).toBe("negative");
    expect(readinessSignal("Yes, but give me another minute.")).toBe("mixed");
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
    expect(assessCaseFramework(
      beautifyCase,
      "I would assess Beautify's internal capability.",
    ).coveredConcepts).toContain("people-training");
    expect(assessCaseFramework(
      beautifyCase,
      "I would assess Beautify's internal capabilities.",
    ).coveredConcepts).toContain("people-training");
  });

  it.each([
    "I’m ready to structure. I would look at external demand, internal capabilities, and economics.",
    "Let’s continue. My approach has three parts: external demand, internal feasibility, and financial viability.",
    "I’m ready now; first I would analyze external demand, then internal technology and training, and finally payback.",
  ])("routes compound transition content into Framework evaluation: %s", (answer) => {
    const routed = routeCaseCandidateTurn(answer, {
      readinessStatus: "confirmed",
      conversationStatus: "active",
      stage: "clarification",
    });

    expect(routed.compoundTransition).toBe(true);
    expect(routed.transitionTo).toBe("framework");
    expect(routed.intent).toBe("substantive-case-answer");
    expect(routed.evaluationText).not.toMatch(/ready|let(?:'|’)s continue/i);
  });

  it.each([
    "I’m ready to structure my approach",
    "I think I’m ready to outline the framework",
    "I’d like to walk through my framework",
  ])("routes a transition-only phrase to Framework without evaluator text: %s", (answer) => {
    const routed = routeCaseCandidateTurn(answer, {
      readinessStatus: "confirmed",
      conversationStatus: "active",
      stage: "clarification",
    });

    expect(routed).toMatchObject({
      intent: "stage-transition-request",
      evaluationText: "",
      transitionTo: "framework",
      compoundTransition: false,
    });
  });

  it("leaves a substantive answer without a transition phrase unchanged", () => {
    const answer = "My approach has external, internal and financial branches.";
    const routed = routeCaseCandidateTurn(answer, {
      readinessStatus: "confirmed",
      conversationStatus: "active",
      stage: "framework",
    });

    expect(routed).toMatchObject({
      intent: "substantive-case-answer",
      evaluationText: answer,
      transitionTo: null,
      compoundTransition: false,
    });
  });

  it("resumes a paused conversation without advancing the stage", () => {
    const routed = routeCaseCandidateTurn("I’m ready to continue", {
      readinessStatus: "confirmed",
      conversationStatus: "paused",
      stage: "clarification",
    });

    expect(routed.intent).toBe("readiness-confirmation");
    expect(routed.transitionTo).toBeNull();
  });

  it.each([
    "Continue.",
    "I’m ready to answer.",
    "I will continue with my answer.",
  ])("treats a clear resume command as conversational rather than stage navigation: %s", (answer) => {
    const routed = routeCaseCandidateTurn(answer, {
      readinessStatus: "confirmed",
      conversationStatus: "paused",
      stage: "clarification",
    });

    expect(routed.intent).toBe("readiness-confirmation");
    expect(routed.transitionTo).toBeNull();
  });

  it.each([
    "Move to the framework.",
    "I want to continue to the framework.",
    "Let’s continue to the framework.",
  ])("keeps explicit Clarification-to-Framework navigation deterministic: %s", (answer) => {
    const routed = routeCaseCandidateTurn(answer, {
      readinessStatus: "confirmed",
      conversationStatus: "active",
      stage: "clarification",
    });

    expect(routed.intent).toBe("stage-transition-request");
    expect(routed.transitionTo).toBe("framework");
  });

  it("distinguishes frustration from explicit end intent", () => {
    const context = {
      readinessStatus: "confirmed" as const,
      conversationStatus: "active" as const,
      stage: "framework" as const,
    };

    expect(classifyCaseCandidateIntent("I already answered that", context)).toBe("frustration");
    expect(classifyCaseCandidateIntent("I gave you those points", context)).toBe("frustration");
    expect(classifyCaseCandidateIntent("You’re asking the same thing again", context)).toBe("frustration");
    expect(classifyCaseCandidateIntent(
      "I don’t understand why you keep repeating it",
      context,
    )).toBe("frustration");
    expect(classifyCaseCandidateIntent("End the interview", context)).toBe("end-interview");
    expect(classifyCaseCandidateIntent("I want to quit", context)).toBe("end-interview");
    expect(classifyCaseCandidateIntent("Finish the session", context)).toBe("end-interview");
    expect(classifyCaseCandidateIntent(
      "A downside risk might make us stop the rollout after the pilot.",
      context,
    )).toBe("substantive-case-answer");
  });
});
