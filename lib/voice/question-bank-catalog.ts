/**
 * Client-safe question-bank presentation catalog.
 *
 * Contains ONLY question ids, titles, and order for the technical rounds — never
 * scenarios, target elements, rubrics, answer keys, or red flags. This is the
 * client-safe counterpart to the server-only lib/voice/question-bank.ts loader,
 * so a client component (CaseNativeVoiceInterview.tsx) can label per-question
 * score rows by title without bundling any protected evaluation material.
 *
 * Keep in sync with context/technical/*.json; a test asserts the ids/titles match.
 */

export interface QuestionBankCatalogEntry {
  id: string;
  title: string;
  order: number;
}

export const QUESTION_BANK_CATALOG: Readonly<Record<string, readonly QuestionBankCatalogEntry[]>> = {
  data_analyst_technical_round: [
    { id: "da_monthly_revenue_sql", title: "Monthly Revenue Query", order: 1 },
    { id: "da_conversion_metric", title: "Conversion Rate Definition", order: 2 },
    { id: "da_sales_dashboard", title: "Weekly Sales Dashboard", order: 3 },
    { id: "da_active_users_drop", title: "Regional Active-User Drop", order: 4 },
    { id: "da_checkout_ab_test", title: "Checkout Experiment Result", order: 5 },
  ],
  data_engineer_technical_round: [
    { id: "de_sales_dimensional_model", title: "Simple Sales Data Model", order: 1 },
    { id: "de_multisource_pipeline", title: "Daily Multi-Source Pipeline", order: 2 },
    { id: "de_revenue_drop_incident", title: "Revenue Drop Check", order: 3 },
    { id: "de_pipeline_runtime_regression", title: "Pipeline Slowdown", order: 4 },
    { id: "de_schema_drift", title: "Unexpected Schema Change", order: 5 },
  ],
};

/** All question id -> title pairs across every bank (client-safe labels). */
export const QUESTION_BANK_TITLE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(QUESTION_BANK_CATALOG).flatMap((entries) => entries.map((e) => [e.id, e.title] as const)),
);

/** Human title for a question id, or a humanized fallback. */
export function questionBankTitle(questionId: string): string {
  return (
    QUESTION_BANK_TITLE[questionId] ??
    questionId.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
  );
}
