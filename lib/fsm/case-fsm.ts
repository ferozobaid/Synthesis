/**
 * Case interview finite-state machine (pure, side-effect-free).
 *
 * States (locked): intro → clarification → framework → analysis → data_reveal →
 * pressure_test → recommendation → scoring.
 *
 * Rules:
 *  - Advance on a strong response.
 *  - Probe then redirect on weak responses (max 2 per state).
 *  - Graduated hint after 2 failed attempts at the same state (3-rung ladder).
 *  - Drip one exhibit per data_reveal entry.
 *  - Never skip scoring.
 */
import {
  CASE_STATES,
  type CaseAction,
  type CaseRecord,
  type CaseSessionState,
  type CaseState,
} from "@/lib/types";

export const MAX_PROBES_PER_STATE = 2;
export const HINT_AFTER_FAILS = 2;
export const HINT_LADDER_SIZE = 3;

export function nextState(s: CaseState): CaseState | null {
  const i = CASE_STATES.indexOf(s);
  return i >= 0 && i < CASE_STATES.length - 1 ? CASE_STATES[i + 1] : null;
}

export function getStage(c: CaseRecord, state: CaseState) {
  return c.stages.find((s) => s.id === state);
}

/** Exhibit ids configured for `state` that have not yet been revealed. */
export function pendingExhibits(
  c: CaseRecord,
  state: CaseState,
  revealed: string[],
): string[] {
  const drops = getStage(c, state)?.data_drops ?? [];
  return drops.filter((id) => !revealed.includes(id));
}

export interface DecideCtx {
  /** Failed (probe/redirect) attempts so far at this state. */
  attempts: number;
  /** Whether the latest candidate response was judged strong. */
  strong: boolean;
  /** Hints already given at this state. */
  hintsUsed: number;
  /** Exhibit ids still to drip for this state (data_reveal only). */
  pendingExhibits: string[];
}

export interface TurnDecision {
  action: CaseAction; // advance | probe | redirect | hint | reveal
  nextState: CaseState;
  hintIndex?: number; // 0-based rung in the hint ladder
  exhibitToReveal?: string | null;
}

/** Decide the interviewer's next move. Pure. */
export function decide(state: CaseState, ctx: DecideCtx): TurnDecision {
  // Scoring is terminal.
  if (state === "scoring") {
    return { action: "advance", nextState: "scoring" };
  }

  // Drip one exhibit per entry into data_reveal before evaluating advancement.
  if (state === "data_reveal" && ctx.pendingExhibits.length > 0) {
    return {
      action: "reveal",
      nextState: "data_reveal",
      exhibitToReveal: ctx.pendingExhibits[0],
    };
  }

  // Strong response → advance (never skipping scoring).
  if (ctx.strong) {
    return { action: "advance", nextState: nextState(state) ?? "scoring" };
  }

  // Weak response.
  if (ctx.attempts === 0) {
    return { action: "probe", nextState: state };
  }
  if (ctx.attempts === 1) {
    return { action: "redirect", nextState: state };
  }
  // attempts >= 2 → graduated hints, then move on once the ladder is exhausted.
  if (ctx.hintsUsed >= HINT_LADDER_SIZE) {
    return { action: "advance", nextState: nextState(state) ?? "scoring" };
  }
  return { action: "hint", nextState: state, hintIndex: ctx.hintsUsed };
}

/** Apply a decision to the session state. Pure — returns a new state. */
export function applyDecision(
  s: CaseSessionState,
  d: TurnDecision,
): CaseSessionState {
  const ns: CaseSessionState = {
    ...s,
    stage_attempts: { ...s.stage_attempts },
    hints_used: { ...s.hints_used },
    exhibits_revealed: [...s.exhibits_revealed],
  };

  switch (d.action) {
    case "reveal":
      if (d.exhibitToReveal) ns.exhibits_revealed.push(d.exhibitToReveal);
      return ns;
    case "hint":
      ns.hints_used[s.fsm_state] = (ns.hints_used[s.fsm_state] ?? 0) + 1;
      return ns;
    case "probe":
    case "redirect":
      ns.stage_attempts[s.fsm_state] = (ns.stage_attempts[s.fsm_state] ?? 0) + 1;
      return ns;
    case "advance":
      ns.fsm_state = d.nextState;
      // Reaching scoring means the final evaluation still has to run; complete is
      // set true once the scoring output is produced by the route.
      return ns;
    default:
      return ns;
  }
}

export function initSession(userId: string, caseId: string): CaseSessionState {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}`,
    user_id: userId,
    case_id: caseId,
    fsm_state: "intro",
    history: [],
    stage_attempts: {},
    hints_used: {},
    exhibits_revealed: [],
    complete: false,
  };
}

/** Convenience: run one full turn given the case, current session, and a strength judgement. */
export function step(
  c: CaseRecord,
  s: CaseSessionState,
  strong: boolean,
): { decision: TurnDecision; session: CaseSessionState } {
  const ctx: DecideCtx = {
    attempts: s.stage_attempts[s.fsm_state] ?? 0,
    strong,
    hintsUsed: s.hints_used[s.fsm_state] ?? 0,
    pendingExhibits: pendingExhibits(c, s.fsm_state, s.exhibits_revealed),
  };
  const decision = decide(s.fsm_state, ctx);
  return { decision, session: applyDecision(s, decision) };
}
