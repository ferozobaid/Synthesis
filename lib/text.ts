/**
 * Tiny lexical helpers shared by the live plane (RAG re-rank + the behavioural
 * evaluator's key-point coverage). Deterministic and dependency-free so they work
 * identically in mock mode, where embeddings are non-semantic.
 */

/** Common English + interview-filler stopwords excluded from overlap scoring. */
export const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","so","because","as","of","at","by",
  "for","with","about","against","between","into","through","during","to","from",
  "in","on","up","down","out","over","under","again","further","is","are","was",
  "were","be","been","being","have","has","had","do","does","did","doing","i","me",
  "my","we","our","us","you","your","he","she","it","they","them","their","this",
  "that","these","those","what","which","who","whom","when","where","why","how",
  "all","any","both","each","few","more","most","some","such","no","nor","not",
  "only","own","same","than","too","very","can","will","just","would","could",
  "should","time","team","work","really","like","got","get","also","much","many",
]);

/** Lowercase word tokens of length ≥3 with stopwords removed. */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9'-]*/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

/** Unique-token Jaccard overlap of two strings in [0,1]. */
export function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Containment of `reference`'s meaningful tokens inside `candidate`, in [0,1] —
 * "how much of the reference did the candidate cover" (recall-oriented). Used for
 * key-point coverage of a prepared answer by the live response.
 */
export function containment(reference: string, candidate: string): number {
  const ref = new Set(tokenize(reference));
  const cand = new Set(tokenize(candidate));
  if (ref.size === 0) return 0;
  let inter = 0;
  for (const t of ref) if (cand.has(t)) inter++;
  return inter / ref.size;
}
