/**
 * Candidate-facing worked-solution schema — TYPES ONLY.
 *
 * This module deliberately contains no solution content, no rubrics, and no
 * case data. It exists so the client report component can type the worked
 * solution it renders (via `import type`, fully erased at build) WITHOUT ever
 * importing the server-only content registry. Keeping the shape here guarantees
 * that no worked-solution text can be pulled into the client bundle through a
 * shared import.
 *
 * The field names are intentionally candidate-facing ("framework", "analysis",
 * "calculations", "pressure test", "recommendation"). They never reference the
 * evaluator, answer key, scoring weights, or any internal solution architecture.
 */

/** One narrated arithmetic step of a worked calculation. */
export interface WorkedSolutionCalculationStep {
  label: string;
  expression: string;
  result: string;
}

/** A prose section: a heading and an ordered list of bullet points. */
export interface WorkedSolutionProseSection {
  heading: string;
  points: string[];
}

/** A calculation section: a heading and an ordered list of narrated steps. */
export interface WorkedSolutionCalculationSection {
  heading: string;
  steps: WorkedSolutionCalculationStep[];
}

/**
 * The strict, versioned candidate-facing worked-solution projection. This is the
 * only shape the protected solution endpoint ever returns. It carries exactly the
 * five required sections plus the identifying and disclaimer metadata.
 */
export interface CaseWorkedSolutionView {
  /** Deterministic content version for this authored solution. */
  version: string;
  caseId: string;
  caseTitle: string;
  /** Framing shown to the candidate: one strong approach, not the only answer. */
  disclaimer: string;
  /** 1. Strong framework. */
  framework: WorkedSolutionProseSection;
  /** 2. Analysis approach. */
  analysisApproach: WorkedSolutionProseSection;
  /** 3. Step-by-step calculations. */
  calculations: WorkedSolutionCalculationSection;
  /** 4. Pressure-test calculation. */
  pressureTest: WorkedSolutionCalculationSection;
  /** 5. Example recommendation. */
  exampleRecommendation: WorkedSolutionProseSection;
}

/** Shared disclaimer string for every candidate-facing worked solution. */
export const WORKED_SOLUTION_DISCLAIMER =
  "This is one strong approach, not the only valid answer.";
