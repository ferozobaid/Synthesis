/**
 * Shared JD parser. Heuristic baseline that extracts company, role, seniority, years,
 * education, and must-have / nice-to-have requirements from raw JD text. `onet_skill`
 * grounding against the O*NET taxonomy is layered on by the RAG/ingestion lane; the
 * baseline leaves it null. A deeper LLM parse is layered on in Module 1.
 */
import type {
  JDRequirement,
  JDRequirements,
  RequirementCategory,
} from "@/lib/types";

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

function splitRequirements(text: string): string[] {
  return text
    .split(/\n|•|(?<=[.;])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 240);
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
      onet_skill: null,
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

  return {
    company,
    role_title: roleTitle,
    seniority,
    years_experience: years,
    domain: null,
    education,
    must_have: must_have.slice(0, 20),
    nice_to_have: nice_to_have.slice(0, 20),
  };
}
