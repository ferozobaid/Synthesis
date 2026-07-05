/**
 * Behavioural question generation. Takes the authored question bank
 * (context/behavioural/question_bank.json) and the parsed JD, and fills the
 * dynamic questions — notably "why this company" (JD company) and "why this role"
 * (JD role title). Falls back to the bank's generic phrasing when no JD is present.
 *
 * Pure + deterministic. Live plane only; never imports from offline scripts.
 */
import type { BehaviouralQuestion, JDRequirements } from "@/lib/types";

/** Fill a single question's dynamic placeholders from the parsed JD (if any). */
export function fillDynamic(
  q: BehaviouralQuestion,
  jd: JDRequirements | null,
): BehaviouralQuestion {
  const company = jd?.company || q.fallback_company || "this company";

  // "Why this company" — authored with a {{company}} placeholder.
  let question = q.question.replace(/\{\{\s*company\s*\}\}/gi, company);

  // "Why this role" — sharpen the generic phrasing with the JD's role title when known.
  if (q.id === "why_this_role" && jd?.role_title) {
    question = `Why are you interested in the ${jd.role_title} role?`;
  }

  return question === q.question ? q : { ...q, question };
}

/**
 * Build the session's question set from the bank, filling dynamic questions from
 * the parsed JD. Returns the bank order unchanged (the UI/runner step through it).
 */
export function generateQuestions(
  bank: BehaviouralQuestion[],
  jd: JDRequirements | null,
): BehaviouralQuestion[] {
  return bank.map((q) => fillDynamic(q, jd));
}
