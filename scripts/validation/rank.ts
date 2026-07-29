/**
 * Family-score normalization for code Fit validation - OFFLINE PLANE ONLY.
 *
 * Code validation compares one resume across several JD families. It
 * independently min-max normalizes the structured and semantic family-average
 * score maps before blending them. This is intentionally different from the
 * production and 54-pair workflows, which blend raw scores for one resume-JD
 * pair.
 */

/** Min-max normalize one family-score map into 0..1. */
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

/** Blend independently normalized structured and semantic family-score maps. */
export function combine(
  structured: Record<string, number>,
  semantic: Record<string, number>,
  structuredWeight: number,
): Record<string, number> {
  const normalizedStructured = minMax(structured);
  const normalizedSemantic = minMax(semantic);
  const out: Record<string, number> = {};
  for (
    const family of new Set([
      ...Object.keys(normalizedStructured),
      ...Object.keys(normalizedSemantic),
    ])
  ) {
    out[family] =
      structuredWeight * (normalizedStructured[family] ?? 0) +
      (1 - structuredWeight) * (normalizedSemantic[family] ?? 0);
  }
  return out;
}
