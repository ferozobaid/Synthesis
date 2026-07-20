import { nextState } from "@/lib/fsm/case-fsm";
import type { CaseState } from "@/lib/types";
import {
  isExplicitEndRequest,
  routeCaseCandidateTurn,
  type CaseIntentContext,
} from "@/lib/voice/case-intent";
import { normalizeCandidateText } from "@/lib/voice/case-turn-sync";

export const CASE_TURN_CONTROLLER_INTENTS = [
  "readiness_confirmation",
  "not_ready",
  "pause",
  "resume",
  "repeat",
  "stage_transition",
  "stage_transition_with_answer",
  "clarification_question",
  "substantive_answer",
  "self_correction",
  "frustration",
  "off_topic_or_confused",
  "end_interview",
  "ambiguous",
] as const;

export type CaseTurnControllerIntent = (typeof CASE_TURN_CONTROLLER_INTENTS)[number];
export type CaseVoiceControllerMode = "off" | "shadow" | "hybrid";
export const CASE_VOICE_CONTROLLER_VERSION = "v1";

export interface CaseTurnControllerDecision {
  intent: CaseTurnControllerIntent;
  targetStage: CaseState | null;
  shouldEvaluate: boolean;
  substantiveRemainder: string;
  confidence: number;
}

export interface CaseTurnPlanContext extends CaseIntentContext {
  caseId: string;
}

export interface ValidatedCaseTurnPlan {
  intent: CaseTurnControllerIntent;
  targetStage: CaseState | null;
  shouldEvaluate: boolean;
  evaluationText: string;
  confidence: number;
  source: "deterministic" | "controller" | "fallback";
}

export type DeterministicCaseTurnTriage =
  | { kind: "resolved"; reason: string; plan: ValidatedCaseTurnPlan }
  | { kind: "controller-required"; reason: string };

export type ControllerValidationResult =
  | { ok: true; plan: ValidatedCaseTurnPlan }
  | { ok: false; reason: string };

export const CASE_TURN_AMBIGUITY_RESPONSE =
  "I may have misunderstood. Would you like a moment, a repeat of the question, or to continue with your answer?";

const CONTROLLER_CONFIDENCE_THRESHOLD = 0.85;
const CONTROLLER_KEYS = [
  "intent",
  "targetStage",
  "shouldEvaluate",
  "substantiveRemainder",
  "confidence",
] as const;

const CLARIFICATION_TOPICS: Record<string, string[]> = {
  beautify: [
    "profitability horizon",
    "brands and markets in scope",
    "technology, training, and operating cost ownership",
    "meaning of the virtual-advisor model",
    "facts not specified by the authored case",
  ],
  diconsa: [
    "financial services in scope",
    "success measures for savings, inclusion, and security",
    "Diconsa and bank operational capacity",
    "facts not specified by the authored case",
  ],
};

const PAUSE_CUE =
  /\b(?:pause|wait|hold on|take (?:a|another|some|one|a couple(?: of)?|couple(?: of)?|a few) (?:moments?|minutes?|seconds?)|give me (?:a|another|some|one|a couple(?: of)?|couple(?: of)?|a few) (?:moments?|minutes?|seconds?)|gather(?:ing)? my thoughts?|collect(?:ing)? my thoughts?|let me think|still thinking)\b/i;
const TRANSITION_CUE =
  /\b(?:ready|continue|move|moving|get into|go into|framework|structur(?:e|ing)|done (?:with )?clarif|finished (?:with )?clarif)\b/i;
function isCaseState(value: unknown): value is CaseState {
  return [
    "intro",
    "clarification",
    "framework",
    "analysis",
    "data_reveal",
    "pressure_test",
    "recommendation",
    "scoring",
  ].includes(String(value));
}

function evaluatedIntent(intent: CaseTurnControllerIntent): boolean {
  return (
    intent === "stage_transition_with_answer" ||
    intent === "substantive_answer" ||
    intent === "self_correction" ||
    intent === "clarification_question"
  );
}

function hasMixedControlLanguage(text: string): boolean {
  return PAUSE_CUE.test(text) && TRANSITION_CUE.test(text);
}

function deterministicPlan(
  intent: CaseTurnControllerIntent,
  evaluationText: string,
  targetStage: CaseState | null,
): ValidatedCaseTurnPlan {
  return {
    intent,
    targetStage,
    shouldEvaluate: evaluatedIntent(intent),
    evaluationText,
    confidence: 1,
    source: "deterministic",
  };
}

export function caseVoiceControllerMode(): CaseVoiceControllerMode {
  const configured = process.env.CASE_VOICE_CONTROLLER_MODE?.trim().toLowerCase();
  return configured === "shadow" || configured === "hybrid" ? configured : "off";
}

export function authorizedCaseClarificationTopics(caseId: string): string[] | null {
  const topics = CLARIFICATION_TOPICS[caseId];
  return topics ? [...topics] : null;
}

export function safeAmbiguityPlan(): ValidatedCaseTurnPlan {
  return {
    intent: "ambiguous",
    targetStage: null,
    shouldEvaluate: false,
    evaluationText: "",
    confidence: 0,
    source: "fallback",
  };
}

export function deterministicCaseTurnTriage(
  text: string,
  context: CaseTurnPlanContext,
): DeterministicCaseTurnTriage {
  if (context.readinessStatus === "confirmed" && hasMixedControlLanguage(text)) {
    return { kind: "controller-required", reason: "mixed_pause_and_transition" };
  }

  const routed = routeCaseCandidateTurn(text, context);
  if (routed.intent === "ambiguous") {
    return { kind: "controller-required", reason: "ambiguous_language" };
  }
  if (routed.intent === "self-correction-revision") {
    return { kind: "controller-required", reason: "uncertain_correction" };
  }

  if (routed.compoundTransition && routed.transitionTo) {
    return {
      kind: "resolved",
      reason: "known_compound_transition",
      plan: deterministicPlan(
        "stage_transition_with_answer",
        routed.evaluationText,
        routed.transitionTo,
      ),
    };
  }

  const mapped: Record<Exclude<typeof routed.intent, "ambiguous" | "self-correction-revision">, CaseTurnControllerIntent> = {
    "readiness-confirmation": context.conversationStatus === "paused" ? "resume" : "readiness_confirmation",
    "not-ready": context.readinessStatus === "awaiting" ? "not_ready" : "pause",
    "thinking-pause-request": "pause",
    "repeat-question-request": "repeat",
    "clarification-question": "clarification_question",
    "substantive-case-answer": "substantive_answer",
    frustration: "frustration",
    "off-topic-or-confused": "off_topic_or_confused",
    "stage-transition-request": "stage_transition",
    "end-interview": "end_interview",
  };
  const intent = mapped[routed.intent as keyof typeof mapped];
  return {
    kind: "resolved",
    reason: `deterministic_${intent}`,
    plan: deterministicPlan(intent, routed.evaluationText, routed.transitionTo),
  };
}

export function parseCaseTurnControllerDecision(value: unknown): CaseTurnControllerDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== CONTROLLER_KEYS.length) return null;
  if (CONTROLLER_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) return null;
  if (keys.some((key) => !(CONTROLLER_KEYS as readonly string[]).includes(key))) return null;
  if (!(CASE_TURN_CONTROLLER_INTENTS as readonly unknown[]).includes(record.intent)) return null;
  if (record.targetStage !== null && !isCaseState(record.targetStage)) return null;
  if (typeof record.shouldEvaluate !== "boolean") return null;
  if (typeof record.substantiveRemainder !== "string") return null;
  if (
    typeof record.confidence !== "number" ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) return null;
  return record as unknown as CaseTurnControllerDecision;
}

function normalizedSpan(candidateText: string, remainder: string): boolean {
  const candidate = normalizeCandidateText(candidateText);
  const normalizedRemainder = normalizeCandidateText(remainder);
  return Boolean(normalizedRemainder && candidate.includes(normalizedRemainder));
}

function meaningfulRemainder(remainder: string, stage: CaseState): boolean {
  const normalized = normalizeCandidateText(remainder);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length >= 4) return true;
  return (
    (stage === "analysis" || stage === "data_reveal" || stage === "recommendation") &&
    /\d|%|€|\$|£|\b(?:profit|payback|recommend|risk|revenue|cost)\b/i.test(remainder)
  );
}

export function validateCaseTurnControllerDecision(
  raw: unknown,
  candidateText: string,
  context: CaseTurnPlanContext,
): ControllerValidationResult {
  if (!authorizedCaseClarificationTopics(context.caseId)) {
    return { ok: false, reason: "unsupported_case_configuration" };
  }
  const decision = parseCaseTurnControllerDecision(raw);
  if (!decision) return { ok: false, reason: "schema_mismatch" };
  if (decision.confidence < CONTROLLER_CONFIDENCE_THRESHOLD) {
    return { ok: false, reason: "low_confidence" };
  }
  if (decision.intent === "ambiguous") return { ok: false, reason: "ambiguous_intent" };

  const legalNext = nextState(context.stage);
  const isTransition =
    decision.intent === "stage_transition" || decision.intent === "stage_transition_with_answer";
  if (isTransition) {
    if (decision.targetStage !== legalNext) return { ok: false, reason: "illegal_target_stage" };
    if (context.stage !== "clarification" || decision.targetStage !== "framework") {
      return { ok: false, reason: "unsupported_control_transition" };
    }
  } else if (decision.targetStage !== null) {
    return { ok: false, reason: "unexpected_target_stage" };
  }

  if (decision.intent === "end_interview" && !isExplicitEndRequest(candidateText)) {
    return { ok: false, reason: "unconfirmed_end_intent" };
  }
  if (decision.intent === "clarification_question" && context.stage !== "clarification") {
    return { ok: false, reason: "clarification_outside_stage" };
  }

  const shouldEvaluate = evaluatedIntent(decision.intent);
  const remainder = decision.substantiveRemainder.trim();
  if (!shouldEvaluate && remainder !== "") {
    return { ok: false, reason: "unexpected_substantive_remainder" };
  }
  if (shouldEvaluate) {
    if (!remainder) return { ok: false, reason: "missing_substantive_remainder" };
    if (!normalizedSpan(candidateText, remainder)) {
      return { ok: false, reason: "non_verbatim_substantive_remainder" };
    }
    if (
      decision.intent !== "clarification_question" &&
      !meaningfulRemainder(remainder, decision.targetStage ?? context.stage)
    ) {
      return { ok: false, reason: "insufficient_substantive_remainder" };
    }
  }

  let intent = decision.intent;
  if (intent === "readiness_confirmation" && context.readinessStatus === "confirmed") {
    intent = context.conversationStatus === "paused" ? "resume" : "readiness_confirmation";
  }
  if (intent === "not_ready" && context.readinessStatus === "confirmed") intent = "pause";

  return {
    ok: true,
    plan: {
      intent,
      targetStage: decision.targetStage,
      shouldEvaluate,
      evaluationText: remainder,
      confidence: decision.confidence,
      source: "controller",
    },
  };
}
