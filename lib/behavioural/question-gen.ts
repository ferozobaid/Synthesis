/**
 * Behavioural question generation. Takes the authored question bank
 * (context/behavioural/question_bank.json) and the resolved interview context
 * (target role, company, industry) and produces the ordered session question set:
 *
 *  - "role_motivation": role/function-aware wording (deterministic templates),
 *    stable id/type regardless of the spoken wording;
 *  - "why_this_company": fills {{company}};
 *  - "industry_motivation": conditional — filled with {{industry}} and kept only
 *    when a distinct industry is known and non-redundant; otherwise dropped.
 *
 * Pure + deterministic. Live plane only; never imports from offline scripts.
 */
import type { BehaviouralQuestion, JDRequirements } from "@/lib/types";
import {
  roleMotivationQuestion,
  roleFamilyLabel,
  shouldAskIndustry,
  industryMotivationQuestion,
} from "@/lib/behavioural/role-context";

/** Resolved interview context that drives dynamic question wording. */
export interface BehaviouralContext {
  /** Target role title, e.g. "Data Analyst". */
  role?: string | null;
  /** Target company, e.g. "National Bank of Canada". */
  company?: string | null;
  /** Industry / domain, e.g. "banking". */
  industry?: string | null;
}

/** Build a context from a parsed JD (used when no explicit target is supplied). */
export function contextFromJD(jd: JDRequirements | null): BehaviouralContext {
  return {
    role: jd?.role_title ?? null,
    company: jd?.company ?? null,
    industry: jd?.domain ?? null,
  };
}

/** Fill a single question's dynamic wording from the interview context. */
export function fillDynamic(
  q: BehaviouralQuestion,
  ctx: BehaviouralContext,
): BehaviouralQuestion {
  // Role / professional-function motivation — role-aware wording, stable identity.
  if (q.id === "role_motivation") {
    const question = roleMotivationQuestion(ctx.role, ctx.industry);
    return question === q.question ? q : { ...q, question };
  }

  // Industry motivation — fill {{industry}} when present (dropping is handled by
  // generateQuestions; this only rewrites wording).
  if (q.id === "industry_motivation") {
    if (!ctx.industry) return q;
    const question = industryMotivationQuestion(ctx.industry);
    return question === q.question ? q : { ...q, question };
  }

  // "Why this company" — authored with a {{company}} placeholder.
  const company = ctx.company || q.fallback_company || "this company";
  const question = q.question.replace(/\{\{\s*company\s*\}\}/gi, company);
  return question === q.question ? q : { ...q, question };
}

/**
 * Build the session's question set from the bank, filling dynamic questions from
 * the interview context. Order is preserved. Conditional questions (currently
 * only "industry") are dropped when their context is absent or redundant, so the
 * candidate is never asked a repetitive or empty motivation question.
 */
export function generateQuestions(
  bank: BehaviouralQuestion[],
  ctx: BehaviouralContext | JDRequirements | null,
): BehaviouralQuestion[] {
  const context = normalizeContext(ctx);
  const roleFamily = roleFamilyLabel(context.role, context.industry);

  return bank
    .filter((q) => {
      if (q.conditional === "industry") {
        return shouldAskIndustry(context.industry, {
          roleFamily,
          company: context.company,
          role: context.role,
        });
      }
      return true;
    })
    .map((q) => fillDynamic(q, context));
}

/** Accept either an already-resolved context or a raw parsed JD (back-compat). */
function normalizeContext(ctx: BehaviouralContext | JDRequirements | null): BehaviouralContext {
  if (!ctx) return {};
  if ("role_title" in ctx || "must_have" in ctx) {
    return contextFromJD(ctx as JDRequirements);
  }
  return ctx as BehaviouralContext;
}
