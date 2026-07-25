/**
 * Server-only loader for the technical question banks.
 *
 * Loads the committed bank JSON (which carries answer keys, rubrics, and red
 * flags) and validates its structural invariants at access time. This module must
 * never be imported by a client component — it would bundle protected evaluation
 * material into the browser. Client code uses lib/voice/question-bank-catalog.ts
 * (titles only) instead.
 */
import dataAnalystBank from "@/context/technical/data_analyst.json";
import dataEngineerBank from "@/context/technical/data_engineer.json";
import type { QuestionBank, QuestionBankQuestion, QuestionBankRole } from "@/lib/voice/question-bank-types";

/** Case id -> bank role. The only place this mapping is defined. */
const CASE_ID_TO_ROLE: Readonly<Record<string, QuestionBankRole>> = {
  data_analyst_technical_round: "data_analyst",
  data_engineer_technical_round: "data_engineer",
};

const BANKS: Readonly<Record<QuestionBankRole, QuestionBank>> = {
  data_analyst: dataAnalystBank as unknown as QuestionBank,
  data_engineer: dataEngineerBank as unknown as QuestionBank,
};

export interface QuestionBankValidationIssue {
  code: string;
  detail: string;
}

/**
 * Structural validation of a bank. Returns every issue found (empty = valid) so
 * tests can assert on the full set. `getQuestionBank` throws when any issue is
 * present, so a regressed bank fails closed instead of scoring incorrectly.
 */
export function validateQuestionBank(bank: QuestionBank): QuestionBankValidationIssue[] {
  const issues: QuestionBankValidationIssue[] = [];
  const push = (code: string, detail: string) => issues.push({ code, detail });

  if (bank.track !== "technical") push("track", `track must be "technical", got "${bank.track}"`);
  const questions = Array.isArray(bank.questions) ? bank.questions : [];
  if (bank.question_count !== questions.length) {
    push("question_count", `question_count ${bank.question_count} != ${questions.length} questions`);
  }
  const ids = questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) push("duplicate_id", `duplicate question ids in [${ids.join(", ")}]`);

  const order = Array.isArray(bank.default_order) ? bank.default_order : [];
  if ([...order].sort().join("|") !== [...ids].sort().join("|")) {
    push("default_order", "default_order must contain every question id exactly once");
  }
  for (const id of order) {
    if (!ids.includes(id)) push("default_order_ref", `default_order references unknown id "${id}"`);
  }

  const perWeight = bank.scoring?.per_question_weight ?? 0;
  if (questions.length > 0 && Math.abs(perWeight * questions.length - 1) > 1e-6) {
    push("scoring_weight", `per_question_weight ${perWeight} * ${questions.length} != 1`);
  }
  if (bank.scoring?.question_weighting !== "equal") {
    push("scoring_weighting", `question_weighting must be "equal"`);
  }

  for (const q of questions) {
    if (q.role !== bank.role) push("role", `question ${q.id} role "${q.role}" != bank role "${bank.role}"`);
    const dims = q.rubric?.dimensions ?? [];
    const wsum = dims.reduce((sum, d) => sum + (d.weight ?? 0), 0);
    if (Math.abs(wsum - 1) > 1e-6) push("rubric_weight", `question ${q.id} rubric weights sum to ${wsum} != 1`);
    for (const d of dims) {
      for (const key of ["1", "3", "5"]) {
        if (typeof d.anchors?.[key] !== "string" || !d.anchors[key].trim()) {
          push("rubric_anchor", `question ${q.id} dimension ${d.name} missing anchor ${key}`);
        }
      }
    }
    const teIds = new Set((q.target_elements ?? []).map((t) => t.id));
    if (teIds.size === 0) push("target_elements", `question ${q.id} has no target elements`);
    for (const probe of q.adaptive?.probes ?? []) {
      for (const ref of probe.target_element_ids ?? []) {
        if (!teIds.has(ref)) push("probe_ref", `question ${q.id} probe ${probe.id} references unknown target element "${ref}"`);
      }
    }
    if (!(q.answer_key?.strong_answer_outline?.length > 0)) {
      push("answer_key", `question ${q.id} missing strong_answer_outline`);
    }
    if (!Array.isArray(q.answer_key?.acceptable_alternatives)) push("answer_key", `question ${q.id} missing acceptable_alternatives`);
    if (!Array.isArray(q.answer_key?.red_flags)) push("answer_key", `question ${q.id} missing red_flags`);
  }
  return issues;
}

/** Roles that have a configured bank. */
export function questionBankRoles(): QuestionBankRole[] {
  return Object.keys(BANKS) as QuestionBankRole[];
}

/** True for a case id that maps to a question-bank round. */
export function isQuestionBankCaseId(caseId: string): boolean {
  return Object.prototype.hasOwnProperty.call(CASE_ID_TO_ROLE, caseId);
}

/** Bank role for a question-bank case id, or undefined. */
export function questionBankRoleForCase(caseId: string): QuestionBankRole | undefined {
  return CASE_ID_TO_ROLE[caseId];
}

/** Load and validate a bank by role. Throws on any structural issue (fails closed). */
export function getQuestionBank(role: QuestionBankRole): QuestionBank {
  const bank = BANKS[role];
  if (!bank) throw new Error(`unknown_question_bank_role:${role}`);
  const issues = validateQuestionBank(bank);
  if (issues.length > 0) {
    throw new Error(`invalid_question_bank:${role}:${issues.map((i) => i.code).join(",")}`);
  }
  return bank;
}

/** Load and validate the bank for a case id, or undefined for a non-bank case. */
export function getQuestionBankForCase(caseId: string): QuestionBank | undefined {
  const role = questionBankRoleForCase(caseId);
  return role ? getQuestionBank(role) : undefined;
}

/** Ordered question list (default_order) with question objects resolved. */
export function orderedQuestions(bank: QuestionBank): QuestionBankQuestion[] {
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  return bank.default_order.map((id) => byId.get(id)).filter((q): q is QuestionBankQuestion => Boolean(q));
}
