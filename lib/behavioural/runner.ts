/**
 * Behavioural session orchestration — the async layer that ties question
 * generation, RAG retrieval of the candidate's prepared answer, and the evaluator
 * together. Kept out of the route handler so a whole session is testable without
 * HTTP (mirrors lib/fsm/case-runner.ts).
 *
 * Flow: startBehavioural (parse JD → generate questions incl. "why this company" →
 * new session) → respondToBehavioural per answer (retrieve matched prepared answer →
 * evaluate → record) → summarizeBehavioural (aggregate across answered questions).
 *
 * Live plane only. Never imports from /scripts or /n8n.
 */
import { useMocks } from "@/lib/config";
import { parseJD } from "@/lib/parsers/jd-parser";
import { retrieveAnswer } from "@/lib/rag";
import { generateQuestions } from "@/lib/behavioural/question-gen";
import { evaluateBehavioural } from "@/lib/behavioural/evaluator";
import type {
  AnswerBankEntry,
  BehaviouralQuestion,
  BehaviouralScore,
  BehaviouralSession,
} from "@/lib/types";

export const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000000";

/** A retrieval below this blended relevance is treated as "no match" (graceful degradation). */
export const RELEVANCE_THRESHOLD = 0.1;

export interface BehaviouralStartResult {
  session: BehaviouralSession;
  questions: BehaviouralQuestion[];
  jd: { company: string | null; role_title: string | null } | null;
  mock: boolean;
}

export interface BehaviouralTurnResult {
  session: BehaviouralSession;
  /** Score of the answer just submitted (same shape in mock and real modes). */
  score: BehaviouralScore;
  /** The prepared answer this response was scored against (null on graceful degradation). */
  matched_answer: { id: string; question: string } | null;
  match_score: number | null;
  mock: boolean;
}

export interface BehaviouralSummary {
  session: BehaviouralSession;
  overall: number;
  dimension_averages: { dimension: string; average: number }[];
  answered: number;
  feedback: { summary: string; next_focus: string[] };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function newSessionId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `bsess-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/**
 * Start a session: parse the JD (if any), generate the question set (filling
 * "why this company / why this role" from the JD), and create a new session.
 */
export function startBehavioural(opts: {
  questionBank: BehaviouralQuestion[];
  jdText?: string;
  userId?: string;
}): BehaviouralStartResult {
  const jd = opts.jdText && opts.jdText.trim() ? parseJD(opts.jdText) : null;
  const questions = generateQuestions(opts.questionBank, jd);

  const session: BehaviouralSession = {
    id: newSessionId(),
    user_id: opts.userId ?? DEFAULT_USER_ID,
    jd_id: null,
    questions_asked: questions.map((q) => ({ question_id: q.id, question: q.question })),
    scores: {},
    feedback: null,
    created_at: new Date().toISOString(),
  };

  return {
    session,
    questions,
    jd: jd ? { company: jd.company, role_title: jd.role_title } : null,
    mock: useMocks(),
  };
}

/**
 * Evaluate one response: retrieve the candidate's best-matching prepared answer,
 * score the response against it, and record the score on the session. Degrades
 * gracefully (prepared = null) when retrieval returns nothing relevant.
 */
export async function respondToBehavioural(
  session: BehaviouralSession,
  questionId: string,
  answer: string,
  bank: AnswerBankEntry[],
): Promise<BehaviouralTurnResult> {
  const asked = session.questions_asked?.find((q) => q.question_id === questionId);
  const questionText = asked?.question ?? questionId;

  const matches = await retrieveAnswer(questionText, bank, 1);
  const top = matches[0];
  const relevant = !!top && top.score >= RELEVANCE_THRESHOLD;
  const prepared = relevant ? top.item : null;

  const score = await evaluateBehavioural(questionText, answer, prepared);

  const updated: BehaviouralSession = {
    ...session,
    scores: { ...(session.scores ?? {}), [questionId]: score },
  };

  return {
    session: updated,
    score,
    matched_answer: prepared ? { id: prepared.id, question: prepared.question } : null,
    match_score: relevant && top ? Number(top.score.toFixed(3)) : null,
    mock: useMocks(),
  };
}

/** Aggregate scores across the answered questions into a session summary. */
export function summarizeBehavioural(session: BehaviouralSession): BehaviouralSummary {
  const scores = Object.values(session.scores ?? {});
  const answered = scores.length;

  const sums = new Map<string, { total: number; n: number }>();
  for (const s of scores) {
    for (const d of s.dimension_scores) {
      const cur = sums.get(d.dimension) ?? { total: 0, n: 0 };
      cur.total += d.score;
      cur.n += 1;
      sums.set(d.dimension, cur);
    }
  }
  const dimension_averages = [...sums.entries()].map(([dimension, { total, n }]) => ({
    dimension,
    average: round1(total / Math.max(1, n)),
  }));

  const overall = answered ? round1(scores.reduce((a, s) => a + s.overall, 0) / answered) : 0;

  const next_focus = [...dimension_averages]
    .sort((a, b) => a.average - b.average)
    .filter((d) => d.average < 4)
    .slice(0, 2)
    .map((d) => d.dimension);

  const summary = answered
    ? `Across ${answered} answer${answered === 1 ? "" : "s"} you averaged ${overall}/5. ` +
      (next_focus.length ? `Focus next on ${next_focus.join(" and ")}.` : "Strong across the board — keep it up.")
    : "No answers scored yet.";

  const feedback = { summary, next_focus };
  return {
    session: { ...session, feedback },
    overall,
    dimension_averages,
    answered,
    feedback,
  };
}
