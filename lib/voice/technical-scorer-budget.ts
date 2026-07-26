/**
 * Output-token budgets for the technical post-call evaluators.
 *
 * Both technical evaluators emit a full structured report — per-dimension or
 * per-question rows with justifications, strengths, improvements, two improved
 * outlines, and a quantitative assessment. Measured production evidence for the
 * Clickstream system-design path showed the model hitting the ceiling
 * (stopReason "max_tokens" at outputTokens 1800 against a 1800 budget, with
 * inputTokens 4997), which silently downgraded a real model report to the
 * deterministic fallback. The budgets below give both technical paths headroom
 * over the largest observed complete report.
 *
 * These budgets apply to the TECHNICAL evaluators only. The consulting case
 * scorer and the Behavioural scorer are deliberately not routed through this
 * module and keep their existing budgets unchanged.
 *
 * The model is unchanged — claude-haiku-4-5 (MODEL_IDS.default).
 */

export type TechnicalEvaluatorType =
  | "technical_system_design"
  | "technical_question_bank";

/** Clickstream — six stages, five technical dimensions, two improved outlines. */
export const TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS = 3_200;

/** Data Analyst / Data Engineer rounds — five per-question rows plus feedback. */
export const TECHNICAL_QUESTION_BANK_MAX_TOKENS = 3_200;

export const TECHNICAL_SCORER_MAX_TOKENS: Readonly<
  Record<TechnicalEvaluatorType, number>
> = {
  technical_system_design: TECHNICAL_SYSTEM_DESIGN_MAX_TOKENS,
  technical_question_bank: TECHNICAL_QUESTION_BANK_MAX_TOKENS,
};

/** The effective output-token budget for a technical evaluator. */
export function technicalScorerMaxTokens(evaluator: TechnicalEvaluatorType): number {
  return TECHNICAL_SCORER_MAX_TOKENS[evaluator];
}

/**
 * Structured server log for one technical scorer model call. Emitted on every
 * technical evaluation — model result and fallback alike — so a budget-driven
 * fallback is visible in logs and never only in the UI.
 */
export function logTechnicalScorerCall(input: {
  evaluatorType: TechnicalEvaluatorType;
  caseId: string;
  model: string;
  maxTokenBudget: number;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  result: "model" | "deterministic_fallback";
  failureCategory: string | null;
}): void {
  console.info("[technical-scorer] model-call", input);
}
