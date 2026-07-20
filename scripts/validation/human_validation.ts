/**
 * Blinded pair-level and mapper human validation — OFFLINE PLANE ONLY.
 *
 * Generate review CSVs without system answers, collect human labels, then run
 * this script again with --analyze. System scores and mapper answers live in
 * separate JSONL key files so reviewers cannot see them while labelling.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreFit } from "@/lib/matching";
import { scoreFitAnalyzer } from "@/lib/matching-semantic";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ART = join(HERE, ".artifacts");
const LABELS = ["WEAK", "MEDIUM", "STRONG"] as const;
const HUMAN_REVIEW_CRITERIA = {
  STRONG: "The resume clearly meets most important must-haves, provides relevant evidence, and has no critical gap that would normally prevent consideration.",
  MEDIUM: "The resume meets some important requirements or shows credible transferable experience, but has at least one meaningful gap or weakly evidenced must-have.",
  WEAK: "The resume targets a substantially different role, misses several important must-haves, or lacks a clear gating requirement such as a required degree, certification, or work authorization.",
  calibration: [
    "Treat a requirement as gating when the role clearly depends on a specific degree, certification, work authorization, domain, tool, or technical stack.",
    "Transferable experience can support MEDIUM when it shows adjacent work or similar responsibilities, but does not directly show the JD's central tools, domain, or tasks.",
    "Use STRONG for transferable cases only when the resume shows direct evidence of the same kind of work at a comparable level.",
    "Soft skills can strengthen a label, but should not outweigh missing core role requirements by themselves.",
    "For software, data, analytics, or technical roles, missing the main named tools or methods should be recorded as a critical gap.",
  ],
  confidence: {
    1: "Uncertain; the JD or resume is ambiguous, or the label depends heavily on judgment. Treat confidence 1 as a review flag.",
    2: "Reasonably confident; some judgment is required.",
    3: "Highly confident; the evidence clearly supports the label.",
  },
};
const FAMILIES = [
  "ACCOUNTANT", "ADVOCATE", "AVIATION", "BANKING", "CHEF", "CONSTRUCTION",
  "CONSULTANT", "PUBLIC-RELATIONS", "DIGITAL-MEDIA", "HR", "FINANCE",
  "BUSINESS-DEVELOPMENT", "SALES", "HEALTHCARE", "FITNESS", "TEACHER",
  "DESIGNER", "ARTS", "APPAREL", "INFORMATION-TECHNOLOGY", "ENGINEERING",
  "UNMAPPED",
] as const;

interface ResumeRow { id: string; category: string; raw_text: string }
interface JDRow {
  job_id: string;
  family: string;
  title: string;
  company_name: string;
  description?: string;
  skills_desc?: string;
  posting_text: string;
  llm_confidence?: number;
  llm_rationale?: string;
}
interface MapperCacheRow {
  job_id?: string;
  title?: string;
  company_name?: string;
  family?: string;
  confidence?: number;
  rationale?: string;
  error?: string | null;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function intArg(name: string, fallback: number): number {
  const n = Number.parseInt(arg(name, String(fallback)), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadDotenv(): void {
  const path = join(REPO, ".env.local");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...parts] = line.split("=");
    if (key && process.env[key] === undefined) {
      process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path: string, headers: string[], rows: Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(","));
  writeFileSync(path, lines.join("\r\n") + "\r\n", "utf8");
}

function parseCsv(path: string): Record<string, string>[] {
  const input = readFileSync(path, "utf8");
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") {
      row.push(cell.replace(/\r$/, "")); table.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); table.push(row); }
  const headers = table.shift() ?? [];
  return table.filter((r) => r.some((v) => v.trim())).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
  );
}

function stableOrder(value: string): string {
  return createHash("sha256").update(`synthesis-human-v1:${value}`).digest("hex");
}

function cleanText(text: string, limit = 9000): string {
  return text.replace(/\0/g, " ").trim().slice(0, limit);
}

function formatResumeForReview(raw: string): string {
  const decoded = raw
    .replace(/Â /g, " ")
    .replace(/Â/g, "")
    .replace(/â€“|â€”/g, "—")
    .replace(/â€™/g, "'")
    .replace(/\t/g, "    ")
    .replace(/[ \u00a0]{2,}/g, "\n");
  const headings = new Set([
    "summary", "professional summary", "skills", "experience", "work history",
    "education", "education and training", "certifications", "additional information",
  ]);
  const lines = decoded
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const output: string[] = [];
  let section = "";
  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/:$/, "");
    if (headings.has(normalized)) {
      section = normalized;
      output.push("", normalized.toUpperCase(), "=".repeat(normalized.length));
      continue;
    }
    if (section === "skills") {
      output.push(`• ${line}`);
      continue;
    }
    const previous = output.at(-1) ?? "";
    const isSectionRule = /^=+$/.test(previous);
    const isContinuation = /^[a-z(]/.test(line) && previous && !isSectionRule;
    if ((section.includes("summary") || isContinuation) && previous && !isSectionRule) {
      output[output.length - 1] = `${previous} ${line}`;
    } else {
      output.push(line);
    }
  }
  return cleanText(output.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function fixtureData(): { resumes: ResumeRow[]; jds: JDRow[] } {
  const resumeDefs = [
    ["information_technology_36856210", "INFORMATION-TECHNOLOGY"],
    ["finance_11877150", "FINANCE"],
    ["consultant_27096471", "CONSULTANT"],
  ] as const;
  const jdDefs = [
    ["smoke-it", "INFORMATION-TECHNOLOGY", "software_engineer.txt", "Software Engineer"],
    ["smoke-finance", "FINANCE", "data_analyst.txt", "Data Analyst"],
    ["smoke-consultant", "CONSULTANT", "consultant.txt", "Consultant"],
  ] as const;
  const resumes = resumeDefs.map(([id, category]) => ({
    id, category,
    raw_text: readFileSync(join(REPO, "context", "resume_samples", `${id}.txt`), "utf8"),
  }));
  const jds = jdDefs.map(([job_id, family, file, title]) => {
    const posting_text = readFileSync(join(REPO, "context", "jd_samples", file), "utf8");
    return {
      job_id, family, title, company_name: "Validation fixture",
      description: posting_text, posting_text, llm_confidence: 1,
      llm_rationale: "Fixture family used only to exercise the review workflow.",
    };
  });
  return { resumes, jds };
}

function loadStudyData(smoke: boolean): { resumes: ResumeRow[]; jds: JDRow[]; suffix: string } {
  const suffix = smoke ? "smoke" : "scoped";
  const resumes = readJsonl<ResumeRow>(join(ART, `resumes.${suffix}.jsonl`));
  const jds = readJsonl<JDRow>(join(ART, `jds.${suffix}.jsonl`));
  if (resumes.length && jds.length) return { resumes, jds, suffix };
  if (!smoke) throw new Error("Missing scoped artifacts. Run npm run validate:prep first, or use --smoke.");
  const fixture = fixtureData();
  return { ...fixture, suffix };
}

function selectPairs(resumes: ResumeRow[], jds: JDRow[], target: number): Array<{ resume: ResumeRow; jd: JDRow }> {
  const all = resumes.flatMap((resume) => jds.map((jd) => ({ resume, jd })));
  const same = all.filter((p) => p.resume.category === p.jd.family)
    .sort((a, b) => stableOrder(`${a.resume.id}:${a.jd.job_id}`).localeCompare(stableOrder(`${b.resume.id}:${b.jd.job_id}`)));
  const cross = all.filter((p) => p.resume.category !== p.jd.family)
    .sort((a, b) => stableOrder(`${a.resume.id}:${a.jd.job_id}`).localeCompare(stableOrder(`${b.resume.id}:${b.jd.job_id}`)));
  const sameTarget = Math.min(same.length, Math.ceil(target / 2));
  const selected = [...same.slice(0, sameTarget), ...cross.slice(0, Math.min(cross.length, target - sameTarget))];
  if (selected.length < target) {
    const used = new Set(selected.map((p) => `${p.resume.id}:${p.jd.job_id}`));
    selected.push(...all.filter((p) => !used.has(`${p.resume.id}:${p.jd.job_id}`)).slice(0, target - selected.length));
  }
  return selected.sort((a, b) => stableOrder(`blind:${a.resume.id}:${a.jd.job_id}`).localeCompare(stableOrder(`blind:${b.resume.id}:${b.jd.job_id}`)));
}

async function generatePairs(smoke: boolean): Promise<void> {
  const { resumes, jds, suffix } = loadStudyData(smoke);
  const defaultTarget = smoke ? resumes.length * jds.length : 30;
  const pairs = selectPairs(resumes, jds, intArg("--pairs", defaultTarget));
  const review: Record<string, unknown>[] = [];
  const key: unknown[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const { resume, jd } = pairs[i];
    const reviewId = `PAIR-${String(i + 1).padStart(3, "0")}`;
    const parsedResume = parseResume(resume.raw_text);
    const parsedJD = parseJD(jd.posting_text);
    const structured = scoreFit(parsedResume, parsedJD);
    const production = await scoreFitAnalyzer(parsedResume, parsedJD);
    review.push({
      review_id: reviewId,
      jd_title: jd.title,
      jd_company: jd.company_name,
      job_description: cleanText(jd.posting_text),
      resume: formatResumeForReview(resume.raw_text),
      human_fit_label: "",
      human_confidence_1_to_3: "",
      key_matching_evidence: "",
      critical_gaps: "",
      reviewer_notes: "",
    });
    key.push({
      review_id: reviewId,
      resume_id: resume.id,
      resume_family: resume.category,
      job_id: jd.job_id,
      jd_family: jd.family,
      same_source_family: resume.category === jd.family,
      structured_score: structured.overall_score,
      semantic_score: production.semantic?.overall_score ?? null,
      hybrid_0_25_score: production.method === "hybrid_0_25" ? production.report.overall_score : null,
      production_method: production.method,
      production_score: production.report.overall_score,
      embedding_backend: production.embedding_backend,
      fallback_reason: production.fallback_reason ?? null,
    });
  }
  const reviewPath = arg("--output", join(ART, `human_pair_review.${suffix}.csv`));
  const keyPath = join(ART, `human_pair_key.${suffix}.jsonl`);
  writeCsv(reviewPath, [
    "review_id", "jd_title", "jd_company", "job_description", "resume",
    "human_fit_label", "human_confidence_1_to_3", "key_matching_evidence",
    "critical_gaps", "reviewer_notes",
  ], review);
  writeJsonl(keyPath, key);
  console.log(`Wrote ${reviewPath}\nWrote ${keyPath}\nPairs: ${pairs.length}`);
}

const KEYWORD_MAP: Array<[string, string[]]> = [
  ["ACCOUNTANT", ["accountant", "accounting", "cpa", "bookkeeper", "bookkeeping", "accounts payable", "accounts receivable", "controller", "auditor"]],
  ["ADVOCATE", ["attorney", "lawyer", "advocate", "paralegal", "litigation", "legal counsel", "counsel", "legal assistant", "law clerk"]],
  ["AVIATION", ["pilot", "aviation", "aircraft", "flight attendant", "aerospace", "airline", "avionics", "air traffic"]],
  ["BANKING", ["teller", "loan officer", "mortgage", "credit analyst", "branch manager", "personal banker", "underwriter", "bank"]],
  ["CHEF", ["chef", "sous chef", "line cook", "cook", "culinary", "kitchen", "pastry", "baker"]],
  ["CONSTRUCTION", ["construction", "civil engineer", "foreman", "estimator", "site supervisor", "general contractor", "contractor", "surveyor", "carpenter"]],
  ["CONSULTANT", ["consultant", "consulting", "advisory", "management consultant"]],
  ["PUBLIC-RELATIONS", ["public relations", "pr manager", "media relations", "press secretary", "communications specialist", "communications manager", "publicist"]],
  ["DIGITAL-MEDIA", ["digital media", "social media", "seo", "sem", "content creator", "digital marketing", "community manager", "content strategist", "copywriter"]],
  ["HR", ["human resources", "recruiter", "talent acquisition", "hr manager", "hr generalist", "people operations", "hris", "benefits coordinator", "hr business partner"]],
  ["FINANCE", ["financial analyst", "fp&a", "treasury", "investment analyst", "financial planning", "finance manager", "financial advisor", "portfolio", "equity research", "finance"]],
  ["BUSINESS-DEVELOPMENT", ["business development", "partnerships", "bd manager", "business developer"]],
  ["SALES", ["sales", "account executive", "account manager", "sales representative", "sales associate", "retail sales", "sales manager", "inside sales"]],
  ["HEALTHCARE", ["nurse", "registered nurse", "healthcare", "medical assistant", "physician", "clinical", "patient care", "therapist", "pharmacist", "caregiver", "medical", "health"]],
  ["FITNESS", ["fitness", "personal trainer", "gym", "yoga instructor", "wellness coach", "group fitness", "athletic trainer"]],
  ["TEACHER", ["teacher", "professor", "instructor", "tutor", "lecturer", "educator", "teaching assistant", "faculty", "substitute teacher"]],
  ["DESIGNER", ["ux designer", "ui designer", "graphic designer", "product designer", "web designer", "design lead", "interaction designer", "designer"]],
  ["ARTS", ["artist", "painter", "musician", "photographer", "art director", "illustrator", "fine arts", "animator", "sculptor"]],
  ["APPAREL", ["apparel", "fashion", "merchandiser", "garment", "textile", "stylist", "tailor", "fashion designer"]],
  ["INFORMATION-TECHNOLOGY", ["software", "developer", "programmer", ".net", "java", "python", "data engineer", "data scientist", "network administrator", "system administrator", "systems administrator", "devops", "qa engineer", "information technology", "it support", "web developer", "full stack", "full-stack", "back end", "backend", "front end", "frontend", "database administrator", "cybersecurity", "cloud engineer", "sql", "machine learning"]],
  ["ENGINEERING", ["engineer", "engineering", "mechanical", "electrical", "manufacturing engineer", "process engineer", "quality engineer", "industrial engineer", "chemical engineer"]],
];

function keywordFamily(title: string): string {
  const lower = title.toLowerCase();
  for (const [family, keywords] of KEYWORD_MAP) {
    if (keywords.some((keyword) => new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(lower))) return family;
  }
  return "UNMAPPED";
}

function mapperRows(smoke: boolean): Array<JDRow & { llm_family: string }> {
  const { jds } = loadStudyData(smoke);
  const cache = readJsonl<MapperCacheRow>(join(ART, "posting_family_map.jsonl"));
  const byJob = new Map(cache.filter((r) => !r.error && r.job_id).map((r) => [String(r.job_id), r]));
  return jds.map((jd) => {
    const cached = byJob.get(jd.job_id);
    return {
      ...jd,
      llm_family: String(cached?.family || jd.family || "UNMAPPED"),
      llm_confidence: Number(cached?.confidence ?? jd.llm_confidence ?? 0),
      llm_rationale: String(cached?.rationale ?? jd.llm_rationale ?? ""),
    };
  });
}

function generateMapper(smoke: boolean): void {
  const suffix = smoke ? "smoke" : "scoped";
  const target = intArg("--mapper-sample", smoke ? 3 : 30);
  const rows = mapperRows(smoke).map((row) => ({ ...row, keyword_family: keywordFamily(row.title) }));
  rows.sort((a, b) => {
    const ad = a.keyword_family !== a.llm_family ? 0 : 1;
    const bd = b.keyword_family !== b.llm_family ? 0 : 1;
    return ad - bd || stableOrder(a.job_id).localeCompare(stableOrder(b.job_id));
  });
  const chosen = rows.slice(0, target);
  const review = chosen.map((row, i) => ({
    review_id: `MAP-${String(i + 1).padStart(3, "0")}`,
    job_title: row.title,
    company: row.company_name,
    job_description: cleanText(row.description || row.posting_text, 6000),
    allowed_families: FAMILIES.join(" | "),
    human_family: "",
    human_confidence_1_to_3: "",
    reviewer_notes: "",
  }));
  const key = chosen.map((row, i) => ({
    review_id: `MAP-${String(i + 1).padStart(3, "0")}`,
    job_id: row.job_id,
    keyword_family: row.keyword_family,
    llm_family: row.llm_family,
    llm_confidence: row.llm_confidence,
    llm_rationale: row.llm_rationale,
    mappers_agree: row.keyword_family === row.llm_family,
  }));
  const reviewPath = join(ART, `human_mapper_review.${suffix}.csv`);
  const keyPath = join(ART, `human_mapper_key.${suffix}.jsonl`);
  writeCsv(reviewPath, ["review_id", "job_title", "company", "job_description", "allowed_families", "human_family", "human_confidence_1_to_3", "reviewer_notes"], review);
  writeJsonl(keyPath, key);
  console.log(`Wrote ${reviewPath}\nWrote ${keyPath}\nPostings: ${chosen.length}`);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = Array(values.length).fill(0);
  for (let i = 0; i < indexed.length;) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j++;
    const rank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) out[indexed[k].index] = rank;
    i = j;
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ma = mean(a)!; const mb = mean(b)!;
  const numerator = a.reduce((sum, value, i) => sum + (value - ma) * (b[i] - mb), 0);
  const da = Math.sqrt(a.reduce((sum, value) => sum + (value - ma) ** 2, 0));
  const db = Math.sqrt(b.reduce((sum, value) => sum + (value - mb) ** 2, 0));
  return da && db ? numerator / (da * db) : null;
}

function analyzePairs(smoke: boolean): void {
  const suffix = smoke ? "smoke" : "scoped";
  const formattedPath = join(ART, `human_pair_review_formatted.${suffix}.csv`);
  const reviewPath = arg(
    "--review-file",
    existsSync(formattedPath) ? formattedPath : join(ART, `human_pair_review.${suffix}.csv`),
  );
  const keyPath = join(ART, `human_pair_key.${suffix}.jsonl`);
  const review = parseCsv(reviewPath);
  const key = new Map(readJsonl<Record<string, unknown>>(keyPath).map((r) => [String(r.review_id), r]));
  const labelled = review.filter((r) => LABELS.includes(r.human_fit_label.trim().toUpperCase() as typeof LABELS[number]));
  const ordinal: Record<string, number> = { WEAK: 0, MEDIUM: 1, STRONG: 2 };
  const methods = ["structured_score", "semantic_score", "hybrid_0_25_score", "production_score"];
  const metrics: Record<string, unknown> = {};
  for (const method of methods) {
    const usable = labelled.flatMap((r) => {
      const rawScore = key.get(r.review_id)?.[method];
      if (rawScore === null || rawScore === undefined || rawScore === "") return [];
      const score = Number(rawScore);
      return Number.isFinite(score)
        ? [{ human: ordinal[r.human_fit_label.trim().toUpperCase()], score }]
        : [];
    });
    metrics[method] = {
      n: usable.length,
      spearman_rho: usable.length >= 3 ? pearson(ranks(usable.map((r) => r.human)), ranks(usable.map((r) => r.score))) : null,
      mean_score_by_human_label: Object.fromEntries(LABELS.map((label) => [label, mean(usable.filter((r) => r.human === ordinal[label]).map((r) => r.score))])),
    };
  }
  const out = {
    criteria: HUMAN_REVIEW_CRITERIA,
    mode: suffix,
    labelled_pairs: labelled.length,
    total_pairs: review.length,
    complete: labelled.length === review.length,
    label_counts: Object.fromEntries(LABELS.map((label) => [label, labelled.filter((r) => r.human_fit_label.trim().toUpperCase() === label).length])),
    methods: metrics,
    interpretation: "Prefer methods with positive rank correlation and monotonically increasing mean scores from WEAK to STRONG. Do not change production weights from a smoke pilot.",
  };
  const outPath = join(ART, `human_pair_metrics.${suffix}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

function recordPair(smoke: boolean): void {
  const suffix = smoke ? "smoke" : "scoped";
  const defaultFormatted = join(ART, `human_pair_review_formatted.${suffix}.csv`);
  const defaultPath = existsSync(defaultFormatted)
    ? defaultFormatted
    : join(ART, `human_pair_review.${suffix}.csv`);
  const path = arg("--review-file", defaultPath);
  const reviewId = arg("--record-pair", "").trim().toUpperCase();
  const label = arg("--label", "").trim().toUpperCase();
  const confidence = arg("--confidence", "").trim();
  if (!reviewId) throw new Error("--record-pair requires a review id.");
  if (!LABELS.includes(label as typeof LABELS[number])) {
    throw new Error("--label must be STRONG, MEDIUM, or WEAK.");
  }
  if (!["1", "2", "3"].includes(confidence)) {
    throw new Error("--confidence must be 1, 2, or 3.");
  }
  const rows = parseCsv(path);
  const row = rows.find((candidate) => candidate.review_id.trim().toUpperCase() === reviewId);
  if (!row) throw new Error(`Unknown review id: ${reviewId}`);
  row.human_fit_label = label;
  row.human_confidence_1_to_3 = confidence;
  row.key_matching_evidence = arg("--evidence", row.key_matching_evidence ?? "");
  row.critical_gaps = arg("--gap", row.critical_gaps ?? "");
  row.reviewer_notes = arg("--notes", row.reviewer_notes ?? "");
  writeCsv(path, Object.keys(rows[0]), rows);
  console.log(`Recorded ${reviewId} in ${path}`);
}

function analyzeMapper(smoke: boolean): void {
  const suffix = smoke ? "smoke" : "scoped";
  const review = parseCsv(join(ART, `human_mapper_review.${suffix}.csv`));
  const key = new Map(readJsonl<Record<string, unknown>>(join(ART, `human_mapper_key.${suffix}.jsonl`)).map((r) => [String(r.review_id), r]));
  const labelled = review.filter((r) => FAMILIES.includes(r.human_family.trim().toUpperCase() as typeof FAMILIES[number]));
  const accuracy = (field: string) => {
    const correct = labelled.filter((r) => String(key.get(r.review_id)?.[field] ?? "") === r.human_family.trim().toUpperCase()).length;
    return { correct, n: labelled.length, accuracy: labelled.length ? correct / labelled.length : null };
  };
  const disagreements = labelled.filter((r) => key.get(r.review_id)?.keyword_family !== key.get(r.review_id)?.llm_family);
  const out = {
    mode: suffix,
    labelled_postings: labelled.length,
    total_postings: review.length,
    complete: labelled.length === review.length,
    keyword_mapper: accuracy("keyword_family"),
    llm_mapper: accuracy("llm_family"),
    mapper_disagreements: disagreements.length,
    llm_wins_on_disagreements: disagreements.filter((r) => key.get(r.review_id)?.llm_family === r.human_family.trim().toUpperCase()).length,
    keyword_wins_on_disagreements: disagreements.filter((r) => key.get(r.review_id)?.keyword_family === r.human_family.trim().toUpperCase()).length,
    interpretation: "Use the human label as the reference. Report sample size and disagreement-focused sampling; do not generalize smoke results.",
  };
  const outPath = join(ART, `human_mapper_metrics.${suffix}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

async function main(): Promise<void> {
  loadDotenv();
  const smoke = process.argv.includes("--smoke");
  const analyze = process.argv.includes("--analyze");
  const mapper = process.argv.includes("--mapper");
  if (process.argv.includes("--record-pair")) recordPair(smoke);
  else if (analyze && mapper) analyzeMapper(smoke);
  else if (analyze) analyzePairs(smoke);
  else if (mapper) generateMapper(smoke);
  else await generatePairs(smoke);
}

main().catch((error) => { console.error(error); process.exit(1); });
