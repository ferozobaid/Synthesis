/**
 * Client-safe catalog of the selectable Preview LLM cases.
 *
 * This module intentionally contains ONLY id, title, description, and
 * UI-classification metadata (track/role). It must never carry prompts,
 * clarification facts, exhibits, calculations, scoring material, or any
 * hidden answer. It is safe to import into client components and to
 * serialize verbatim through the read-only catalog endpoint.
 *
 * `track` and `role` classify a case for navigation only — they drive which
 * section of the picker a case appears under (Strategy vs Technical
 * Interviews → role) and carry no scoring or architecture meaning. The
 * evaluator/architecture routing (CaseRecord.evaluator_type,
 * case-native-config.ts) is entirely separate and untouched by this metadata.
 */
export type PreviewLlmCaseTrack = "strategy" | "technical";
export type PreviewLlmTechnicalRole = "data_engineering" | "data_analyst";

/** Authored difficulty. The ONLY per-case timing input. */
export type CaseDifficultyStars = 3 | 4 | 5;

/**
 * The single difficulty → duration mapping. Duration is always derived from a
 * case's star rating and is never authored per case, so a case can never carry a
 * difficulty and a duration that disagree.
 */
export const DIFFICULTY_DURATION_SECONDS: Readonly<Record<CaseDifficultyStars, number>> = {
  3: 600,
  4: 900,
  5: 1200,
} as const;

export interface PreviewLlmCaseCatalogEntry {
  id: string;
  title: string;
  description: string;
  track: PreviewLlmCaseTrack;
  /** Present only for track: "technical" entries. */
  role?: PreviewLlmTechnicalRole;
  /** Authored difficulty; the case's maximum duration derives from this alone. */
  difficultyStars: CaseDifficultyStars;
}

export const PREVIEW_LLM_CASES: readonly PreviewLlmCaseCatalogEntry[] = [
  {
    id: "airport_profitability",
    title: "Airport Profitability",
    description:
      "Advise a regional airport CEO on growing non-aeronautical revenue from 25% to 35% of total revenue within three years using data and AI.",
    track: "strategy",
    difficultyStars: 3,
  },
  {
    id: "gcc_premium_gym_market_entry",
    title: "GCC Premium Gym Market Entry",
    description:
      "Assess whether a European premium gym chain should enter Saudi Arabia and the UAE, and determine the appropriate entry strategy.",
    track: "strategy",
    difficultyStars: 4,
  },
  {
    id: "data_engineer_clickstream",
    title: "Clickstream Data Pipeline",
    description:
      "Design a near-real-time data pipeline to ingest, process, and aggregate user clickstream events at massive scale.",
    track: "technical",
    role: "data_engineering",
    difficultyStars: 5,
  },
  {
    id: "data_engineer_technical_round",
    title: "Data Engineer Technical Round",
    description:
      "Five short scenario questions on data modeling, batch pipelines, debugging, performance, and schema evolution.",
    track: "technical",
    role: "data_engineering",
    difficultyStars: 4,
  },
  {
    id: "data_analyst_technical_round",
    title: "Data Analyst Technical Round",
    description:
      "Five short scenario questions on SQL analysis, metric definition, dashboards, diagnostics, and experimentation.",
    track: "technical",
    role: "data_analyst",
    difficultyStars: 3,
  },
] as const;

const CATALOG_BY_ID = new Map(PREVIEW_LLM_CASES.map((entry) => [entry.id, entry]));

/** True only for an id present in the selectable Preview LLM catalog. */
export function isPreviewLlmCaseId(caseId: string): boolean {
  return CATALOG_BY_ID.has(caseId);
}

/** Candidate-safe catalog entry for a selectable case, or undefined. */
export function previewLlmCaseCatalogEntry(
  caseId: string,
): PreviewLlmCaseCatalogEntry | undefined {
  return CATALOG_BY_ID.get(caseId);
}

/** Maximum interview duration for a case, derived from its difficulty. */
export function caseMaxDurationSeconds(caseId: string): number | null {
  const entry = CATALOG_BY_ID.get(caseId);
  return entry ? DIFFICULTY_DURATION_SECONDS[entry.difficultyStars] : null;
}
