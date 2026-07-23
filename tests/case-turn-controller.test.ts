import { describe, expect, it, vi } from "vitest";
import type { CompleteOpts } from "@/lib/claude";
import {
  CASE_TURN_CONTROLLER_MAX_RETRIES,
  CASE_TURN_CONTROLLER_MAX_TOKENS,
  CASE_TURN_CONTROLLER_MODEL,
  CASE_TURN_CONTROLLER_SCHEMA,
  CASE_TURN_CONTROLLER_TIMEOUT_MS,
  runCaseTurnController,
  warnIfCaseTurnControllerUsesMocks,
  type CaseTurnControllerInput,
} from "@/lib/voice/case-turn-controller";
import {
  caseTurnStabilizationKind,
  deterministicCaseTurnTriage,
  parseCaseTurnControllerDecision,
  validateCaseTurnControllerDecision,
  type CaseTurnControllerDecision,
  type CaseTurnPlanContext,
} from "@/lib/voice/case-turn-plan";

const CONTEXT: CaseTurnPlanContext = {
  caseId: "beautify",
  readinessStatus: "confirmed",
  conversationStatus: "active",
  stage: "clarification",
};

const INPUT: CaseTurnControllerInput = {
  readinessStatus: "confirmed",
  conversationStatus: "active",
  currentStage: "clarification",
  candidateText: "I think I’m ready, but give me another minute.",
  currentInterviewerPrompt: "What would you like to clarify before structuring your approach?",
  recentTurns: [],
  lastProbeObjective: null,
  immediateLegalNextStage: "framework",
  clarificationTopics: ["profitability horizon"],
  caseId: "beautify",
};

function decision(
  overrides: Partial<CaseTurnControllerDecision> = {},
): CaseTurnControllerDecision {
  return {
    intent: "pause",
    targetStage: null,
    shouldEvaluate: false,
    substantiveRemainder: "",
    confidence: 0.98,
    ...overrides,
  };
}

describe("bounded Case turn controller", () => {
  it("warns once per process when the controller is enabled with Claude mocks", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnIfCaseTurnControllerUsesMocks("off", true);
    warnIfCaseTurnControllerUsesMocks("shadow", false);
    warnIfCaseTurnControllerUsesMocks("shadow", true);
    warnIfCaseTurnControllerUsesMocks("hybrid", true);

    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "[case-custom-llm] bounded controller is enabled while Claude mocks are active; ambiguous turns will fail closed",
    );
    warning.mockRestore();
  });

  it("uses the pinned Haiku model and native structured-output request controls", async () => {
    let prompt = "";
    let options: CompleteOpts | undefined;
    const complete = vi.fn(async (candidatePrompt: string, candidateOptions?: CompleteOpts) => {
      prompt = candidatePrompt;
      options = candidateOptions;
      return JSON.stringify(decision());
    });

    const result = await runCaseTurnController(INPUT, complete);

    expect(result).toMatchObject({ outcome: "success", decision: decision() });
    expect(prompt).toContain('"candidateUtterance"');
    expect(options).toMatchObject({
      model: CASE_TURN_CONTROLLER_MODEL,
      temperature: 0,
      maxTokens: CASE_TURN_CONTROLLER_MAX_TOKENS,
      timeoutMs: CASE_TURN_CONTROLLER_TIMEOUT_MS,
      maxRetries: CASE_TURN_CONTROLLER_MAX_RETRIES,
      outputSchema: CASE_TURN_CONTROLLER_SCHEMA,
    });
  });

  it.each([
    ["invalid_json", "not-json"],
    ["invalid_json", `${JSON.stringify(decision())}\nextra prose`],
    ["schema_mismatch", JSON.stringify({ ...decision(), spokenResponse: "No" })],
    ["refusal", "I cannot classify that request."],
  ] as const)("fails closed for %s controller output", async (outcome, output) => {
    const result = await runCaseTurnController(INPUT, async () => output);
    expect(result).toMatchObject({ outcome, decision: null });
  });

  it("reports controller timeouts without retrying", async () => {
    const complete = vi.fn(async () => {
      const error = new Error("Request timed out");
      error.name = "APIConnectionTimeoutError";
      throw error;
    });

    const result = await runCaseTurnController(INPUT, complete);

    expect(result).toMatchObject({ outcome: "timeout", decision: null });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("rejects unknown intents and extra properties", () => {
    expect(parseCaseTurnControllerDecision({ ...decision(), intent: "skip_case" })).toBeNull();
    expect(parseCaseTurnControllerDecision({ ...decision(), score: 5 })).toBeNull();
  });

  it("rejects low confidence, illegal stages, and non-verbatim remainders", () => {
    expect(validateCaseTurnControllerDecision(
      decision({ confidence: 0.84 }),
      INPUT.candidateText,
      CONTEXT,
    )).toMatchObject({ ok: false, reason: "low_confidence" });
    expect(validateCaseTurnControllerDecision(
      decision({ intent: "stage_transition", targetStage: "analysis" }),
      "I want to move forward.",
      CONTEXT,
    )).toMatchObject({ ok: false, reason: "illegal_target_stage" });
    expect(validateCaseTurnControllerDecision(
      decision({
        intent: "stage_transition_with_answer",
        targetStage: "framework",
        shouldEvaluate: true,
        substantiveRemainder: "invented framework wording",
      }),
      "I’m done clarifying. My framework has two branches.",
      CONTEXT,
    )).toMatchObject({ ok: false, reason: "non_verbatim_substantive_remainder" });
  });

  it("derives evaluator use from intent instead of trusting shouldEvaluate", () => {
    const pause = validateCaseTurnControllerDecision(
      decision({ shouldEvaluate: true }),
      INPUT.candidateText,
      CONTEXT,
    );
    const substantiveText = "My framework has external and internal branches";
    const substantive = validateCaseTurnControllerDecision(
      decision({
        intent: "stage_transition_with_answer",
        targetStage: "framework",
        shouldEvaluate: false,
        substantiveRemainder: substantiveText,
      }),
      `I’m done clarifying. ${substantiveText}`,
      CONTEXT,
    );

    expect(pause).toMatchObject({ ok: true, plan: { shouldEvaluate: false } });
    expect(substantive).toMatchObject({
      ok: true,
      plan: { shouldEvaluate: true, evaluationText: substantiveText },
    });
  });

  it("requires deterministic confirmation before accepting end-interview", () => {
    expect(validateCaseTurnControllerDecision(
      decision({ intent: "end_interview" }),
      "Stop the rollout.",
      CONTEXT,
    )).toMatchObject({ ok: false, reason: "unconfirmed_end_intent" });
    expect(validateCaseTurnControllerDecision(
      decision({ intent: "end_interview" }),
      "I want to quit this interview.",
      CONTEXT,
    )).toMatchObject({ ok: true, plan: { intent: "end_interview", shouldEvaluate: false } });
  });

  it("fails safely when the case lacks a supported controller configuration", () => {
    expect(validateCaseTurnControllerDecision(
      decision(),
      INPUT.candidateText,
      { ...CONTEXT, caseId: "unknown" },
    )).toMatchObject({ ok: false, reason: "unsupported_case_configuration" });
  });

  it("does not send a controller-labeled clarification through a later-stage evaluator", () => {
    const text = "What does the virtual advisor model mean?";
    expect(validateCaseTurnControllerDecision(
      decision({
        intent: "clarification_question",
        shouldEvaluate: true,
        substantiveRemainder: text,
      }),
      text,
      { ...CONTEXT, stage: "framework" },
    )).toMatchObject({ ok: false, reason: "clarification_outside_stage" });
  });

  it.each([
    "I think I’m ready, but give me another minute.",
    "I think I’m ready to structure. But give me another minute.",
    "I’m ready to structure, but first give me a moment.",
    "I think I can continue—actually, give me another minute.",
    "Let’s move to the framework, but let me gather my thoughts first.",
    "Can you give me a couple moments? I think I’m ready to structure. But just give me a couple of minutes.",
  ])("requires controller interpretation for mixed clause-order language: %s", (text) => {
    expect(deterministicCaseTurnTriage(text, CONTEXT)).toMatchObject({
      kind: "controller-required",
      reason: "mixed_pause_and_transition",
    });
  });

  it("does not accept a tentative transition prefix as a high-confidence transition", () => {
    expect(deterministicCaseTurnTriage(
      "I think I’m ready to structure.",
      CONTEXT,
    )).toMatchObject({
      kind: "controller-required",
      reason: "tentative_stage_transition",
    });
  });

  it.each([
    "I’m ready to structure my approach.",
    "I think I’m ready to structure.",
    "I’d like to move into the framework.",
    "Let’s continue to the framework.",
  ])("uses the bounded special window for a transition-only prefix: %s", (text) => {
    expect(caseTurnStabilizationKind(text, CONTEXT)).toBe("tentative_stage_transition");
  });

  it("does not extend stabilization for a complete mixed pause or a normal substantive answer", () => {
    expect(caseTurnStabilizationKind(
      "I’m ready to structure my approach, but give me another minute.",
      CONTEXT,
    )).toBe("default");
    expect(caseTurnStabilizationKind(
      "I would assess customer demand, competitors, internal capabilities, and economics.",
      { ...CONTEXT, stage: "framework" },
    )).toBe("default");
  });

  it("extends only affirmative or incomplete readiness prefixes", () => {
    const awaiting = { ...CONTEXT, readinessStatus: "awaiting" as const };
    expect(caseTurnStabilizationKind("Yes.", awaiting)).toBe("tentative_readiness");
    expect(caseTurnStabilizationKind("Uh...", awaiting)).toBe("tentative_readiness");
    expect(caseTurnStabilizationKind("No, not yet.", awaiting)).toBe("default");
    expect(caseTurnStabilizationKind("Yes, but give me another minute.", awaiting)).toBe("default");
  });

  it("keeps clear resume and explicit Framework navigation on deterministic fast paths", () => {
    expect(deterministicCaseTurnTriage("Continue.", {
      ...CONTEXT,
      conversationStatus: "paused",
    })).toMatchObject({
      kind: "resolved",
      plan: { intent: "resume", targetStage: null, shouldEvaluate: false },
    });
    expect(deterministicCaseTurnTriage("I’m ready to answer.", CONTEXT)).toMatchObject({
      kind: "resolved",
      plan: { intent: "readiness_confirmation", targetStage: null, shouldEvaluate: false },
    });
    expect(deterministicCaseTurnTriage("I want to continue to the framework.", CONTEXT)).toMatchObject({
      kind: "resolved",
      plan: { intent: "stage_transition", targetStage: "framework", shouldEvaluate: false },
    });
  });

  it.each([
    "I’m done with clarification.",
    "I would like to move to the framework now.",
    "I’m done with the clarification. I would like to move to the framework now.",
  ])("keeps clear legal Framework navigation on the deterministic path: %s", (text) => {
    expect(deterministicCaseTurnTriage(text, CONTEXT)).toMatchObject({
      kind: "resolved",
      plan: {
        intent: "stage_transition",
        targetStage: "framework",
        shouldEvaluate: false,
      },
    });
  });

  it("keeps explicit end and clear substantive answers deterministic", () => {
    expect(deterministicCaseTurnTriage("Stop the interview.", CONTEXT)).toMatchObject({
      kind: "resolved",
      plan: { intent: "end_interview", shouldEvaluate: false },
    });
    expect(deterministicCaseTurnTriage(
      "I would assess customer demand, competitors, internal capabilities, and economics.",
      { ...CONTEXT, stage: "framework" },
    )).toMatchObject({
      kind: "resolved",
      plan: { intent: "substantive_answer", shouldEvaluate: true },
    });
  });

  it("routes ambiguous control language to the fail-closed path", () => {
    expect(deterministicCaseTurnTriage(
      "Could we change direction for a second?",
      CONTEXT,
    )).toMatchObject({ kind: "controller-required" });
  });
});
