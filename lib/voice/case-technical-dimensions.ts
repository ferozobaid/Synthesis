/**
 * Client-safe technical-evaluator dimension constants.
 *
 * Deliberately split out of lib/voice/case-technical-post-call-scorer.ts: that
 * module imports lib/claude.ts (the Anthropic SDK, which pulls in node:fs /
 * node:path), so importing it from a "use client" component breaks the browser
 * bundle. This module has zero server-only dependencies and is safe to import
 * from both the scorer (server) and CaseNativeVoiceInterview.tsx (client).
 */

/** The 10 technical system-design dimensions (fixed order = rubric order). */
export const TECHNICAL_DIMENSIONS = [
  "requirements_clarification",
  "pipeline_design",
  "etl_elt_strategy",
  "batch_streaming_tradeoffs",
  "storage_modeling",
  "scalability_performance",
  "reliability_fault_tolerance",
  "data_quality_deduplication",
  "observability_operations",
  "tradeoff_communication",
] as const;

export type TechnicalCaseDimension = (typeof TECHNICAL_DIMENSIONS)[number];

export const TECHNICAL_DIMENSION_COUNT = TECHNICAL_DIMENSIONS.length;

export const TECHNICAL_DIM_LABEL: Record<TechnicalCaseDimension, string> = {
  requirements_clarification: "Requirements clarification",
  pipeline_design: "End-to-end pipeline design",
  etl_elt_strategy: "ETL vs ELT understanding",
  batch_streaming_tradeoffs: "Batch vs streaming trade-offs",
  storage_modeling: "Storage & data modeling",
  scalability_performance: "Scalability & performance",
  reliability_fault_tolerance: "Reliability & fault tolerance",
  data_quality_deduplication: "Data quality & deduplication",
  observability_operations: "Observability, backfills & operations",
  tradeoff_communication: "Trade-off communication",
};
