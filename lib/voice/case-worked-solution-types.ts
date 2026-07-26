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
 * One question's candidate-facing worked answer, used by the fixed-question
 * technical rounds where a single narrative would not map onto five independent
 * questions.
 *
 * `questionId` is the same public question id the report's per-question score
 * rows use, so the UI can align them. It carries authored candidate prose only —
 * never a target element, rubric dimension, scoring anchor, acceptable
 * alternative, or red flag.
 */
export interface WorkedSolutionQuestionSection {
  questionId: string;
  title: string;
  points: string[];
}

/**
 * The strict, versioned candidate-facing worked-solution projection. This is the
 * only shape the protected solution endpoint ever returns.
 *
 * The three prose sections and the disclaimer are always present. The two
 * calculation sections are optional because the fixed-question technical rounds
 * have no single case-wide arithmetic to narrate; `questions` is the optional
 * per-question form those rounds use instead. Consulting cases continue to carry
 * all five sections exactly as before.
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
  /** 3. Step-by-step calculations. Omitted when the case has none. */
  calculations?: WorkedSolutionCalculationSection;
  /** 4. Pressure-test calculation. Omitted when the case has none. */
  pressureTest?: WorkedSolutionCalculationSection;
  /**
   * Extra prose sections, rendered after the analysis approach. Used by cases
   * whose strong answer is narrative rather than arithmetic (for example the
   * system-design case's reliability and correctness discussion).
   */
  additionalSections?: WorkedSolutionProseSection[];
  /** 5. Example recommendation. */
  exampleRecommendation: WorkedSolutionProseSection;
  /** Per-question answers, present only for the fixed-question rounds. */
  questions?: WorkedSolutionQuestionSection[];
}

/** Shared disclaimer string for every candidate-facing worked solution. */
export const WORKED_SOLUTION_DISCLAIMER =
  "This is one strong approach, not the only valid answer.";
