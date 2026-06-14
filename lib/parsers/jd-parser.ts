/**
 * Shared JD parser. Heuristic extractor for company, role, seniority, years,
 * domain, education, and must-have / nice-to-have requirements from raw JD text.
 * Each requirement is grounded against the committed O*NET taxonomy: `onet_skill`
 * holds the canonical skill/tool the requirement maps to (or null).
 */
import type {
  JDRequirement,
  JDRequirements,
  RequirementCategory,
} from "@/lib/types";
import { extractCanonicalSkills, skillCategory } from "@/lib/onet";

const FULLWIDTH_DASH = /－/g;

export function cleanJDText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(FULLWIDTH_DASH, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headerValue(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "im"));
  return m ? m[1].trim() || null : null;
}

function categoryOf(s: string): RequirementCategory {
  const l = s.toLowerCase();
  if (/(degree|bachelor|master|bsc|b\.?a\.?|phd|mba|education)/.test(l)) return "education";
  if (/(years?|experience|background)/.test(l)) return "experience";
  if (/(industry|domain|sector|services)/.test(l)) return "domain";
  if (/(skill|proficien|knowledge of|familiar|sql|python|excel|tools?)/.test(l)) return "skill";
  return "other";
}

function isNiceToHave(s: string): boolean {
  return /(preferred|nice to have|a plus|bonus|desirable|is a plus)/i.test(s);
}

const REQ_CUE =
  /(experience|skills?|proficien|degree|bachelor|knowledge|ability|familiar|required|preferred|years|must|plus|communication|analy)/i;

// Intro/boilerplate sentences and header lines that aren't real requirements.
const BOILERPLATE =
  /^(we are|we're|we have|we offer|we will|we seek|join|about (us|the|our)|our (company|team|mission|client)|who we are|the role|the opportunity|in this role)\b/i;
const HEADER_LINE =
  /^(title|company|job title|role|location|department|industry|domain|education|reports to|salary|employment type|seniority|level)\s*:/i;

/** Join soft-wrapped prose lines (continuation lines start lowercase / "(") so a
 *  single requirement isn't fragmented across the JD's hard line wraps. */
function reflowLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const isBullet = /^[-•*‣·●▪]/.test(line);
    const prev = out[out.length - 1];
    if (out.length && line && !isBullet && /^[a-z(]/.test(line) && prev && !/[.;:]$/.test(prev)) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function splitRequirements(text: string): string[] {
  return reflowLines(text)
    .split(/\n|•|;|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(
      (s) => s.length >= 12 && s.length <= 240 && !BOILERPLATE.test(s) && !HEADER_LINE.test(s),
    );
}

export function parseJD(raw: string): JDRequirements {
  const text = cleanJDText(raw);

  const company = headerValue(text, "Company");
  const roleTitle = headerValue(text, "Title") || headerValue(text, "Job Title");

  const chunks = splitRequirements(text).filter((c) => REQ_CUE.test(c));
  const must_have: JDRequirement[] = [];
  const nice_to_have: JDRequirement[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const key = c.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    const req: JDRequirement = {
      text: c,
      kind: isNiceToHave(c) ? "nice_to_have" : "must_have",
      category: categoryOf(c),
      onet_skill: extractCanonicalSkills(c)[0] ?? null,
    };
    (req.kind === "nice_to_have" ? nice_to_have : must_have).push(req);
  }

  const yearsMatch = text.match(/(\d+)\+?\s*years?/i);
  const years = yearsMatch ? parseInt(yearsMatch[1], 10) : null;

  const seniority = /(senior|lead|principal|director|head of)/i.test(text)
    ? "senior"
    : /(junior|entry[- ]?level|associate|graduate|intern)/i.test(text)
      ? "junior"
      : null;

  const education =
    headerValue(text, "Education") || text.match(/Bachelor[^.\n]*/i)?.[0] || null;

  // Domain: the first industry/domain-category skill the JD mentions (O*NET-grounded).
  const domain =
    headerValue(text, "Industry") ||
    headerValue(text, "Domain") ||
    extractCanonicalSkills(text).find((s) => skillCategory(s) === "domain") ||
    null;

  return {
    company,
    role_title: roleTitle,
    seniority,
    years_experience: years,
    domain,
    education,
    must_have: must_have.slice(0, 20),
    nice_to_have: nice_to_have.slice(0, 20),
  };
}
