/**
 * Score → verdict helpers shared across module result screens.
 * Pure functions, no React.
 */

/** Scale a 0..5 rubric score into the 0..100 readiness range. */
export function to100(score: number): number {
  return Math.round(Math.max(0, Math.min(5, score)) * 20);
}

export interface VerdictBand {
  label: string;
  /** CSS var reference for the accent color of this band. */
  color: string;
  tintBg: string;
}

/** Map a 0..100 score to a readiness band (color + short label). */
export function readinessBand(score: number): VerdictBand {
  if (score >= 80)
    return { label: "Interview-ready", color: "var(--success)", tintBg: "var(--success-tint)" };
  if (score >= 65)
    return { label: "Likely fit with focused prep", color: "var(--accent)", tintBg: "var(--accent-tint)" };
  if (score >= 45)
    return { label: "Developing — close key gaps", color: "var(--partial)", tintBg: "var(--partial-tint)" };
  return { label: "Early — foundational work needed", color: "var(--gap)", tintBg: "var(--gap-tint)" };
}

/** One-sentence plain-language verdict for a fit score. */
export function fitVerdict(score: number, matched: number, gaps: number): string {
  if (score >= 80)
    return `Strong match for this role — you clearly meet most requirements. Tighten ${gaps || "a few"} finer points and you're interview-ready.`;
  if (score >= 65)
    return `A likely fit with focused prep. You cover the core of the role; closing ${gaps || "your remaining"} gap${gaps === 1 ? "" : "s"} is what stands between you and a confident interview.`;
  if (score >= 45)
    return `Partial fit. You match ${matched || "several"} requirement${matched === 1 ? "" : "s"}, but a few essentials need evidence before this role is within reach.`;
  return `Early fit. Several core requirements aren't yet evidenced in your resume — focus there before interviewing for this role.`;
}

/** Status → display color for fit per-requirement rows. */
export function statusColor(status: "matched" | "partial" | "missing"): {
  color: string;
  tint: string;
  glyph: string;
  label: string;
} {
  switch (status) {
    case "matched":
      return { color: "var(--success)", tint: "var(--success-tint)", glyph: "✓", label: "Matched" };
    case "partial":
      return { color: "var(--partial)", tint: "var(--partial-tint)", glyph: "◐", label: "Partial" };
    case "missing":
      return { color: "var(--gap)", tint: "var(--gap-tint)", glyph: "○", label: "Missing" };
  }
}
