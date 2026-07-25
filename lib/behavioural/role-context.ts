/**
 * Deterministic role / industry motivation wording.
 *
 * The behavioural interview's motivation questions are role-aware, but their
 * IDENTITY (question id + type) is stable — only the spoken/displayed wording
 * changes with the target role or industry. Wording is produced by pure,
 * deterministic templates here (never a runtime model call) so transcript
 * mapping, scoring, testing, and refresh-recovery stay stable.
 *
 * Live plane only; never imports from offline scripts.
 */

/** The generic, role-agnostic motivation prompt used when no role is known. */
export const GENERIC_ROLE_MOTIVATION = "Why are you interested in this type of role?";

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Map a target role (and optional JD domain) to a natural role/function-motivation
 * question. Known role families get idiomatic phrasing; an unrecognised but known
 * role falls back to a generic "as a {role}" phrasing; missing context yields the
 * fully generic prompt. The returned string is the complete question.
 */
export function roleMotivationQuestion(
  role: string | null | undefined,
  domain?: string | null,
): string {
  const family = roleFamilyLabel(role, domain);
  if (family) {
    // A handful of families read better with a bespoke verb phrase.
    const bespoke: Record<string, string> = {
      "building AI solutions": "Why are you interested in building AI solutions?",
      consulting: "Why do you want to work in consulting?",
    };
    if (bespoke[family]) return bespoke[family];
    return `Why are you interested in working in ${family}?`;
  }

  const r = (role ?? "").trim();
  if (r) {
    // Known but unmapped role: keep it role-aware without inventing a family.
    const article = /^[aeiou]/i.test(r) ? "an" : "a";
    return `Why are you interested in working as ${article} ${r}?`;
  }

  return GENERIC_ROLE_MOTIVATION;
}

/**
 * Canonical "function / role family" label for a role, e.g. "data analytics".
 * Returns null when the role is missing or unrecognised (callers then fall back
 * to the role title itself or the generic prompt). Also used to de-duplicate the
 * industry question against the role family.
 */
export function roleFamilyLabel(
  role: string | null | undefined,
  domain?: string | null,
): string | null {
  const r = norm(role);
  const d = norm(domain);
  const hay = `${r} ${d}`;

  const rules: { label: string; test: RegExp }[] = [
    { label: "building AI solutions", test: /\b(ai|artificial intelligence|machine learning|ml)\b.*\b(solution|consultant|engineer|specialist)\b|\b(ai|ml)\s+(solutions?|consultant)/ },
    { label: "data engineering", test: /\bdata engineer(ing)?\b/ },
    { label: "data science", test: /\bdata scien(ce|tist)\b/ },
    { label: "data analytics", test: /\bdata analy(st|tics|sis)\b|\banalytics\b/ },
    { label: "product management", test: /\bproduct manage(r|ment)\b/ },
    { label: "product design", test: /\b(product|ux|ui)\s*(design(er)?)\b|\bux\b/ },
    { label: "business analysis", test: /\bbusiness analy(st|sis)\b/ },
    { label: "software engineering", test: /\b(software|backend|frontend|full[- ]?stack)\s*(engineer|developer)\b|\bswe\b|\bdeveloper\b/ },
    { label: "consulting", test: /\bconsult(ant|ing)\b/ },
    { label: "marketing", test: /\bmarketing\b/ },
    { label: "sales", test: /\bsales\b/ },
    { label: "finance", test: /\b(finance|financial analyst|investment)\b/ },
  ];

  for (const rule of rules) {
    if (rule.test.test(hay)) return rule.label;
  }
  return null;
}

/**
 * A distinct industry question is worth asking only when a specific industry is
 * known AND it is not already implied by the role family or the company. Prevents
 * "why data analytics?" + "why analytics?" style redundancy.
 */
/**
 * Placeholder / "no value" tokens a weak JD extraction can yield for the industry.
 * Compared against an alphanumeric-only compaction so "N/A", "n/a", "not specified",
 * etc. all collapse to a member of this set and are treated as missing.
 */
const INVALID_INDUSTRY_TOKENS = new Set([
  "",
  "na",
  "none",
  "nil",
  "unknown",
  "unspecified",
  "notspecified",
  "notapplicable",
  "null",
  "undefined",
  "tbd",
  "other",
]);

/**
 * True only for an industry string worth speaking aloud. Rejects empty/whitespace
 * and placeholder-like values (N/A, none, unknown, "-", …). Deterministic — no model
 * call — and local to the Behavioural role-context layer (the JD parser is untouched).
 */
export function isValidIndustry(industry: string | null | undefined): boolean {
  if (!industry) return false;
  const compact = industry.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!compact) return false; // whitespace-only or punctuation-only (e.g. "-")
  return !INVALID_INDUSTRY_TOKENS.has(compact);
}

export function shouldAskIndustry(
  industry: string | null | undefined,
  opts: { roleFamily?: string | null; company?: string | null; role?: string | null },
): boolean {
  if (!isValidIndustry(industry)) return false;
  const ind = norm(industry);
  if (!ind) return false;

  const family = norm(opts.roleFamily);
  const company = norm(opts.company);
  const role = norm(opts.role);

  // Redundant with the role/function (e.g. role family "consulting" + industry "consulting").
  if (family && (family.includes(ind) || ind.includes(family))) return false;
  // Redundant with the role title itself.
  if (role && (role.includes(ind) || ind.includes(role))) return false;
  // Same word as the company name — not a real industry signal.
  if (company && (company.includes(ind) || ind.includes(company))) return false;

  return true;
}

/** Complete industry-motivation question for a known industry. */
export function industryMotivationQuestion(industry: string): string {
  return `Why are you interested in working in ${industry.trim()}?`;
}
