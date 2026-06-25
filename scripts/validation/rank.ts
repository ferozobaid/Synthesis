/**
 * Pure ranking helpers for the fit-scorer validation harness — OFFLINE PLANE.
 *
 * Deterministic, side-effect-free, and unit-tested (tests/validation-rank.test.ts).
 * Kept separate from score_resumes.ts so the scoring logic that feeds the headline
 * top-1/top-3 numbers is independently verifiable.
 */

export interface Ranked {
  family: string;
  score: number;
}

/** Stable descending rank: highest score first, ties broken by family name (a→z). */
export function rankDesc(scores: Record<string, number>): Ranked[] {
  return Object.entries(scores)
    .map(([family, score]) => ({ family, score }))
    .sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
}

/** Min-max normalize a score map into 0..1. All-equal maps collapse to 0.5. */
export function minMax(scores: Record<string, number>): Record<string, number> {
  const vals = Object.values(scores);
  if (vals.length === 0) return {};
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) out[k] = span === 0 ? 0.5 : (v - lo) / span;
  return out;
}

/**
 * Blend two score maps (the ablation's "combined" arm): min-max each arm so the
 * structured 0–100 scale and the embeddings cosine are comparable, then weight.
 * `wA` is the weight on `a` (structured); `b` (embeddings) gets `1 - wA`.
 */
export function combine(
  a: Record<string, number>,
  b: Record<string, number>,
  wA = 0.5,
): Record<string, number> {
  const na = minMax(a);
  const nb = minMax(b);
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(na), ...Object.keys(nb)])) {
    out[k] = wA * (na[k] ?? 0) + (1 - wA) * (nb[k] ?? 0);
  }
  return out;
}

/** The top-ranked family, or null for an empty map. */
export function top1(ranked: Ranked[]): string | null {
  return ranked.length ? ranked[0].family : null;
}

/** Whether `label` appears within the top-k of a ranking. */
export function inTopK(ranked: Ranked[], label: string, k: number): boolean {
  return ranked.slice(0, k).some((r) => r.family === label);
}
