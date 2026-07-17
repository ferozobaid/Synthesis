export type BehaviouralQuestionType =
  | "introduction"
  | "motivation_role_fit"
  | "company_fit"
  | "self_assessment"
  | "competency_star";

export interface BehaviouralQuestionClassificationInput {
  id?: string;
  question: string;
  type?: string;
  competency?: string;
  source?: string;
}

/**
 * Shared deterministic classifier for behavioural question families.
 * Prefer backend IDs/metadata over text so numeric and qualitative reports stay aligned.
 */
export function classifyBehaviouralQuestion(
  q: BehaviouralQuestionClassificationInput,
): BehaviouralQuestionType {
  const id = (q.id ?? "").toLowerCase();
  const type = (q.type ?? "").toLowerCase();
  const text = q.question.toLowerCase();
  const source = (q.source ?? "").toLowerCase();

  if (id === "tell_me_about_yourself") return "introduction";
  if (id === "why_this_company") return "company_fit";
  if (id === "why_this_role" || id === "why_consulting") return "motivation_role_fit";
  if (id === "greatest_strength") return "self_assessment";

  if (type === "intro" || type === "introduction") return "introduction";
  if (type === "company_fit") return "company_fit";
  if (type === "motivation_role_fit") return "motivation_role_fit";
  if (type === "self-assessment" || type === "self_assessment") return "self_assessment";
  if (type === "star" || type === "competency_star") return "competency_star";
  if (type === "motivation") {
    return source.includes("company") ? "company_fit" : "motivation_role_fit";
  }

  if (source.includes("company")) return "company_fit";

  if (/^tell me about yourself[.?]?$/.test(text)) return "introduction";
  if (/\bwhy\b.*\bwork at\b|\bthis company\b|\bcompany\b.*\bfit\b|\btenazx\b|\brevature\b/.test(text)) {
    return "company_fit";
  }
  if (/\bwhy\b.*\b(role|consulting)\b|\binterested\b.*\b(role|consulting)\b/.test(text)) {
    return "motivation_role_fit";
  }
  if (/\b(greatest strength|strengths|weakness|self[- ]assessment)\b/.test(text)) {
    return "self_assessment";
  }

  return "competency_star";
}
