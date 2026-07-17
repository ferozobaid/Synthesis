/**
 * Post-call transcript → behavioural scoring.
 *
 * Vapi owns the live conversation; after the call we receive the full transcript
 * (artifact.messages) and score it here with the EXISTING behavioural engine.
 * This module is pure/live-plane and never imports from /scripts.
 *
 * Mapping is a lexical, order-preserving walk (never quality-based):
 *  - candidate turns BEFORE the first recognised question are discarded (greetings,
 *    small talk, meta-comments);
 *  - an assistant turn advances the question index only when it lexically matches
 *    the NEXT-or-later question above threshold — acknowledgements, repeats of the
 *    current question, and clarifications do NOT advance;
 *  - candidate turns accumulate to the current question;
 *  - a positional fallback (lower confidence) is used only when no question
 *    boundary is recognised at all; partial calls must stay partial rather than
 *    being treated as failed full-session mappings.
 */
import { containment } from "@/lib/text";
import { retrieveAnswer } from "@/lib/rag";
import { evaluateBehavioural } from "@/lib/behavioural/evaluator";
import { buildBehaviouralQualitativeReport } from "@/lib/behavioural/qualitative";
import {
  summarizeBehavioural,
  DEFAULT_USER_ID,
  RELEVANCE_THRESHOLD,
  type BehaviouralSummary,
} from "@/lib/behavioural/runner";
import type { AnswerBankEntry, BehaviouralScore, BehaviouralSession } from "@/lib/types";

/** A single artifact/transcript turn. Vapi's artifact.messages use `message` +
 *  roles "bot" | "user" | "system"; some shapes carry `transcript` instead. */
export interface TranscriptMessage {
  role?: string;
  message?: string;
  transcript?: string;
}

export interface OrderedQuestion {
  id: string;
  question: string;
  competency?: string;
  type?: string;
  source?: string;
  fallback_company?: string;
}

export type MappingConfidence = "high" | "low" | "none";

export interface MappedAnswer {
  questionId: string;
  question: string;
  answer: string;
  confidence: MappingConfidence;
  competency?: string;
  type?: string;
  source?: string;
  fallback_company?: string;
}

export interface TranscriptMapping {
  mapped: MappedAnswer[];
  unansweredQuestionIds: string[];
  usedPositionalFallback: boolean;
}

/** A spoken assistant line must contain at least this fraction of the NEXT
 *  question's salient tokens to count as "the assistant is now asking it". */
export const QUESTION_MATCH_THRESHOLD = 0.6;
/** A stronger bar to accept a forward SKIP (assistant jumped past a question),
 *  so greetings/acks that merely echo a role/keyword don't advance the index. */
export const QUESTION_SKIP_THRESHOLD = 0.8;

function roleKind(role: string | undefined): "assistant" | "user" | "other" {
  const r = (role ?? "").toLowerCase();
  if (r === "bot" || r === "assistant") return "assistant";
  if (r === "user" || r === "customer") return "user";
  return "other";
}

function textOf(m: TranscriptMessage): string {
  const t =
    typeof m.message === "string"
      ? m.message
      : typeof m.transcript === "string"
        ? m.transcript
        : "";
  return t.trim();
}

/**
 * Order-aware match of a spoken assistant line to the NEXT question the assistant
 * should be asking. Prefers the immediate next question at the normal threshold;
 * only accepts a jump to a later question at the higher skip threshold. Returns
 * the matched index (> currentQ) or -1 (greeting / ack / clarification / repeat).
 */
export function nextQuestionIndex(
  spoken: string,
  questions: OrderedQuestion[],
  currentQ: number,
): number {
  const nextIdx = currentQ + 1;
  if (nextIdx >= questions.length) return -1;
  if (containment(questions[nextIdx].question, spoken) >= QUESTION_MATCH_THRESHOLD) {
    return nextIdx;
  }
  let best = -1;
  let bestScore = 0;
  for (let i = nextIdx + 1; i < questions.length; i++) {
    const score = containment(questions[i].question, spoken);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= QUESTION_SKIP_THRESHOLD ? best : -1;
}

export function mapTranscriptToQuestions(
  questions: OrderedQuestion[],
  messages: TranscriptMessage[],
): TranscriptMapping {
  const buffers: string[][] = questions.map(() => []);
  const matched = new Set<number>();
  let currentQ = -1;

  for (const m of messages) {
    const kind = roleKind(m.role);
    const text = textOf(m);
    if (!text) continue;
    if (kind === "assistant") {
      const idx = nextQuestionIndex(text, questions, currentQ);
      if (idx > currentQ) {
        currentQ = idx;
        matched.add(idx);
      }
      // else: greeting / acknowledgement / repeat / clarification → no advance
    } else if (kind === "user") {
      if (currentQ >= 0) buffers[currentQ].push(text);
      // else: pre-first-question small talk → discarded
    }
  }

  // Positional fallback only when lexical matching recognised no question
  // boundary. A short early-ended call may legitimately match only the first few
  // questions; falling back there can fabricate answers for skipped questions.
  let usedPositionalFallback = false;
  const userTexts = messages
    .filter((m) => roleKind(m.role) === "user")
    .map(textOf)
    .filter(Boolean);
  if (matched.size === 0 && userTexts.length > 0) {
    usedPositionalFallback = true;
    for (let i = 0; i < buffers.length; i++) buffers[i] = [];
    for (let i = 0; i < userTexts.length && i < questions.length; i++) {
      buffers[i].push(userTexts[i]);
    }
  }

  const mapped: MappedAnswer[] = questions.map((q, i) => {
    const answer = buffers[i].join(" ").trim();
    const confidence: MappingConfidence = !answer
      ? "none"
      : usedPositionalFallback
        ? "low"
        : matched.has(i)
          ? "high"
          : "low";
    return {
      questionId: q.id,
      question: q.question,
      answer,
      confidence,
      competency: q.competency,
      type: q.type,
      source: q.source,
      fallback_company: q.fallback_company,
    };
  });

  const unansweredQuestionIds = mapped.filter((a) => !a.answer).map((a) => a.questionId);
  return { mapped, unansweredQuestionIds, usedPositionalFallback };
}

export interface TranscriptScoreResult {
  session: BehaviouralSession;
  report: BehaviouralSummary;
  mapping: TranscriptMapping;
}

/** Bounded-concurrency map — caps in-flight model calls during scoring. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Map + score a full transcript. Reuses `retrieveAnswer` + `evaluateBehavioural`
 * per answered question and `summarizeBehavioural` for the aggregate report.
 * Unanswered questions are left unscored (never fabricated).
 */
export async function scoreTranscript(
  questions: OrderedQuestion[],
  messages: TranscriptMessage[],
  bank: AnswerBankEntry[],
  opts?: { sessionId?: string; userId?: string; concurrency?: number },
): Promise<TranscriptScoreResult> {
  const mapping = mapTranscriptToQuestions(questions, messages);
  const answered = mapping.mapped.filter((a) => a.answer);

  const scored = await mapLimit(answered, opts?.concurrency ?? 3, async (a) => {
    const matches = await retrieveAnswer(a.question, bank, 1);
    const top = matches[0];
    const prepared = top && top.score >= RELEVANCE_THRESHOLD ? top.item : null;
    const score = await evaluateBehavioural(a.question, a.answer, prepared, {
      id: a.questionId,
      question: a.question,
      competency: a.competency,
      type: a.type,
      source: a.source,
      fallback_company: a.fallback_company,
    });
    return [a.questionId, score] as const;
  });

  const scores: Record<string, BehaviouralScore> = {};
  for (const [qid, score] of scored) scores[qid] = score;

  const session: BehaviouralSession = {
    id: opts?.sessionId ?? "voice-report",
    user_id: opts?.userId ?? DEFAULT_USER_ID,
    jd_id: null,
    questions_asked: questions.map((q) => ({
      question_id: q.id,
      question: q.question,
      competency: q.competency,
      type: q.type,
      source: q.source,
      fallback_company: q.fallback_company,
    })),
    scores,
    feedback: null,
    created_at: new Date().toISOString(),
  };

  const report = summarizeBehavioural(session);
  const qualitative = await buildBehaviouralQualitativeReport({
    mapping,
    scores,
    dimensionAverages: report.dimension_averages,
    totalQuestions: questions.length,
  });
  return { session: report.session, report: { ...report, qualitative }, mapping };
}
