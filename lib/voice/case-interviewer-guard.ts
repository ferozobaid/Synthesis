import { createHash } from "node:crypto";
import { nextState } from "@/lib/fsm/case-fsm";
import type { CaseAction, CaseExhibit, CaseRecord, CaseState } from "@/lib/types";
import {
  CASE_NOT_READY_RESPONSE,
  caseOpeningAfterReadiness,
} from "@/lib/voice/case-conversation";
import type {
  CaseInterviewerCandidateAction,
  CaseInterviewerDecision,
  CaseInterviewerFailureReason,
  CaseInterviewerOutcome,
} from "@/lib/voice/case-interviewer";
import {
  caseLiveFact,
  caseLiveStageGuidance,
  nextEligibleCaseLiveExhibit,
  type CaseLiveInterviewerPacket,
} from "@/lib/voice/case-live-packet";
import type { CaseVoiceSession } from "@/lib/voice/types";
import {
  canonicalNumericClaims,
  canonicalNumericClaimsFromData,
  canonicalNumericClaimsMatch,
  isOrdinarySmallNumber,
  type CanonicalNumericClaim,
} from "@/lib/voice/case-protected-numbers";

export type CaseLlmBackendAction = CaseAction | "conversation" | "fallback";

export const CASE_CONCLUDED_UNSCORED_RESPONSE =
  "Thank you. That concludes the live case interview. A score is not available yet.";

export interface CaseInterviewerApplication {
  spokenText: string;
  candidateAction: CaseInterviewerCandidateAction;
  stageBefore: CaseState;
  stageAfter: CaseState;
  action: CaseLlmBackendAction;
  exhibit: CaseExhibit | null;
  scorable: boolean;
  readinessStatus?: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  probeAnswerHash: string | null;
  liveStatus: "active" | "concluded_unscored";
  fallbackReason: string | null;
  projectTurn: boolean;
}

const META_ACTIONS = new Set<CaseInterviewerCandidateAction>([
  "readiness_confirmed",
  "not_ready",
  "pause",
  "resume",
  "repeat_request",
  "off_topic",
]);

const SCORE_OR_FEEDBACK = /\b(?:score|scoring|grade|grading|feedback|passed|failed|performance rating|report is ready|score is ready)\b/i;
const EVALUATIVE_FEEDBACK = /\b(?:strong|weak|excellent|poor|correct|incorrect|good|bad)\s+(?:answer|response|framework|analysis|recommendation)\b/i;
const EXCESSIVE_COACHING = /\b(?:the correct answer is|a strong answer should|you need to say|make sure you include|the solution is)\b/i;

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.%€$£]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function flattenStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(flattenStrings);
  }
  return [];
}

function shingles(value: string, size = 8): string[] {
  const words = normalize(value).split(" ").filter(Boolean);
  if (words.length < size) return [];
  return words.slice(0, words.length - size + 1).map((_, index) =>
    words.slice(index, index + size).join(" ")
  );
}

function protectedSegments(value: string): string[] {
  return value
    .split(/[.;:—–]|\([^)]*\)/)
    .map(normalize)
    .filter((segment) => segment.split(" ").filter(Boolean).length >= 2);
}

function leaksProtectedPhrase(spoken: string, c: CaseRecord): boolean {
  const normalizedSpoken = normalize(spoken);
  const protectedText = [
    c.target_solution_notes ?? "",
    ...(c.quant?.solution_steps ?? []),
    c.quant?.answer ?? "",
    ...c.exhibits.flatMap((exhibit) => exhibit.insights ?? []),
    ...c.scoring_rubric.dimensions.flatMap((dimension) => [
      dimension.description,
      ...Object.values(dimension.anchors),
    ]),
  ].filter(Boolean);
  return protectedText.some((text) => {
    const normalizedText = normalize(text);
    const words = normalizedText.split(" ").filter(Boolean);
    if (words.length <= 8 && normalizedSpoken.includes(normalizedText)) return true;
    if (protectedSegments(text).some((segment) => normalizedSpoken.includes(segment))) return true;
    return shingles(text).some((shingle) => normalizedSpoken.includes(shingle));
  });
}

function anyClaimMatches(
  claim: CanonicalNumericClaim,
  candidates: CanonicalNumericClaim[],
  tolerance = 1e-8,
): boolean {
  return candidates.some((candidate) => canonicalNumericClaimsMatch(claim, candidate, tolerance));
}

function protectedQuantClaims(c: CaseRecord): {
  primary: CanonicalNumericClaim[];
  solution: CanonicalNumericClaim[];
  tolerance: number;
} {
  if (!c.quant) return { primary: [], solution: [], tolerance: 1e-8 };
  const primary = canonicalNumericClaims(c.quant.answer);
  if (typeof c.quant.answer_value === "number" && Number.isFinite(c.quant.answer_value)) {
    const unit = primary.find((claim) => claim.unit === "years")?.unit ?? "number";
    primary.push({ value: c.quant.answer_value, unit });
  }
  return {
    primary,
    solution: canonicalNumericClaims([
      c.quant.answer,
      ...c.quant.solution_steps,
      c.target_solution_notes ?? "",
    ].join(" ")),
    tolerance: c.quant.tolerance ?? 1e-8,
  };
}

/**
 * Numbers the backend has already placed in the candidate-safe packet for the
 * current stage. These are safe for the interviewer to speak because they are,
 * by construction, candidate-facing. Stage-scoped fields (currentInterviewer)
 * only carry the current stage's figures, so authorization tracks disclosure.
 * Protected/derived answers never appear in the packet, so they are never
 * authorized here.
 */
function packetAuthorizedNumericText(packet: CaseLiveInterviewerPacket): string {
  return [
    packet.openingPrompt,
    packet.currentInterviewer.objective,
    packet.currentInterviewer.prompt,
    ...packet.frameworkExpectations,
    ...packet.analysisPrompts,
    packet.pressureTestPrompt,
    ...packet.recommendationRequirements,
  ].join(" ");
}

function backendAuthorizedNumericClaims(input: {
  approvedFactText?: string;
  packet: CaseLiveInterviewerPacket;
}): CanonicalNumericClaim[] {
  return [
    ...canonicalNumericClaims(input.approvedFactText ?? ""),
    ...canonicalNumericClaims(packetAuthorizedNumericText(input.packet)),
    ...input.packet.revealedExhibits.flatMap((exhibit) =>
      canonicalNumericClaimsFromData(exhibit.data)
    ),
  ];
}

function numericWordingFailure(input: {
  spoken: string;
  candidateText: string;
  approvedFactText?: string;
  packet: CaseLiveInterviewerPacket;
  caseRecord: CaseRecord;
}): string | null {
  const spokenClaims = canonicalNumericClaims(input.spoken);
  if (spokenClaims.length === 0) return null;
  const backendAuthorized = backendAuthorizedNumericClaims(input);
  const candidateAuthorized = canonicalNumericClaims(input.candidateText);
  const protectedClaims = protectedQuantClaims(input.caseRecord);

  for (const claim of spokenClaims) {
    if (anyClaimMatches(claim, protectedClaims.primary, protectedClaims.tolerance)) {
      return "protected_quant_answer";
    }
    if (
      anyClaimMatches(claim, protectedClaims.solution) &&
      !anyClaimMatches(claim, backendAuthorized)
    ) return "protected_quant_derivation";
    if (
      !isOrdinarySmallNumber(claim) &&
      !anyClaimMatches(claim, backendAuthorized) &&
      !anyClaimMatches(claim, candidateAuthorized)
    ) return "unsupported_numeric_claim";
  }
  return null;
}

function leaksUnrevealedExhibitContent(
  spoken: string,
  candidateText: string,
  packet: CaseLiveInterviewerPacket,
  c: CaseRecord,
): boolean {
  const normalizedSpoken = normalize(spoken);
  const normalizedCandidate = normalize(candidateText);
  const revealed = new Set(packet.revealedExhibits.map((exhibit) => exhibit.id));
  const allowedTitle = normalize(packet.nextEligibleExhibit?.title ?? "");
  return c.exhibits.some((exhibit) => {
    if (revealed.has(exhibit.id)) return false;
    const raw = exhibit as unknown as Record<string, unknown>;
    const protectedValues = [
      ...flattenStrings(raw.data),
      ...flattenStrings(raw.capabilities),
      ...flattenStrings(raw.columns),
      ...flattenStrings(raw.insights),
      ...flattenStrings(raw.note),
    ];
    return protectedValues.some((value) => {
      const phrase = normalize(value);
      if (!phrase || phrase === allowedTitle || normalizedCandidate.includes(phrase)) return false;
      const words = phrase.split(" ").filter(Boolean);
      if (words.length <= 4) return phrase.length >= 4 && normalizedSpoken.includes(phrase);
      return shingles(phrase, 5).some((shingle) => normalizedSpoken.includes(shingle));
    });
  });
}

function sentenceCount(value: string): number {
  return value.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

export type WordingValidation = { ok: true } | { ok: false; reason: string };

export function validateCaseInterviewerWording(input: {
  spokenText: string;
  candidateText: string;
  decision: CaseInterviewerDecision;
  packet: CaseLiveInterviewerPacket;
  caseRecord: CaseRecord;
  approvedFactText?: string;
}): WordingValidation {
  const spoken = input.spokenText.trim();
  if (!spoken) return { ok: false, reason: "empty_wording" };
  if (spoken.length > 600) return { ok: false, reason: "wording_too_long" };
  if (sentenceCount(spoken) > 3) return { ok: false, reason: "wording_too_many_sentences" };
  if (input.decision.shouldProbe && (spoken.match(/\?/g)?.length ?? 0) > 1) {
    return { ok: false, reason: "multiple_probe_questions" };
  }
  if (SCORE_OR_FEEDBACK.test(spoken)) return { ok: false, reason: "score_or_feedback_claim" };
  if (EVALUATIVE_FEEDBACK.test(spoken)) return { ok: false, reason: "live_feedback_claim" };
  if (EXCESSIVE_COACHING.test(spoken)) return { ok: false, reason: "excessive_coaching" };
  if (leaksProtectedPhrase(spoken, input.caseRecord)) {
    return { ok: false, reason: "protected_case_content" };
  }
  if (leaksUnrevealedExhibitContent(
    spoken,
    input.candidateText,
    input.packet,
    input.caseRecord,
  )) return { ok: false, reason: "unrevealed_exhibit_content" };

  const numericFailure = numericWordingFailure({
    spoken,
    candidateText: input.candidateText,
    approvedFactText: input.approvedFactText,
    packet: input.packet,
    caseRecord: input.caseRecord,
  });
  if (numericFailure) return { ok: false, reason: numericFailure };
  return { ok: true };
}

export function caseCandidateAnswerHash(stage: CaseState, candidateText: string): string {
  return createHash("sha256")
    .update(`${stage}:${normalize(candidateText)}`)
    .digest("hex")
    .slice(0, 24);
}

function requiredConfidence(decision: CaseInterviewerDecision, stage: CaseState): number {
  if (stage === "recommendation" && decision.proposedStage === "scoring") return 0.9;
  if (decision.proposedStage !== null || decision.requestedExhibitId !== null) return 0.85;
  if (
    decision.requestedFactIds.length > 0 ||
    decision.shouldProbe ||
    decision.candidateAction === "readiness_confirmed" ||
    !META_ACTIONS.has(decision.candidateAction)
  ) return 0.75;
  return 0.6;
}

function fallbackApplication(
  current: CaseVoiceSession,
  candidateAction: CaseInterviewerCandidateAction,
  reason: string,
): CaseInterviewerApplication {
  const stage = current.session.fsm_state;
  const awaiting = (current.readinessStatus ?? "confirmed") === "awaiting";
  return {
    spokenText: awaiting
      ? CASE_NOT_READY_RESPONSE
      : caseLiveStageGuidance(current.caseId, stage).fallback,
    candidateAction,
    stageBefore: stage,
    stageAfter: stage,
    action: "fallback",
    exhibit: null,
    scorable: false,
    readinessStatus: current.readinessStatus ?? "confirmed",
    conversationStatus: current.conversationStatus ?? "active",
    probeAnswerHash: null,
    liveStatus: current.liveStatus ?? "active",
    fallbackReason: reason,
    projectTurn: !awaiting,
  };
}

function actionAllowsStage(
  action: CaseInterviewerCandidateAction,
  current: CaseState,
  target: CaseState,
): boolean {
  if (current === "clarification" && target === "framework") {
    return action === "clarifying_question" || action === "framework_answer";
  }
  if (current === "framework" && target === "analysis") return action === "framework_answer";
  if (current === "analysis" && target === "data_reveal") {
    return action === "analysis_answer" || action === "brainstorm_answer";
  }
  if (current === "data_reveal" && target === "pressure_test") {
    return action === "analysis_answer" || action === "calculation_answer";
  }
  if (current === "pressure_test" && target === "recommendation") return action === "analysis_answer";
  if (current === "recommendation" && target === "scoring") return action === "recommendation";
  return false;
}

function actionAllowedInStage(action: CaseInterviewerCandidateAction, stage: CaseState): boolean {
  if (META_ACTIONS.has(action)) return true;
  if (stage === "clarification") return action === "clarifying_question" || action === "framework_answer";
  if (stage === "framework") return action === "framework_answer";
  if (stage === "analysis") return action === "analysis_answer" || action === "brainstorm_answer";
  if (stage === "data_reveal") return action === "analysis_answer" || action === "calculation_answer";
  if (stage === "pressure_test") return action === "analysis_answer";
  if (stage === "recommendation") return action === "recommendation";
  return false;
}

function factSpeech(caseId: string, factIds: string[], advancing: boolean): string {
  const facts = factIds
    .map((id) => caseLiveFact(caseId, id))
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null);
  const followUp = advancing
    ? caseLiveStageGuidance(caseId, "framework").prompt
    : "Do you have another clarification, or are you ready to structure your approach?";
  return `Certainly. ${facts.map((fact) => fact.text).join(" ")} ${followUp}`;
}

function metaSpeech(
  current: CaseVoiceSession,
  decision: CaseInterviewerDecision,
  packet: CaseLiveInterviewerPacket,
): { text: string; conversationStatus: "active" | "paused" } {
  if (decision.candidateAction === "pause" || decision.candidateAction === "not_ready") {
    return {
      text: "Of course. Take your time and let me know when you’re ready.",
      conversationStatus: "paused",
    };
  }
  if (decision.candidateAction === "resume") {
    return { text: "Of course. Let’s continue.", conversationStatus: "active" };
  }
  if (decision.candidateAction === "repeat_request") {
    return {
      text: `Certainly. ${packet.currentInterviewer.prompt}`,
      conversationStatus: current.conversationStatus ?? "active",
    };
  }
  return {
    text: decision.spokenResponse,
    conversationStatus: current.conversationStatus ?? "active",
  };
}

export function applyCaseInterviewerDecision(input: {
  current: CaseVoiceSession;
  caseRecord: CaseRecord;
  packet: CaseLiveInterviewerPacket;
  candidateText: string;
  outcome: CaseInterviewerOutcome;
  failureReason?: CaseInterviewerFailureReason | null;
  decision: CaseInterviewerDecision | null;
}): CaseInterviewerApplication {
  const { current, caseRecord, packet, candidateText } = input;
  const caseId = caseRecord.id;
  const stage = current.session.fsm_state;
  const decision = input.decision;
  if (input.outcome !== "success" || !decision) {
    return fallbackApplication(
      current,
      "off_topic",
      input.failureReason ?? `model_${input.outcome}`,
    );
  }

  if ((current.readinessStatus ?? "confirmed") === "awaiting") {
    if (
      !["readiness_confirmed", "not_ready", "pause"].includes(decision.candidateAction) ||
      decision.proposedStage !== null ||
      decision.requestedFactIds.length > 0 ||
      decision.requestedExhibitId !== null ||
      decision.shouldProbe
    ) return fallbackApplication(current, decision.candidateAction, "invalid_readiness_decision");
    if (decision.confidence < requiredConfidence(decision, stage)) {
      return fallbackApplication(current, decision.candidateAction, "low_confidence");
    }
    if (decision.candidateAction === "readiness_confirmed") {
      return {
        spokenText: caseOpeningAfterReadiness(packet.openingPrompt),
        candidateAction: decision.candidateAction,
        stageBefore: stage,
        stageAfter: stage,
        action: "conversation",
        exhibit: null,
        scorable: false,
        readinessStatus: "confirmed",
        conversationStatus: "active",
        probeAnswerHash: null,
        liveStatus: "active",
        fallbackReason: null,
        projectTurn: false,
      };
    }
    return {
      spokenText: CASE_NOT_READY_RESPONSE,
      candidateAction: decision.candidateAction,
      stageBefore: stage,
      stageAfter: stage,
      action: "conversation",
      exhibit: null,
      scorable: false,
      readinessStatus: "awaiting",
      conversationStatus: "paused",
      probeAnswerHash: null,
      liveStatus: "active",
      fallbackReason: null,
      projectTurn: false,
    };
  }

  const meta = META_ACTIONS.has(decision.candidateAction);
  if (
    (meta && (
      decision.proposedStage !== null ||
      decision.requestedFactIds.length > 0 ||
      decision.requestedExhibitId !== null ||
      decision.shouldProbe
    )) ||
    (decision.shouldProbe && decision.proposedStage !== null) ||
    (decision.requestedFactIds.length > 0 && decision.requestedExhibitId !== null) ||
    (decision.requestedFactIds.length > 0 && decision.shouldProbe) ||
    (decision.requestedExhibitId !== null && decision.shouldProbe)
  ) return fallbackApplication(current, decision.candidateAction, "conflicting_decision");

  if (decision.confidence < requiredConfidence(decision, stage)) {
    return fallbackApplication(current, decision.candidateAction, "low_confidence");
  }
  if (!actionAllowedInStage(decision.candidateAction, stage)) {
    return fallbackApplication(current, decision.candidateAction, "action_stage_mismatch");
  }

  const legalNext = nextState(stage);
  if (decision.proposedStage !== null) {
    if (decision.proposedStage !== legalNext || !actionAllowsStage(decision.candidateAction, stage, decision.proposedStage)) {
      return fallbackApplication(current, decision.candidateAction, "illegal_stage_transition");
    }
    if (
      stage === "data_reveal" &&
      decision.proposedStage === "pressure_test" &&
      nextEligibleCaseLiveExhibit(caseId, current.session, "data_reveal")
    ) return fallbackApplication(current, decision.candidateAction, "pending_exhibits");
  }

  if (decision.requestedFactIds.length > 0) {
    if (stage !== "clarification" || decision.candidateAction !== "clarifying_question") {
      return fallbackApplication(current, decision.candidateAction, "facts_outside_clarification");
    }
    if (decision.requestedFactIds.some((id) => !packet.clarificationFacts.some((fact) => fact.id === id))) {
      return fallbackApplication(current, decision.candidateAction, "unknown_fact_id");
    }
  }

  const stageAfter = decision.proposedStage ?? stage;
  let exhibit: CaseExhibit | null = null;
  if (decision.requestedExhibitId !== null) {
    const expected = nextEligibleCaseLiveExhibit(caseId, current.session, stageAfter);
    if (!expected || expected.id !== decision.requestedExhibitId) {
      return fallbackApplication(current, decision.candidateAction, "invalid_exhibit_id_or_order");
    }
    exhibit = caseRecord.exhibits.find((candidate) => candidate.id === expected.id) ?? null;
    if (!exhibit) return fallbackApplication(current, decision.candidateAction, "missing_exhibit_payload");
  }

  const answerHash = caseCandidateAnswerHash(stage, candidateText);
  if (decision.shouldProbe) {
    const priorHashes = current.probedAnswerHashes?.[stage] ?? [];
    const count = current.stageProbeCounts?.[stage] ?? current.session.stage_attempts[stage] ?? 0;
    if (priorHashes.includes(answerHash) || count >= 2) {
      return {
        spokenText: "Thank you. Please continue with your current analysis when you’re ready.",
        candidateAction: decision.candidateAction,
        stageBefore: stage,
        stageAfter: stage,
        action: "conversation",
        exhibit: null,
        scorable: false,
        conversationStatus: "active",
        probeAnswerHash: null,
        liveStatus: current.liveStatus ?? "active",
        fallbackReason: null,
        projectTurn: true,
      };
    }
  }

  const approvedFactText = decision.requestedFactIds
    .map((id) => caseLiveFact(caseId, id))
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null)
    .map((fact) => fact.text)
    .join(" ");
  const wording = validateCaseInterviewerWording({
    spokenText: decision.spokenResponse,
    candidateText,
    decision,
    packet,
    caseRecord,
    approvedFactText,
  });
  if (!wording.ok && decision.requestedFactIds.length === 0 && !exhibit && stageAfter !== "scoring") {
    return fallbackApplication(current, decision.candidateAction, wording.reason);
  }

  if (meta) {
    const response = metaSpeech(current, decision, packet);
    const metaWording = validateCaseInterviewerWording({
      spokenText: response.text,
      candidateText,
      decision: { ...decision, shouldProbe: false },
      packet,
      caseRecord,
    });
    if (!metaWording.ok) return fallbackApplication(current, decision.candidateAction, metaWording.reason);
    return {
      spokenText: response.text,
      candidateAction: decision.candidateAction,
      stageBefore: stage,
      stageAfter: stage,
      action: "conversation",
      exhibit: null,
      scorable: false,
      conversationStatus: response.conversationStatus,
      probeAnswerHash: null,
      liveStatus: current.liveStatus ?? "active",
      fallbackReason: null,
      projectTurn: true,
    };
  }

  const terminal = stageAfter === "scoring";
  const spokenText = terminal
    ? CASE_CONCLUDED_UNSCORED_RESPONSE
    : exhibit
      ? `I’m sharing ${exhibit.title}. Take a moment to review it, then tell me what stands out.`
      : decision.requestedFactIds.length > 0
        ? factSpeech(caseId, decision.requestedFactIds, stageAfter === "framework")
        : decision.spokenResponse;

  return {
    spokenText,
    candidateAction: decision.candidateAction,
    stageBefore: stage,
    stageAfter,
    action: exhibit
      ? "reveal"
      : terminal || stageAfter !== stage
        ? "advance"
        : decision.shouldProbe
          ? "probe"
          : "conversation",
    exhibit,
    scorable: true,
    conversationStatus: "active",
    probeAnswerHash: decision.shouldProbe ? answerHash : null,
    liveStatus: terminal ? "concluded_unscored" : "active",
    fallbackReason: null,
    projectTurn: true,
  };
}
