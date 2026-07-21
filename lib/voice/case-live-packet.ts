import authored from "@/context/cases/beautify-live-interviewer.json";
import { nextState } from "@/lib/fsm/case-fsm";
import type { CaseRecord, CaseSessionState, CaseState } from "@/lib/types";
import type { CaseVoiceProjectedTurn } from "@/lib/voice/types";

export interface CaseLiveClarificationFact {
  id: string;
  text: string;
}

export interface CaseLiveStageGuidance {
  objective: string;
  prompt: string;
  fallback: string;
}

export interface CaseLiveExhibitReference {
  id: string;
  title: string;
  stage: CaseState;
  order: number;
}

export interface BeautifyLiveAuthoredConfig {
  caseId: "beautify";
  opening: { readinessPrompt: string; casePrompt: string };
  stageSequence: CaseState[];
  stages: Partial<Record<CaseState, CaseLiveStageGuidance>>;
  frameworkExpectations: string[];
  analysisPrompts: string[];
  clarificationFacts: CaseLiveClarificationFact[];
  pressureTestPrompt: string;
  recommendationRequirements: string[];
  exhibits: CaseLiveExhibitReference[];
}

export interface CaseLiveRevealedExhibit {
  id: string;
  title: string;
  stage: CaseState;
  data: Record<string, unknown>;
}

export interface BeautifyLiveInterviewerPacket {
  caseId: "beautify";
  openingPrompt: string;
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  actualStage: CaseState;
  immediateLegalNextStage: CaseState | null;
  legalStageSequence: CaseState[];
  currentInterviewer: CaseLiveStageGuidance;
  frameworkExpectations: string[];
  analysisPrompts: string[];
  clarificationFacts: CaseLiveClarificationFact[];
  revealedExhibits: CaseLiveRevealedExhibit[];
  nextEligibleExhibit: { id: string; title: string } | null;
  pressureTestPrompt: string;
  recommendationRequirements: string[];
  recentAuthoritativeTurns: Array<{
    candidateText: string;
    interviewerText: string;
    stageBefore: CaseState;
    stageAfter: CaseState;
    scorable: boolean;
  }>;
}

const CONFIG = authored as unknown as BeautifyLiveAuthoredConfig;

const LIVE_STAGE_SEQUENCE: CaseState[] = [
  "clarification",
  "framework",
  "analysis",
  "data_reveal",
  "pressure_test",
  "recommendation",
  "scoring",
];

function hasExactKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertAuthoredConfig(config: BeautifyLiveAuthoredConfig): void {
  if (!hasExactKeys(config, [
    "caseId",
    "opening",
    "stageSequence",
    "stages",
    "frameworkExpectations",
    "analysisPrompts",
    "clarificationFacts",
    "pressureTestPrompt",
    "recommendationRequirements",
    "exhibits",
  ])) throw new Error("Invalid Beautify live packet fields");
  if (config.caseId !== "beautify") throw new Error("Invalid Beautify live packet case id");
  if (
    !hasExactKeys(config.opening, ["readinessPrompt", "casePrompt"]) ||
    !config.opening?.casePrompt?.trim() ||
    !config.opening?.readinessPrompt?.trim()
  ) {
    throw new Error("Invalid Beautify live packet opening");
  }
  if (JSON.stringify(config.stageSequence) !== JSON.stringify(LIVE_STAGE_SEQUENCE)) {
    throw new Error("Invalid Beautify live packet stage sequence");
  }
  if (
    !hasExactKeys(config.stages, LIVE_STAGE_SEQUENCE) ||
    LIVE_STAGE_SEQUENCE.some((stage) => {
      const guidance = config.stages[stage];
      return !hasExactKeys(guidance, ["objective", "prompt", "fallback"]) ||
        !guidance?.objective.trim() ||
        !guidance.prompt.trim() ||
        !guidance.fallback.trim();
    })
  ) throw new Error("Invalid Beautify live packet stage guidance");
  const factIds = config.clarificationFacts.map((fact) => fact.id);
  if (
    new Set(factIds).size !== factIds.length ||
    config.clarificationFacts.some((fact) =>
      !hasExactKeys(fact, ["id", "text"]) ||
      !/^clarification\.[a-z0-9_]+$/.test(fact.id) ||
      !fact.text.trim()
    )
  ) {
    throw new Error("Invalid Beautify live packet clarification facts");
  }
  const exhibitIds = config.exhibits.map((exhibit) => exhibit.id);
  if (
    new Set(exhibitIds).size !== exhibitIds.length ||
    config.exhibits.some((exhibit, index) =>
      !hasExactKeys(exhibit, ["id", "title", "stage", "order"]) ||
      exhibit.order !== index ||
      !exhibit.id.trim() ||
      !exhibit.title.trim()
    )
  ) {
    throw new Error("Invalid Beautify live packet exhibit order");
  }
}

assertAuthoredConfig(CONFIG);

export function beautifyLiveAuthoredConfig(): BeautifyLiveAuthoredConfig {
  return CONFIG;
}

/** Validate reference metadata only; canonical payloads and insights are never copied. */
export function validateCaseLiveExhibitReferences(
  references: CaseLiveExhibitReference[],
  caseRecord: CaseRecord,
): void {
  const seen = new Set<string>();
  let priorCanonicalIndex = -1;
  references.forEach((reference, index) => {
    if (seen.has(reference.id)) {
      throw new Error(`Duplicate live exhibit reference: ${reference.id}`);
    }
    seen.add(reference.id);
    if (reference.order !== index) {
      throw new Error(`Invalid live exhibit order: ${reference.id}`);
    }
    if (!LIVE_STAGE_SEQUENCE.includes(reference.stage) || reference.stage === "scoring") {
      throw new Error(`Invalid live exhibit stage: ${reference.id}`);
    }
    const canonicalIndex = caseRecord.exhibits.findIndex((exhibit) => exhibit.id === reference.id);
    if (canonicalIndex < 0) {
      throw new Error(`Unknown live exhibit reference: ${reference.id}`);
    }
    const canonical = caseRecord.exhibits[canonicalIndex];
    if (canonical.title !== reference.title) {
      throw new Error(`Mismatched live exhibit title: ${reference.id}`);
    }
    if (canonical.stage !== reference.stage) {
      throw new Error(`Mismatched live exhibit stage: ${reference.id}`);
    }
    if (canonicalIndex <= priorCanonicalIndex) {
      throw new Error(`Inconsistent canonical exhibit order: ${reference.id}`);
    }
    priorCanonicalIndex = canonicalIndex;
  });
}

export function caseLiveStageGuidance(stage: CaseState): CaseLiveStageGuidance {
  return CONFIG.stages[stage] ?? CONFIG.stages.clarification!;
}

export function caseLiveFact(id: string): CaseLiveClarificationFact | null {
  return CONFIG.clarificationFacts.find((fact) => fact.id === id) ?? null;
}

export function nextEligibleCaseLiveExhibit(
  session: CaseSessionState,
  effectiveStage = session.fsm_state,
): CaseLiveExhibitReference | null {
  const firstPending = [...CONFIG.exhibits]
    .sort((left, right) => left.order - right.order)
    .find((exhibit) => !session.exhibits_revealed.includes(exhibit.id));
  return firstPending?.stage === effectiveStage ? firstPending : null;
}

function candidateSafeNextExhibit(session: CaseSessionState): CaseLiveExhibitReference | null {
  const current = nextEligibleCaseLiveExhibit(session, session.fsm_state);
  if (current) return current;
  const legalNext = nextState(session.fsm_state);
  return legalNext ? nextEligibleCaseLiveExhibit(session, legalNext) : null;
}

/**
 * Construct the model input field-by-field. Never spread or serialize CaseRecord.
 * Hidden case material therefore has no path into this object.
 */
export function buildBeautifyLivePacket(input: {
  caseRecord: CaseRecord;
  session: CaseSessionState;
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  projectedTurns: CaseVoiceProjectedTurn[];
}): BeautifyLiveInterviewerPacket {
  if (input.caseRecord.id !== CONFIG.caseId) {
    throw new Error("The live interviewer packet supports Beautify only");
  }
  validateCaseLiveExhibitReferences(CONFIG.exhibits, input.caseRecord);

  const revealedExhibits = input.session.exhibits_revealed.flatMap((id) => {
    const approved = CONFIG.exhibits.find((candidate) => candidate.id === id);
    if (!approved) return [];
    const exhibit = input.caseRecord.exhibits.find((candidate) => candidate.id === id);
    if (
      !exhibit ||
      exhibit.title !== approved.title ||
      exhibit.stage !== approved.stage
    ) return [];
    return [{ id: exhibit.id, title: exhibit.title, stage: exhibit.stage, data: exhibit.data }];
  });
  const nextExhibit = candidateSafeNextExhibit(input.session);

  return {
    caseId: "beautify",
    openingPrompt: CONFIG.opening.casePrompt,
    readinessStatus: input.readinessStatus,
    conversationStatus: input.conversationStatus,
    actualStage: input.session.fsm_state,
    immediateLegalNextStage: nextState(input.session.fsm_state),
    legalStageSequence: [...CONFIG.stageSequence],
    currentInterviewer: {
      objective: caseLiveStageGuidance(input.session.fsm_state).objective,
      prompt: caseLiveStageGuidance(input.session.fsm_state).prompt,
      fallback: caseLiveStageGuidance(input.session.fsm_state).fallback,
    },
    frameworkExpectations: [...CONFIG.frameworkExpectations],
    analysisPrompts: [...CONFIG.analysisPrompts],
    clarificationFacts: input.session.fsm_state === "clarification"
      ? CONFIG.clarificationFacts.map((fact) => ({ id: fact.id, text: fact.text }))
      : [],
    revealedExhibits,
    nextEligibleExhibit: nextExhibit
      ? { id: nextExhibit.id, title: nextExhibit.title }
      : null,
    pressureTestPrompt: CONFIG.pressureTestPrompt,
    recommendationRequirements: [...CONFIG.recommendationRequirements],
    recentAuthoritativeTurns: input.projectedTurns.slice(-3).map((turn) => ({
      candidateText: turn.candidateText,
      interviewerText: turn.interviewerText,
      stageBefore: turn.stageBefore ?? turn.stage,
      stageAfter: turn.stageAfter ?? turn.stage,
      scorable: turn.scorable ?? true,
    })),
  };
}
