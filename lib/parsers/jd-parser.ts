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

const FULLWIDTH_DASH = /\uFF0D/g;

export function cleanJDText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(FULLWIDTH_DASH, "-")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[\u00B7\u25AA\u25CF\u2023]/g, "\n- ")
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
  if (/(skill|proficien|knowledge of|familiar|hands[- ]?on|sql|python|excel|java|javascript|typescript|react|api|cloud|tools?)/.test(l)) return "skill";
  return "other";
}

function isNiceToHave(s: string): boolean {
  return /(preferred|nice to have|a plus|bonus|desirable|is a plus)/i.test(s);
}

const REQ_CUE =
  /(experience|skills?|proficien|degree|bachelor|knowledge|ability|familiar|required|preferred|responsibilit|qualifications?|requirements?|years|must|plus|communication|analy|hands[- ]?on|develop|design|build|implement|support|manage|coding|programming)/i;

// Intro/boilerplate sentences and header lines that are not real requirements.
const BOILERPLATE =
  /^(we are|we're|we have|we offer|we will|we seek|join|about (us|the|our)|our (company|team|mission|client)|who we are|the role|the opportunity|in this role)\b/i;
const HEADER_LINE =
  /^(title|company|job title|role|location|department|industry|domain|reports to|salary|employment type|seniority|level)\s*:/i;

const REQUIREMENT_HEADER =
  /^(?:job\s+description|description|responsibilities|duties|requirements?|qualifications?|preferred qualifications?|minimum qualifications?|basic qualifications?|must(?:\s+have)?(?:\s+skills?)?|skills?\s+(?:require|required|requirements?)|skills?|technical skills?|education)\s*:?\s*/i;

const INLINE_SECTION =
  /\b(job description|responsibilities|duties|requirements?|qualifications?|preferred qualifications?|minimum qualifications?|basic qualifications?|must(?:\s+have)?(?:\s+skills?)?|skills?\s+(?:require|required|requirements?)|technical skills?)\s*:/gi;

const BULLET = /^[-*\u2022\u2023\u00B7\u25CF\u25AA]+\s*/;

function stripRequirementHeader(s: string): string {
  return s.replace(BULLET, "").replace(REQUIREMENT_HEADER, "").trim();
}

/** Join soft-wrapped prose lines so one requirement is not fragmented. */
function reflowLines(text: string): string {
  const withSections = text.replace(INLINE_SECTION, "\n$1:");
  const lines = withSections.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const prev = out[out.length - 1];
    const isBullet = BULLET.test(line);
    if (
      out.length &&
      line &&
      !isBullet &&
      !REQUIREMENT_HEADER.test(line) &&
      /^[a-z(]/.test(line) &&
      prev &&
      !/[.;:]$/.test(prev)
    ) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function splitLongSkillList(s: string): string[] | null {
  if (s.length <= 240) return null;
  const commaParts = s
    .split(/,(?=\s*[A-Za-z+#. -]{2,40}(?:,|$))/)
    .map((p) => stripRequirementHeader(p.trim()))
    .filter(Boolean);
  if (commaParts.length < 3) return null;
  return commaParts.some((p) => extractCanonicalSkills(p).length > 0) ? commaParts : null;
}

function splitRequirements(text: string): string[] {
  const chunks: string[] = [];
  for (const raw of reflowLines(text).split(/\n|\u2022|;|(?<=[.;])\s+(?=[A-Z])/)) {
    const stripped = stripRequirementHeader(raw.trim());
    if (!stripped || BOILERPLATE.test(stripped) || HEADER_LINE.test(stripped)) continue;

    const split = splitLongSkillList(stripped);
    if (split) chunks.push(...split);
    else chunks.push(stripped);
  }

  return chunks
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      if (s.length < 5 || s.length > 300) return false;
      if (extractCanonicalSkills(s).length > 0) return true;
      return s.length >= 12;
    });
}

export function parseJD(raw: string): JDRequirements {
  const text = cleanJDText(raw);

  const company = headerValue(text, "Company");
  const roleTitle = headerValue(text, "Title") || headerValue(text, "Job Title");

  const chunks = splitRequirements(text).filter(
    (c) => REQ_CUE.test(c) || extractCanonicalSkills(c).length > 0,
  );
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

  // Domain: the first industry/domain-category skill the JD mentions.
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
