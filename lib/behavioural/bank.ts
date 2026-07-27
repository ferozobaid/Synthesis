/**
 * The authored behavioural question bank, as the single typed source.
 *
 * Client-safe on purpose: it imports ONLY context/behavioural/question_bank.json,
 * which is candidate-facing content the interviewer speaks aloud. It deliberately
 * pulls in no mock JD, no seed answer bank, and no case material, so the preflight
 * can derive a real question count without those reaching the browser bundle.
 *
 * lib/__mocks__/fixtures.ts re-exports MOCK_QUESTIONS from here so there is exactly
 * one bank source. Live plane only; never imports from offline scripts.
 */
import questionBank from "@/context/behavioural/question_bank.json";
import type { BehaviouralQuestion } from "@/lib/types";
import {
  generateQuestions,
  selectFocusedQuestions,
  type BehaviouralContext,
  type BehaviouralSessionMode,
} from "@/lib/behavioural/question-gen";

/** The authored bank, in interview-arc order. */
export const BEHAVIOURAL_QUESTION_BANK: BehaviouralQuestion[] = (
  questionBank as { questions: BehaviouralQuestion[] }
).questions;

/** Exact number of questions a Focused Session asks. */
export const FOCUSED_SESSION_QUESTION_COUNT = 5;

/**
 * How many questions a Full Session can ask, derived from the bank itself: every
 * unconditional question always runs, and each conditional one (currently only
 * "industry") adds one more when its context is present and non-redundant.
 *
 * Preflight copy uses this because the exact figure depends on the parsed JD
 * domain, and parsing a JD in the browser would pull the O*NET taxonomy into the
 * client bundle. The live "Question X of N" counters remain exact.
 */
export function behaviouralFullSessionRange(
  bank: BehaviouralQuestion[] = BEHAVIOURAL_QUESTION_BANK,
): { min: number; max: number } {
  return {
    min: bank.filter((q) => !q.conditional).length,
    max: bank.length,
  };
}

/**
 * The number of questions a session will actually ask for this mode and context.
 * Derived by running the real selection, so preflight copy can never drift from
 * what the interview asks: Focused is always 5, Full is 13 or 14 depending on
 * whether the conditional industry question survives for this target.
 */
export function behaviouralQuestionCount(
  mode: BehaviouralSessionMode,
  ctx: BehaviouralContext | null,
  bank: BehaviouralQuestion[] = BEHAVIOURAL_QUESTION_BANK,
): number {
  return mode === "focused"
    ? selectFocusedQuestions(bank, ctx).length
    : generateQuestions(bank, ctx).length;
}
