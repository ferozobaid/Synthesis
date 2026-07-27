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
import type {
  BehaviouralFocusFamily,
  BehaviouralQuestion,
  JDRequirements,
} from "@/lib/types";
import {
  roleMotivationQuestion,
  roleFamilyLabel,
  shouldAskIndustry,
  industryMotivationQuestion,
  focusFamilyPreference,
} from "@/lib/behavioural/role-context";

/**
 * Full  — the existing role-aware 13–14 question interview, unchanged.
 * Focused — exactly one balanced question per coverage family (5 total).
 */
export type BehaviouralSessionMode = "full" | "focused";

/** Coverage families, in the order the Focused Session fills them. */
export const FOCUS_FAMILY_ORDER: readonly BehaviouralFocusFamily[] = [
  "introduction",
  "motivation",
  "competency",
  "challenge",
  "achievement",
] as const;

/** Normalize any inbound value to a session mode, defaulting to the existing flow. */
export function asBehaviouralSessionMode(value: unknown): BehaviouralSessionMode {
  return value === "focused" ? "focused" : "full";
}

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

/**
 * Focused Session: exactly one question per coverage family, five in total.
 *
 * Deliberately layered ON TOP of generateQuestions rather than reimplementing it,
 * so conditional-drop, dynamic wording, and ordering behave identically to the Full
 * Session — Focused can only ever be a subset of what Full would have asked.
 *
 * Selection is deterministic (no model call): each family takes the first available
 * id from its role-affinity preference list, and the chosen five are re-sorted into
 * bank order so the interview arc (intro → motivation → competency evidence) holds.
 */
export function selectFocusedQuestions(
  bank: BehaviouralQuestion[],
  ctx: BehaviouralContext | JDRequirements | null,
): BehaviouralQuestion[] {
  const context = normalizeContext(ctx);
  // The exact Full-Session set; Focused never sees a question Full would not ask.
  const generated = generateQuestions(bank, ctx);
  const roleFamily = roleFamilyLabel(context.role, context.industry);
  const byId = new Map(generated.map((q) => [q.id, q]));

  const picked = new Set<string>();
  for (const family of FOCUS_FAMILY_ORDER) {
    const preferred = focusFamilyPreference(family, roleFamily);
    const ordered =
      family === "motivation" ? motivationPreference(preferred, context) : preferred;

    // First available preference, then any unpicked question authored to this family.
    const chosen =
      ordered.find((id) => byId.has(id) && !picked.has(id)) ??
      generated.find((q) => q.focus_family === family && !picked.has(q.id))?.id;
    if (chosen) picked.add(chosen);
  }

  // Defensive backfill: a bank predating focus_family (or an exhausted family)
  // must still yield a full five rather than a short interview.
  for (const q of generated) {
    if (picked.size >= FOCUS_FAMILY_ORDER.length) break;
    picked.add(q.id);
  }

  return generated.filter((q) => picked.has(q.id));
}

/**
 * "Why this company" only earns the motivation slot when a real company is known —
 * otherwise it degrades to the generic "this company" fallback, so the role-aware
 * motivation question is the stronger single representative of the family.
 */
function motivationPreference(
  preferred: string[],
  context: BehaviouralContext,
): string[] {
  if (!context.company?.trim()) return preferred;
  return [
    "why_this_company",
    ...preferred.filter((id) => id !== "why_this_company"),
  ];
}

/**
 * Build the session's question set for a mode. "full" delegates to the unchanged
 * generateQuestions path; "focused" narrows that same set to five.
 */
export function buildSessionQuestions(
  bank: BehaviouralQuestion[],
  ctx: BehaviouralContext | JDRequirements | null,
  mode: BehaviouralSessionMode = "full",
): BehaviouralQuestion[] {
  return mode === "focused"
    ? selectFocusedQuestions(bank, ctx)
    : generateQuestions(bank, ctx);
}

/** Accept either an already-resolved context or a raw parsed JD (back-compat). */
function normalizeContext(ctx: BehaviouralContext | JDRequirements | null): BehaviouralContext {
  if (!ctx) return {};
  if ("role_title" in ctx || "must_have" in ctx) {
    return contextFromJD(ctx as JDRequirements);
  }
  return ctx as BehaviouralContext;
}
