import airportAuthored from "@/context/cases/airport-profitability-live-interviewer.json";
import gymAuthored from "@/context/cases/gcc-premium-gym-live-interviewer.json";
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

export interface CaseLiveAuthoredConfig {
  caseId: string;
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

export interface CaseLiveInterviewerPacket {
  caseId: string;
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

const LIVE_STAGE_SEQUENCE: CaseState[] = [
  "clarification",
  "framework",
  "analysis",
  "data_reveal",
  "pressure_test",
  "recommendation",
  "scoring",
];

/** Closed set of Preview LLM cases served by this registry. */
export const CASE_LIVE_CASE_IDS = [
  "airport_profitability",
  "gcc_premium_gym_market_entry",
] as const;

export type CaseLiveCaseId = (typeof CASE_LIVE_CASE_IDS)[number];

function hasExactKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertAuthoredConfig(config: CaseLiveAuthoredConfig, expectedId: string): void {
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
  ])) throw new Error(`Invalid live packet fields for ${expectedId}`);
  if (config.caseId !== expectedId) throw new Error(`Live packet case id mismatch: ${config.caseId}`);
  if (
    !hasExactKeys(config.opening, ["readinessPrompt", "casePrompt"]) ||
    !config.opening?.casePrompt?.trim() ||
    !config.opening?.readinessPrompt?.trim()
  ) {
    throw new Error(`Invalid live packet opening for ${expectedId}`);
  }
  if (JSON.stringify(config.stageSequence) !== JSON.stringify(LIVE_STAGE_SEQUENCE)) {
    throw new Error(`Invalid live packet stage sequence for ${expectedId}`);
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
  ) throw new Error(`Invalid live packet stage guidance for ${expectedId}`);
  const factIds = config.clarificationFacts.map((fact) => fact.id);
  if (
    new Set(factIds).size !== factIds.length ||
    config.clarificationFacts.some((fact) =>
      !hasExactKeys(fact, ["id", "text"]) ||
      !/^clarification\.[a-z0-9_]+$/.test(fact.id) ||
      !fact.text.trim()
    )
  ) {
    throw new Error(`Invalid live packet clarification facts for ${expectedId}`);
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
    throw new Error(`Invalid live packet exhibit order for ${expectedId}`);
  }
}

const CONFIGS: Readonly<Record<CaseLiveCaseId, CaseLiveAuthoredConfig>> = {
  airport_profitability: airportAuthored as unknown as CaseLiveAuthoredConfig,
  gcc_premium_gym_market_entry: gymAuthored as unknown as CaseLiveAuthoredConfig,
};

for (const caseId of CASE_LIVE_CASE_IDS) {
  assertAuthoredConfig(CONFIGS[caseId], caseId);
}

function configFor(caseId: string): CaseLiveAuthoredConfig {
  const config = (CONFIGS as Record<string, CaseLiveAuthoredConfig | undefined>)[caseId];
  if (!config) throw new Error(`No live interviewer config for case ${caseId}`);
  return config;
}

export function isCaseLiveCaseId(caseId: string): caseId is CaseLiveCaseId {
  return (CASE_LIVE_CASE_IDS as readonly string[]).includes(caseId);
}

export function caseLiveAuthoredConfig(caseId: string): CaseLiveAuthoredConfig {
  return configFor(caseId);
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

export function caseLiveStageGuidance(caseId: string, stage: CaseState): CaseLiveStageGuidance {
  const config = configFor(caseId);
  return config.stages[stage] ?? config.stages.clarification!;
}

export function caseLiveFact(caseId: string, id: string): CaseLiveClarificationFact | null {
  return configFor(caseId).clarificationFacts.find((fact) => fact.id === id) ?? null;
}

export function nextEligibleCaseLiveExhibit(
  caseId: string,
  session: CaseSessionState,
  effectiveStage = session.fsm_state,
): CaseLiveExhibitReference | null {
  const firstPending = [...configFor(caseId).exhibits]
    .sort((left, right) => left.order - right.order)
    .find((exhibit) => !session.exhibits_revealed.includes(exhibit.id));
  return firstPending?.stage === effectiveStage ? firstPending : null;
}

function candidateSafeNextExhibit(
  caseId: string,
  session: CaseSessionState,
): CaseLiveExhibitReference | null {
  const current = nextEligibleCaseLiveExhibit(caseId, session, session.fsm_state);
  if (current) return current;
  const legalNext = nextState(session.fsm_state);
  return legalNext ? nextEligibleCaseLiveExhibit(caseId, session, legalNext) : null;
}

/**
 * Construct the model input field-by-field from the selected case's authored
 * config. Never spread or serialize CaseRecord — hidden case material therefore
 * has no path into this object. Only the two Preview LLM cases are supported;
 * unknown ids fail closed.
 */
export function buildCaseLivePacket(input: {
  caseRecord: CaseRecord;
  session: CaseSessionState;
  readinessStatus: "awaiting" | "confirmed";
  conversationStatus: "active" | "paused";
  projectedTurns: CaseVoiceProjectedTurn[];
}): CaseLiveInterviewerPacket {
  const caseId = input.caseRecord.id;
  const config = configFor(caseId);
  validateCaseLiveExhibitReferences(config.exhibits, input.caseRecord);

  const revealedExhibits = input.session.exhibits_revealed.flatMap((id) => {
    const approved = config.exhibits.find((candidate) => candidate.id === id);
    if (!approved) return [];
    const exhibit = input.caseRecord.exhibits.find((candidate) => candidate.id === id);
    if (
      !exhibit ||
      exhibit.title !== approved.title ||
      exhibit.stage !== approved.stage
    ) return [];
    return [{ id: exhibit.id, title: exhibit.title, stage: exhibit.stage, data: exhibit.data }];
  });
  const nextExhibit = candidateSafeNextExhibit(caseId, input.session);
  const guidance = caseLiveStageGuidance(caseId, input.session.fsm_state);

  return {
    caseId,
    openingPrompt: config.opening.casePrompt,
    readinessStatus: input.readinessStatus,
    conversationStatus: input.conversationStatus,
    actualStage: input.session.fsm_state,
    immediateLegalNextStage: nextState(input.session.fsm_state),
    legalStageSequence: [...config.stageSequence],
    currentInterviewer: {
      objective: guidance.objective,
      prompt: guidance.prompt,
      fallback: guidance.fallback,
    },
    frameworkExpectations: [...config.frameworkExpectations],
    analysisPrompts: [...config.analysisPrompts],
    clarificationFacts: input.session.fsm_state === "clarification"
      ? config.clarificationFacts.map((fact) => ({ id: fact.id, text: fact.text }))
      : [],
    revealedExhibits,
    nextEligibleExhibit: nextExhibit
      ? { id: nextExhibit.id, title: nextExhibit.title }
      : null,
    pressureTestPrompt: config.pressureTestPrompt,
    recommendationRequirements: [...config.recommendationRequirements],
    recentAuthoritativeTurns: input.projectedTurns.slice(-3).map((turn) => ({
      candidateText: turn.candidateText,
      interviewerText: turn.interviewerText,
      stageBefore: turn.stageBefore ?? turn.stage,
      stageAfter: turn.stageAfter ?? turn.stage,
      scorable: turn.scorable ?? true,
    })),
  };
}
