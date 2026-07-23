import type { CaseState } from "@/lib/types";
import { nextState } from "@/lib/fsm/case-fsm";
import { isValidClarificationQuestion } from "@/lib/voice/case-conversation";
import {
  isReadinessOnlyConfirmation,
  normalizeCandidateText,
  readinessDisposition,
} from "@/lib/voice/case-turn-sync";

export type CaseCandidateIntent =
  | "readiness-confirmation"
  | "not-ready"
  | "thinking-pause-request"
  | "repeat-question-request"
  | "clarification-question"
  | "substantive-case-answer"
  | "self-correction-revision"
  | "frustration"
  | "off-topic-or-confused"
  | "stage-transition-request"
  | "end-interview"
  | "ambiguous";

export interface CaseIntentContext {
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  stage: CaseState;
}

export interface RoutedCaseCandidateTurn {
  intent: CaseCandidateIntent;
  evaluationText: string;
  transitionTo: CaseState | null;
  compoundTransition: boolean;
}

const THINKING_REQUEST =
  /\b(?:gather(?:ing)? my thoughts?|collect(?:ing)? my thoughts?|(?:let me|i(?:'d| would) like to) think|think(?:ing)? (?:through|about) (?:this|that|it|the (?:question|problem)|my (?:answer|response))|(?:have|need|give me|take) (?:a|one|another|some|a couple(?: of)?|couple(?: of)?|a few) (?:moments?|minutes?|seconds?)|still (?:thinking|gathering)|bear with me|hold on)\b/;
const REPEAT_REQUEST = [
  /^(?:(?:can|could|would|will) you |please )?(?:repeat (?:that|the question|your question)|say that again|ask that again|restate (?:that|the question|your question)|rephrase (?:that|the question|your question))(?: please)?$/,
  /^i (?:didn'?t|did not) catch (?:that|the question|your question)$/,
  /^which question(?: do you mean)?$/,
];
const GENERIC_MEANING_REQUEST = /^what do you mean(?: by (?:that|the question))?$/;
const RESUME_REQUEST = [
  /^(?:continue|please continue|let'?s continue)$/,
  /^(?:i(?:'m| am) ready to (?:continue|answer)|i(?: will|'ll| want to| would like to) continue(?: with)? (?:my )?(?:answer|response))$/,
];
const END_REQUEST =
  /^(?:please )?(?:end|stop|finish|quit)(?: the| this| my)? (?:case|interview|call|session)(?: now)?$|^(?:i(?:'d| would) like to|i want to|can we|let'?s) (?:end|stop|finish)(?: the| this| my)? (?:case|interview|call|session)(?: now)?$|^(?:i(?:'d| would) like to|i want to) quit(?:(?: the| this| my)? (?:case|interview|call|session))?(?: now)?$/;
const FRUSTRATION_RESPONSE =
  /\b(?:i (?:already|just) (?:answered|gave|provided|covered)|i gave you (?:those|these|the) (?:points|branches|factors|answers?)|you(?:'re| are) asking (?:me )?(?:the same|that) (?:thing|question) again|why (?:do you|are you) keep (?:asking|repeating)|i don'?t understand why you keep (?:asking|repeating))\b/;
const CONFUSED_RESPONSE =
  /^(?:i(?: am|'m) confused|i don'?t understand|i do not understand|i have no idea|i don'?t know what to do|what are we doing)(?: here)?$/;
const CORRECTION_MARKER =
  /\b(?:actually|i mean|let me correct|let me rephrase|scratch that|cut that|correction)\b/;
const COMPOUND_TRANSITION_PREFIXES = [
  /^\s*(?:(?:i think\s+)?i(?:['’]m| am)\s+ready(?:\s+now)?\s+to\s+(?:structure|outline|lay out|share|walk through)(?:\s+(?:(?:my|the)\s+)?(?:approach|framework))?(?:\s+now)?)(?:\s*[.!;,:-]\s*(?:(?:and|so)\s+)?|\s+(?:and|so)\s+)([\s\S]+)$/i,
  /^\s*(?:let(?:['’]s| us)\s+continue|we can continue|i(?:['’]m| am)\s+ready\s+to\s+continue)(?:\s*[.!;,:-]\s*(?:(?:and|so)\s+)?|\s+(?:and|so)\s+)([\s\S]+)$/i,
  /^\s*i(?:['’]m| am)\s+ready\s+now(?:\s*[.!;,:-]\s*(?:(?:and|so)\s+)?|\s+(?:and|so)\s+)([\s\S]+)$/i,
  /^\s*i(?:['’]m| am)\s+done\s+(?:with\s+)?clarif(?:ication|ying)(?:\s*[.!;,:-]\s*(?:(?:and|so)\s+)?|\s+(?:and|so)\s+)([\s\S]+)$/i,
  /^\s*i(?:['’]d| would)\s+like\s+to\s+(?:move|go|get)(?:\s+on)?\s+(?:to|into)\s+(?:the\s+)?framework(?:\s+now)?(?:\s*[.!;,:-]\s*(?:(?:and|so)\s+)?|\s+(?:and|so)\s+)([\s\S]+)$/i,
];
const FRAMEWORK_TRANSITION_REQUEST =
  /^(?:(?:i think )?i(?:'m| am) ready(?: now)? to (?:structure|outline|lay out|share|walk through)(?: (?:(?:my|the) )?(?:approach|framework))?(?: now)?|i(?:'d| would) like to (?:structure|outline|lay out|share|walk through) (?:my|the) (?:approach|framework)|i(?:'d| would| want to) (?:like to )?(?:move|go|get)(?: on)? (?:to|into) (?:the )?framework(?: now)?|i(?:'d| would| want to) (?:like to )?continue (?:to|into) (?:the )?framework(?: now)?|(?:let'?s|we can) continue (?:to|into) (?:the )?framework(?: now)?|i(?:'m| am) done (?:with (?:the )?)?clarification(?: i(?:'d| would) like to (?:move|go|get)(?: on)? (?:to|into) (?:the )?framework(?: now)?)?|i(?:'m| am) done clarifying|(?:(?:let'?s|we can|please) )?(?:move|go|get)(?: on)? (?:to|into) (?:the )?framework)$/;

const CONVERSATIONAL_CONTROL_MARKER =
  /\b(?:not yet|wait|hold on|pause|break|repeat|say that again|restate|rephrase|continue|move to|move into|get into|go into|done (?:with )?clarif|finished (?:with )?clarif|already answered|same (?:thing|question)|confused|don'?t understand|end the|stop the interview|finish the|quit)\b/;
const SUBSTANTIVE_SIGNAL =
  /\b(?:analy[sz]e|assess|evaluate|calculate|estimate|framework|branches?|buckets?|first|second|third|because|therefore|recommend|hypothesis|customer|consumer|market|competition|competitor|retailer|channel|brand|technology|training|capabilit|operations?|economics?|financial|cost|revenue|sales|margin|profit|payback|risk|exhibit|data|conversion|returns?|service|distribution|adoption|access|inclusion|savings?|bank|implementation|feasibility|attractiveness)\b/;

export function isExplicitEndRequest(text: string): boolean {
  return END_REQUEST.test(normalizeCandidateText(text));
}

export function isFrameworkStageTransitionRequest(text: string): boolean {
  return FRAMEWORK_TRANSITION_REQUEST.test(normalizeCandidateText(text));
}

function isClearlySubstantiveCaseAnswer(text: string): boolean {
  const normalized = normalizeCandidateText(text);
  if (!normalized || CONVERSATIONAL_CONTROL_MARKER.test(normalized)) return false;
  if (/^(?:can|could|would|will|do|does|did|what|which|who|when|where|why|how|is|are)\b/.test(normalized)) {
    return false;
  }
  const words = normalized.split(" ").filter(Boolean);
  if (words.length >= 6 && SUBSTANTIVE_SIGNAL.test(normalized)) return true;
  return words.length >= 4 && /\d|%|€|\$|£/.test(text);
}

function compoundSubstantiveText(text: string): string | null {
  for (const pattern of COMPOUND_TRANSITION_PREFIXES) {
    const remainder = text.match(pattern)?.[1]?.trim() ?? "";
    if (normalizeCandidateText(remainder).split(" ").filter(Boolean).length >= 4) {
      return remainder;
    }
  }
  return null;
}

export function classifyCaseCandidateIntent(
  text: string,
  context: CaseIntentContext,
): CaseCandidateIntent {
  const normalized = normalizeCandidateText(text);

  if (context.readinessStatus === "awaiting") {
    if (readinessDisposition(text) === "ready") return "readiness-confirmation";
    return "not-ready";
  }

  if (isExplicitEndRequest(text)) return "end-interview";
  if (FRUSTRATION_RESPONSE.test(normalized)) return "frustration";
  if (THINKING_REQUEST.test(normalized)) return "thinking-pause-request";
  if (REPEAT_REQUEST.some((pattern) => pattern.test(normalized)) || GENERIC_MEANING_REQUEST.test(normalized)) {
    return "repeat-question-request";
  }
  if (RESUME_REQUEST.some((pattern) => pattern.test(normalized))) return "readiness-confirmation";
  if (isReadinessOnlyConfirmation(text)) return "readiness-confirmation";
  if (readinessDisposition(text) === "not-ready" && /\b(?:not ready|not yet)\b/.test(normalized)) {
    return "thinking-pause-request";
  }
  if (context.stage === "clarification" && isValidClarificationQuestion(text)) {
    return "clarification-question";
  }
  if (CONFUSED_RESPONSE.test(normalized)) return "off-topic-or-confused";
  if (CORRECTION_MARKER.test(normalized)) return "self-correction-revision";
  if (isClearlySubstantiveCaseAnswer(text)) return "substantive-case-answer";
  return "ambiguous";
}

export function routeCaseCandidateTurn(
  text: string,
  context: CaseIntentContext,
): RoutedCaseCandidateTurn {
  if (context.readinessStatus !== "confirmed") {
    return {
      intent: classifyCaseCandidateIntent(text, context),
      evaluationText: text.trim(),
      transitionTo: null,
      compoundTransition: false,
    };
  }

  if (
    context.stage === "clarification" &&
    context.conversationStatus === "active" &&
    isFrameworkStageTransitionRequest(text)
  ) {
    return {
      intent: "stage-transition-request",
      evaluationText: "",
      transitionTo: nextState(context.stage),
      compoundTransition: false,
    };
  }

  const substantive = compoundSubstantiveText(text);
  if (!substantive) {
    return {
      intent: classifyCaseCandidateIntent(text, context),
      evaluationText: text.trim(),
      transitionTo: null,
      compoundTransition: false,
    };
  }

  const transitionTo = context.stage === "clarification" ? nextState(context.stage) : null;
  const evaluationContext = transitionTo ? { ...context, stage: transitionTo } : context;
  return {
    intent: classifyCaseCandidateIntent(substantive, evaluationContext),
    evaluationText: substantive,
    transitionTo,
    compoundTransition: true,
  };
}
