/**
 * Retrieval interface (pgvector cosine). Enforces the PRE-FETCH pattern: callers
 * retrieve context once at request entry — for the case module, only at case load and
 * stage transitions — never mid-stream.
 *
 * Production path is a Supabase pgvector RPC (`match_*` on an HNSW cosine index). Here
 * we expose an in-memory top-k so the same ranking logic is testable and works on mocks.
 */
import type { AnswerBankEntry, Embedding } from "@/lib/types";
import { cosine, embed } from "@/lib/embeddings";

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
  const q = await embed(question, { query: true });

  const precomputed = bank
    .filter((b) => b.embedding && b.embedding.length > 0)
    .map((b) => ({ item: b, embedding: b.embedding as Embedding }));

  if (precomputed.length === bank.length && bank.length > 0) {
    return topK(q, precomputed, k);
  }

  const embedded = await Promise.all(
    bank.map(async (b) => ({
      item: b,
      embedding: await embed(`${b.question} ${b.situation} ${b.task} ${b.action} ${b.result}`),
    })),
  );
  return topK(q, embedded, k);
}
