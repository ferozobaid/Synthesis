/**
 * Resume parser. Applies the EDA-measured cleaning rules, then a heuristic
 * structured parse: O*NET-normalised skills, experience entries (role / org /
 * dates / achievement bullets), and education. Text extraction for uploaded
 * PDF/DOCX is lazy so the heavy libs load only when a file is actually parsed.
 */
import type { ParsedResume } from "@/lib/types";
import { normalizeSkills, extractCanonicalSkills } from "@/lib/onet";

const FULLWIDTH_DASH = /－/g; // EDA: present in ~47.6% of resumes

const SKILL_LEXICON = [
  "sql", "python", "r", "excel", "power bi", "tableau", "sas", "spark", "hadoop",
  "aws", "azure", "gcp", "machine learning", "statistics", "regression",
  "a/b testing", "etl", "pandas", "numpy", "scikit-learn", "javascript",
  "typescript", "react", "java", "c++", "docker", "kubernetes", "git",
  "tensorflow", "pytorch", "data visualization", "data modeling",
  "stakeholder management", "project management", "communication",
  "financial modeling", "forecasting", "segmentation", "experimentation",
];

/** Apply EDA cleaning: Unicode-normalize, fix the full-width dash, drop the
 *  "Company Name" privacy placeholder, and tidy whitespace. */
export function cleanResumeText(raw: string): string {
  let t = raw.normalize("NFKC").replace(FULLWIDTH_DASH, "-");
  t = t.replace(/\bCompany Name\b/g, "");
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

/** Strip a leading ALL-CAPS job-title line (~99.5% of resumes — defeats label leakage). */
export function stripLeadingTitleLine(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length) {
    const first = lines[i].trim();
    const letters = first.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 3 && first.length <= 60 && first === first.toUpperCase()) {
      lines.splice(i, 1);
    }
  }
  return lines.join("\n").trim();
}

/** Token-boundary match so "r" doesn't fire inside "Power" and "java" inside "javascript". */
function skillRegex(skill: string): RegExp {
  const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i");
}

export function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const s of SKILL_LEXICON) if (skillRegex(s).test(text)) found.add(s);
  return [...found];
}

const SECTION_HEADERS = [
  "experience", "work experience", "professional experience", "employment history",
  "employment", "education", "academic background", "academic", "skills",
  "technical skills", "core competencies", "competencies", "certifications",
  "certification", "projects", "summary", "profile", "objective", "awards",
  "honors", "publications", "references", "interests", "languages", "volunteer",
];

/** Return one section's text, bounded by the next recognised section header. */
function sliceSection(text: string, names: string[]): string {
  const startRe = new RegExp(`(^|\\n)\\s*(${names.join("|")})\\s*:?\\s*(\\n|$)`, "i");
  const m = text.match(startRe);
  if (!m || m.index === undefined) return "";
  const rest = text.slice(m.index + m[0].length);
  const endRe = new RegExp(`\\n\\s*(${SECTION_HEADERS.join("|")})\\s*:?\\s*(\\n|$)`, "i");
  const e = rest.match(endRe);
  const end = e && e.index !== undefined ? e.index : 1500;
  return rest.slice(0, end).trim();
}

const BULLET = /^[-•*‣·●▪]+\s*/;

/** Pull a date / date-range substring out of a role header, if present. */
function extractDates(header: string): string | undefined {
  const month = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*";
  const range = header.match(
    new RegExp(
      `((?:${month}\\s*)?(?:19|20)\\d{2})\\s*[-–—]{1,2}\\s*(present|current|(?:${month}\\s*)?(?:19|20)\\d{2})`,
      "i",
    ),
  );
  if (range) return range[0].replace(/\s+/g, " ").trim();
  const single = header.match(/\b(19|20)\d{2}\b/);
  return single ? single[0] : undefined;
}

/** Split a "Title, Company" / "Title at Company" header into its parts. */
function splitTitleOrg(header: string): { title?: string; org?: string } {
  const cleaned = header.replace(/\s+/g, " ").trim();
  if (!cleaned) return {};
  const m = cleaned.match(/^(.*?)\s*(?:\||,| - | – | — | at | @ )\s*(.+)$/i);
  if (m) return { title: m[1].trim() || undefined, org: m[2].trim() || undefined };
  return { title: cleaned };
}

/** Structure an experience section into entries: role/org/dates + achievement bullets. */
function parseExperienceEntries(expText: string): ParsedResume["experience"] {
  if (!expText.trim()) return [];
  const blocks = expText.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const entries: ParsedResume["experience"] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const firstBullet = lines.findIndex((l) => BULLET.test(l));
    let headerLine = "";
    let bodyLines: string[];
    if (firstBullet > 0) {
      headerLine = lines.slice(0, firstBullet).join(" — ");
      bodyLines = lines.slice(firstBullet);
    } else if (firstBullet === 0) {
      bodyLines = lines; // starts with bullets — no header line
    } else {
      headerLine = lines[0]; // no bullets — first line is the header
      bodyLines = lines.slice(1);
    }

    const bullets = bodyLines
      .map((l) => l.replace(BULLET, "").trim())
      .filter((l) => l.length > 2)
      .slice(0, 8);

    const entry: ParsedResume["experience"][number] = { bullets };
    if (headerLine) {
      const dates = extractDates(headerLine);
      if (dates) entry.dates = dates;
      const titleOrg = splitTitleOrg(
        dates ? headerLine.replace(dates, "").replace(/[|,–—-]\s*$/, "").trim() : headerLine,
      );
      if (titleOrg.title) entry.title = titleOrg.title;
      if (titleOrg.org) entry.org = titleOrg.org;
    }
    if (entry.bullets.length || entry.title) entries.push(entry);
  }
  return entries.slice(0, 6);
}

/** Heuristic structured parse (EDA-cleaned, O*NET-normalised skills). */
export function parseResume(raw: string): ParsedResume {
  const cleaned = stripLeadingTitleLine(cleanResumeText(raw));
  // Skills: lexicon hits ∪ taxonomy scan, normalised to canonical O*NET forms.
  const skills = normalizeSkills([...extractSkills(cleaned), ...extractCanonicalSkills(cleaned)]);
  const expText = sliceSection(cleaned, [
    "experience", "work experience", "professional experience", "employment history", "employment",
  ]);
  const eduText = sliceSection(cleaned, ["education", "academic background", "academic"]);

  const experience = parseExperienceEntries(expText);

  const education = eduText
    ? eduText
        .split(/\n/)
        .map((l) => l.replace(BULLET, "").trim())
        .filter((l) => /\b(BSc|BA|BS|MSc|MS|MBA|PhD|Bachelor|Master|Degree|Diploma|University|College|Institute)\b/i.test(l))
        .slice(0, 4)
        .map((l) => ({ degree: l }))
    : [];

  return { name: null, summary: null, skills, experience, education, raw_text: cleaned };
}

/** Lazily extract text from an uploaded file (PDF via unpdf, DOCX via mammoth). */
export async function extractText(buffer: Uint8Array, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buffer);
    const { text } = await pdfExtract(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return value;
  }
  return new TextDecoder().decode(buffer);
}
