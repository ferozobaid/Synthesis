/**
 * Case session orchestration — the async layer that ties the pure FSM
 * (lib/fsm/case-fsm) to the evaluator, retrieval pre-fetch and final scoring. Kept out
 * of the route handler so a whole session is testable without HTTP.
 *
 * Flow per response: evaluate the answer → record it in the transcript → run the
 * FSM step → record the interviewer's move → either pre-fetch the next stage's
 * context (on advance) or, on reaching `scoring`, produce the final CaseScore.
 *
 * Live plane only. Never imports from offline scripts.
 */
import { useMocks } from "@/lib/config";
import {
  getStage,
  initSession,
  step,
  type TurnDecision,
} from "@/lib/fsm/case-fsm";
import { evaluateResponse, isStrong } from "@/lib/fsm/case-evaluator";
import { scoreCase } from "@/lib/fsm/case-scoring";
import { prefetchCaseStage, type StageContext } from "@/lib/rag";
import type {
  CaseAction,
  CaseExhibit,
  CaseRecord,
  CaseScore,
  CaseSessionState,
  CaseState,
  Evaluation,
} from "@/lib/types";

export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";

export interface CaseStartResult {
  session: CaseSessionState;
  interviewer: { text: string };
  stage: CaseState;
  context: StageContext;
  complete: false;
  mock: boolean;
}

export interface CaseTurnResult {
  session: CaseSessionState;
  decision: TurnDecision;
  /** Evaluation of the answer just submitted (same shape in mock and real modes). */
  evaluation: Evaluation;
  interviewer: { text: string; exhibit: CaseExhibit | null; action: CaseAction };
  stage: CaseState;
  /** Pre-fetched context for the new stage (only when the response advanced). */
  context: StageContext | null;
  /** Final score — present only once the session reaches the scoring stage. */
  score: CaseScore | null;
  complete: boolean;
  mock: boolean;
}

export interface CaseRunnerTimings {
  evaluationMs?: number;
  prefetchMs?: number;
  scoringMs?: number;
}

export interface RespondToCaseOptions {
  /** Voice already has all authored prompts and does not consume StageContext. */
  prefetchOnAdvance?: boolean;
  timings?: CaseRunnerTimings;
}

/** The interviewer's spoken line for a decision (reads prompts/hints/probes from the case JSON). */
function interviewerLine(
  c: CaseRecord,
  d: TurnDecision,
  prior: CaseSessionState,
): { text: string; exhibit: CaseExhibit | null } {
  if (d.action === "reveal") {
    const ex = c.exhibits.find((e) => e.id === d.exhibitToReveal) ?? null;
    return {
      text: `Here is some data — ${ex?.title ?? "an exhibit"}. What do you take from it?`,
      exhibit: ex,
    };
  }
  if (d.action === "hint") {
    const cur = getStage(c, prior.fsm_state);
    return { text: cur?.hint_ladder?.[d.hintIndex ?? 0] ?? "Let me give you a nudge.", exhibit: null };
  }
  if (d.action === "probe" || d.action === "redirect") {
    const cur = getStage(c, prior.fsm_state);
    const probes = cur?.probe_bank ?? [];
    const idx = (prior.stage_attempts[prior.fsm_state] ?? 0) % Math.max(1, probes.length);
    return { text: probes[idx] ?? "Can you go a level deeper?", exhibit: null };
  }
  // advance
  const stage = getStage(c, d.nextState);
  return { text: stage?.interviewer_prompt ?? "Let's continue.", exhibit: null };
}

/** Start a case: new session + the candidate-facing opening + pre-fetched intro context. */
export async function startCase(c: CaseRecord, userId = DEFAULT_USER_ID): Promise<CaseStartResult> {
  const session = initSession(userId, c.id);
  const context = await prefetchCaseStage(c, "intro", session.exhibits_revealed);
  return {
    session,
    interviewer: { text: c.prompt ?? context.interviewer_prompt ?? "Let's begin." },
    stage: session.fsm_state,
    context,
    complete: false,
    mock: useMocks(),
  };
}

/** Evaluate one candidate response, advance the FSM, and pre-fetch / score as needed. */
export async function respondToCase(
  c: CaseRecord,
  prior: CaseSessionState,
  answer: string,
  options: RespondToCaseOptions = {},
): Promise<CaseTurnResult> {
  const stageBefore = prior.fsm_state;
  const evaluationStartedAt = Date.now();
  const evaluation = await evaluateResponse(c, stageBefore, answer);
  if (options.timings) options.timings.evaluationMs = Date.now() - evaluationStartedAt;
  const strong = isStrong(evaluation, stageBefore, c);

  // Record the candidate's turn (tagged with the stage it was given at) so final
  // scoring can re-read the transcript.
  const withCandidate: CaseSessionState = {
    ...prior,
    history: [...prior.history, { role: "candidate", stage: stageBefore, text: answer }],
  };

  const { decision, session: afterStep } = step(c, withCandidate, strong);
  const line = interviewerLine(c, decision, withCandidate);

  let session: CaseSessionState = {
    ...afterStep,
    history: [
      ...afterStep.history,
      { role: "interviewer", stage: decision.nextState, text: line.text, action: decision.action },
    ],
  };

  let score: CaseScore | null = null;
  let context: StageContext | null = null;

  if (session.fsm_state === "scoring") {
    const scoringStartedAt = Date.now();
    score = await scoreCase(c, session);
    if (options.timings) options.timings.scoringMs = Date.now() - scoringStartedAt;
    session = { ...session, complete: true };
  } else if (decision.action === "advance" && options.prefetchOnAdvance !== false) {
    // Advanced into a new stage — pre-fetch its context so it's ready before the
    // next response (CLAUDE.md: pre-fetch at transitions, never mid-response).
    const prefetchStartedAt = Date.now();
    context = await prefetchCaseStage(c, session.fsm_state, session.exhibits_revealed);
    if (options.timings) options.timings.prefetchMs = Date.now() - prefetchStartedAt;
  }

  return {
    session,
    decision,
    evaluation,
    interviewer: { text: line.text, exhibit: line.exhibit, action: decision.action },
    stage: session.fsm_state,
    context,
    score,
    complete: session.fsm_state === "scoring",
    mock: useMocks(),
  };
}
