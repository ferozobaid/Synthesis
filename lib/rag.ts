/**
 * Retrieval interface (pgvector cosine). Enforces the PRE-FETCH pattern: callers
 * retrieve context once at request entry — for the case module, only at case load and
 * stage transitions — never mid-stream.
 *
 * Production path is a Supabase pgvector RPC (`match_*` on an HNSW cosine index). Here
 * we expose an in-memory top-k so the same ranking logic is testable and works on mocks.
 */
import type {
  AnswerBankEntry,
  CaseExhibit,
  CaseRecord,
  CaseState,
  Embedding,
} from "@/lib/types";
import { cosine, embed } from "@/lib/embeddings";
import { embeddingsEnabled } from "@/lib/config";
import { containment, jaccard } from "@/lib/text";
import { getStage, pendingExhibits } from "@/lib/fsm/case-fsm";

export interface Retrieved<T> {
  item: T;
  score: number;
}

/** Top-k cosine over a candidate set that already has embeddings. */
export function topK<T>(
  queryVec: Embedding,
  candidates: { item: T; embedding: Embedding }[],
  k = 3,
): Retrieved<T>[] {
  return candidates
    .map((c) => ({ item: c.item, score: cosine(queryVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Retrieve the user's best-matching prepared STAR answer(s) for a behavioural question.
 * Pre-fetched once per question (never per token). Uses precomputed embeddings when
 * present; otherwise embeds the bank on the fly (dev/seed path).
 */
export async function retrieveAnswer(
  question: string,
  bank: AnswerBankEntry[],
  k = 1,
): Promise<Retrieved<AnswerBankEntry>[]> {
  if (bank.length === 0) return [];

  // Mock mode: the embeddings are a non-semantic hash, so cosine ranking is noise.
  // Rank lexically instead — primarily the query question against each entry's own
  // question, with a smaller tags/STAR contribution. Deterministic and topical.
  if (!embeddingsEnabled()) {
    return bank
      .map((item) => {
        const score =
          0.7 * containment(question, item.question) +
          0.3 *
            jaccard(
              question,
              `${item.tags.join(" ")} ${item.situation} ${item.task} ${item.action} ${item.result}`,
            );
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  // Real semantic embeddings → cosine top-k (production path). Uses precomputed
  // embeddings when present; otherwise embeds the bank on the fly (dev/seed path).
  const q = await embed(question, { query: true });
  const allPrecomputed = bank.every((b) => b.embedding && b.embedding.length > 0);
  const candidates = await Promise.all(
    bank.map(async (b) => ({
      item: b,
      embedding:
        allPrecomputed && b.embedding
          ? (b.embedding as Embedding)
          : await embed(`${b.question} ${b.situation} ${b.task} ${b.action} ${b.result}`),
    })),
  );
  return topK(q, candidates, k);
}

// =========================== Case pre-fetch =========================== //
//
// CLAUDE.md mandates RAG pre-fetch for the case module at case LOAD and at each
// STAGE TRANSITION only — never mid-response. `prefetchCaseStage` assembles the
// next stage's context (objective, prompts, the exhibit that will drip, the hint
// ladder) so it is ready before the candidate replies, and ranks the case's
// exhibit insights by cosine similarity to the stage — the same pgvector-style
// top-k path used for behavioural retrieval, here over in-memory case content.

export interface StageContext {
  stage: CaseState;
  objective: string;
  interviewer_prompt: string;
  advance_criteria: string;
  target_elements: string[];
  hint_ladder: string[];
  /** The next exhibit that will be revealed at this stage (already-revealed excluded). */
  pending_exhibit: CaseExhibit | null;
  /** Top-k exhibit insights most relevant to this stage (retrieved grounding). */
  grounding: string[];
}

/**
 * Pre-fetch everything the interviewer needs for `stage` before the user responds.
 * Pure read over the authored case + the retrieval interface; safe to call at case
 * load (stage="intro") and on each transition.
 */
export async function prefetchCaseStage(
  c: CaseRecord,
  stage: CaseState,
  revealed: string[] = [],
  k = 3,
): Promise<StageContext> {
  const s = getStage(c, stage);
  const pendingId = pendingExhibits(c, stage, revealed)[0];
  const pending_exhibit = pendingId ? c.exhibits.find((e) => e.id === pendingId) ?? null : null;

  const insights = c.exhibits.flatMap((e) => e.insights ?? []);
  let grounding: string[] = [];
  if (insights.length > 0) {
    const query = `${stage} ${s?.objective ?? ""} ${s?.advance_criteria ?? ""}`.trim();
    const q = await embed(query, { query: true });
    const candidates = await Promise.all(
      insights.map(async (text) => ({ item: text, embedding: await embed(text) })),
    );
    grounding = topK(q, candidates, k).map((r) => r.item);
  }

  return {
    stage,
    objective: s?.objective ?? "",
    interviewer_prompt: s?.interviewer_prompt ?? "",
    advance_criteria: s?.advance_criteria ?? "",
    target_elements: s?.target_elements ?? [],
    hint_ladder: s?.hint_ladder ?? [],
    pending_exhibit,
    grounding,
  };
}
