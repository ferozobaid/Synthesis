/**
 * Client-safe catalog of the selectable Preview LLM cases.
 *
 * This module intentionally contains ONLY id, title, and description. It must
 * never carry prompts, clarification facts, exhibits, calculations, scoring
 * material, or any hidden answer. It is safe to import into client components
 * and to serialize verbatim through the read-only catalog endpoint.
 */
export interface PreviewLlmCaseCatalogEntry {
  id: string;
  title: string;
  description: string;
}

export const PREVIEW_LLM_CASES: readonly PreviewLlmCaseCatalogEntry[] = [
  {
    id: "airport_profitability",
    title: "Airport Profitability",
    description:
      "Advise a regional airport CEO on growing non-aeronautical revenue from 25% to 35% of total revenue within three years using data and AI.",
  },
  {
    id: "gcc_premium_gym_market_entry",
    title: "GCC Premium Gym Market Entry",
    description:
      "Assess whether a European premium gym chain should enter Saudi Arabia and the UAE, and determine the appropriate entry strategy.",
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
