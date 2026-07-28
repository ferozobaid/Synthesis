/**
 * Compare frozen human role-family labels with LLM and keyword mappers.
 *
 * Offline plane only. The 12 unique JDs come from the synthetic human-fit
 * package. Frozen blind labels remain primary; adjudicated labels are reported
 * separately as a sensitivity analysis.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "human_fit_validation");
const ARTIFACT_DIR = join(HERE, ".artifacts");
const PAIRS_PATH = join(PACKAGE_DIR, "pairs.json");
const HUMAN_PATH = join(PACKAGE_DIR, "role_family_frozen_labels.csv");
const COMPARISON_PATH = join(ARTIFACT_DIR, "role_family_three_way_comparison.csv");
const METRICS_PATH = join(ARTIFACT_DIR, "role_family_three_way_metrics.json");

const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const ALLOWED_FAMILIES = [
  "ACCOUNTANT",
  "ADVOCATE",
  "AVIATION",
  "BANKING",
  "CHEF",
  "CONSTRUCTION",
  "CONSULTANT",
  "PUBLIC-RELATIONS",
  "DIGITAL-MEDIA",
  "HR",
  "FINANCE",
  "BUSINESS-DEVELOPMENT",
  "SALES",
  "HEALTHCARE",
  "FITNESS",
  "TEACHER",
  "DESIGNER",
  "ARTS",
  "APPAREL",
  "INFORMATION-TECHNOLOGY",
  "ENGINEERING",
  "UNMAPPED",
] as const;
type Family = (typeof ALLOWED_FAMILIES)[number];

const FAMILY_DEFINITIONS: Record<Family, string> = {
  ACCOUNTANT: "Accounting, bookkeeping, audit, tax, controller, accounts payable/receivable, and accounting operations roles.",
  ADVOCATE: "Legal roles such as attorney, lawyer, paralegal, legal counsel, litigation, law clerk, and legal assistant roles.",
  AVIATION: "Aviation and aerospace roles such as pilot, aircraft, avionics, airline operations, flight attendant, and aircraft maintenance roles.",
  BANKING: "Banking roles such as teller, loan officer, mortgage, credit analyst, branch banking, underwriting, and personal banker roles.",
  CHEF: "Culinary and food preparation roles such as chef, cook, kitchen, bakery, pastry, sous chef, and restaurant kitchen roles.",
  CONSTRUCTION: "Construction, civil engineering, contractor, site supervisor, surveyor, carpenter, estimator, and field construction roles.",
  CONSULTANT: "Management consulting, business consulting, advisory, process improvement, transformation, and client-facing analysis roles.",
  "PUBLIC-RELATIONS": "Public relations, media relations, communications, press, publicity, publicist, and external communications roles.",
  "DIGITAL-MEDIA": "Digital marketing, social media, SEO/SEM, content strategy, online media, copywriting, and community management roles.",
  HR: "Human resources, recruiting, talent acquisition, people operations, benefits, HRIS, employee relations, and HR business partner roles.",
  FINANCE: "Financial analysis, investment, FP&A, treasury, portfolio, valuation, equity research, and corporate finance roles.",
  "BUSINESS-DEVELOPMENT": "Business development, partnerships, strategic accounts, growth partnerships, and business developer roles.",
  SALES: "Sales roles such as account executive, account manager, sales representative, retail sales, inside sales, and sales management roles.",
  HEALTHCARE: "Clinical and healthcare delivery roles such as nurse, physician, therapist, pharmacist, medical assistant, caregiver, and patient care roles.",
  FITNESS: "Fitness, personal training, gym, yoga instructor, wellness coach, athletic training, and group fitness roles.",
  TEACHER: "Education roles such as teacher, professor, instructor, tutor, lecturer, educator, faculty, and teaching assistant roles.",
  DESIGNER: "UX, UI, graphic, product, web, interaction, and visual design roles.",
  ARTS: "Arts and creative roles such as artist, photographer, musician, illustrator, animator, painter, sculptor, and art director roles.",
  APPAREL: "Fashion, apparel, textile, merchandiser, stylist, tailor, garment, and fashion design roles.",
  "INFORMATION-TECHNOLOGY": "Software, data, cloud, cybersecurity, database, systems administration, IT support, DevOps, QA, and web development roles.",
  ENGINEERING: "Engineering roles such as mechanical, electrical, manufacturing, process, quality, industrial, chemical, and non-software engineering roles.",
  UNMAPPED: "Use when the posting does not clearly fit any allowed resume family.",
};

// Exact relevant slice of the ordered Python keyword mapper. Consultant precedes
// Finance, and Finance precedes IT; this ordering controls Technology Consultant.
const SCOPED_KEYWORDS: Array<[Family, string[]]> = [
  ["CONSULTANT", ["consultant", "consulting", "advisory", "management consultant"]],
  ["FINANCE", ["financial analyst", "fp&a", "treasury", "investment analyst", "financial planning", "finance manager", "financial advisor", "portfolio", "equity research", "finance"]],
  ["INFORMATION-TECHNOLOGY", ["software", "developer", "programmer", ".net", "java", "python", "data engineer", "data scientist", "network administrator", "system administrator", "systems administrator", "devops", "qa engineer", "information technology", "it support", "web developer", "full stack", "full-stack", "back end", "backend", "front end", "frontend", "database administrator", "cybersecurity", "cloud engineer", "sql", "machine learning"]],
];

interface PairRow {
  jd_title: string;
  jd_text: string;
}

interface HumanRow {
  review_id: string;
  frozen_human_family: Family;
  adjudicated_human_family: Family;
  adjudication_note: string;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path: string, headers: string[], rows: Record<string, unknown>[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  writeFileSync(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

function parseCsv(path: string): Record<string, string>[] {
  const [header, ...lines] = readFileSync(path, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = header.split(",");
  return lines.map((line) => {
    const values: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted && ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        values.push(cell);
        cell = "";
      } else cell += ch;
    }
    values.push(cell);
    return Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""]));
  });
}

function family(value: string): Family {
  const normalized = value.trim().toUpperCase() as Family;
  if (!ALLOWED_FAMILIES.includes(normalized)) throw new Error(`Invalid family: ${value}`);
  return normalized;
}

function keywordFamily(title: string): Family {
  const normalized = title.toLowerCase();
  for (const [candidate, keywords] of SCOPED_KEYWORDS) {
    if (keywords.some((keyword) => normalized.includes(keyword))) return candidate;
  }
  return "UNMAPPED";
}

function prompt(title: string, description: string): string {
  const definitions = ALLOWED_FAMILIES.map(
    (candidate) => `- ${candidate}: ${FAMILY_DEFINITIONS[candidate]}`,
  ).join("\n");
  return `Classify the job posting into exactly one allowed resume family.

Rules:
- Use the title and description. Do not rely on title alone.
- Classify by the primary role/function, not the employer's industry.
- Choose UNMAPPED if none of the families clearly fit.
- Do not invent a new family.
- Return JSON only with keys: family, confidence, rationale.
- confidence must be a number from 0 to 1.
- family must be one of the allowed families.

Allowed families and definitions:
${definitions}

Posting:
title: ${title}
description: ${description.slice(0, 4500)}`;
}

async function llmFamily(apiKey: string, title: string, description: string) {
  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a careful job-posting classifier. Return only valid JSON." },
        { role: "user", content: prompt(title, description) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI mapper failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { family?: string; confidence?: number; rationale?: string };
  return {
    family: family(parsed.family ?? ""),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    rationale: String(parsed.rationale ?? "").replace(/\s+/g, " ").trim().slice(0, 1000),
  };
}

function agreement(rows: Array<Record<string, unknown>>, left: string, right: string): number {
  return rows.filter((row) => row[left] === row[right]).length / Math.max(1, rows.length);
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the LLM mapper.");

  const pairs = JSON.parse(readFileSync(PAIRS_PATH, "utf8")) as PairRow[];
  const unique = [...new Map(pairs.map((pair) => [pair.jd_title, pair])).values()].sort((a, b) =>
    a.jd_title.localeCompare(b.jd_title),
  );
  const human = parseCsv(HUMAN_PATH).map((row) => ({
    review_id: row.review_id,
    frozen_human_family: family(row.frozen_human_family),
    adjudicated_human_family: family(row.adjudicated_human_family),
    adjudication_note: row.adjudication_note,
  })) as HumanRow[];
  if (unique.length !== 12 || human.length !== 12) {
    throw new Error(`Expected 12 unique JDs and human labels; received ${unique.length} and ${human.length}.`);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < unique.length; i++) {
    const review = human[i];
    const jd = unique[i];
    const llm = await llmFamily(apiKey, jd.jd_title, jd.jd_text);
    const keyword = keywordFamily(jd.jd_title);
    rows.push({
      review_id: review.review_id,
      jd_title: jd.jd_title,
      frozen_human_family: review.frozen_human_family,
      adjudicated_human_family: review.adjudicated_human_family,
      llm_family: llm.family,
      llm_confidence: Number(llm.confidence.toFixed(4)),
      llm_rationale: llm.rationale,
      keyword_family: keyword,
      frozen_human_llm_agree: review.frozen_human_family === llm.family,
      frozen_human_keyword_agree: review.frozen_human_family === keyword,
      llm_keyword_agree: llm.family === keyword,
      adjudicated_human_llm_agree: review.adjudicated_human_family === llm.family,
      adjudicated_human_keyword_agree: review.adjudicated_human_family === keyword,
      adjudication_note: review.adjudication_note,
    });
    console.log(`Mapped ${i + 1}/${unique.length}: ${jd.jd_title} -> LLM=${llm.family}, keyword=${keyword}`);
  }

  const metrics = {
    generated_at: new Date().toISOString(),
    n_jds: rows.length,
    llm_model: MODEL,
    primary_reference: "frozen_human_family",
    frozen_human_vs_llm_accuracy: Number(agreement(rows, "frozen_human_family", "llm_family").toFixed(4)),
    frozen_human_vs_keyword_accuracy: Number(agreement(rows, "frozen_human_family", "keyword_family").toFixed(4)),
    llm_vs_keyword_agreement: Number(agreement(rows, "llm_family", "keyword_family").toFixed(4)),
    adjudicated_human_vs_llm_accuracy: Number(agreement(rows, "adjudicated_human_family", "llm_family").toFixed(4)),
    adjudicated_human_vs_keyword_accuracy: Number(agreement(rows, "adjudicated_human_family", "keyword_family").toFixed(4)),
    notes: [
      "Human-versus-method comparisons use the human label as reference and are reported as accuracy.",
      "LLM-versus-keyword has no human ground truth side and is reported as agreement, not accuracy.",
      "Frozen blind labels are primary; adjudicated labels are a sensitivity analysis.",
    ],
  };

  writeCsv(
    COMPARISON_PATH,
    [
      "review_id",
      "jd_title",
      "frozen_human_family",
      "adjudicated_human_family",
      "llm_family",
      "llm_confidence",
      "llm_rationale",
      "keyword_family",
      "frozen_human_llm_agree",
      "frozen_human_keyword_agree",
      "llm_keyword_agree",
      "adjudicated_human_llm_agree",
      "adjudicated_human_keyword_agree",
      "adjudication_note",
    ],
    rows,
  );
  writeFileSync(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  console.log(`\n${JSON.stringify(metrics, null, 2)}`);
  console.log(`Comparison -> ${COMPARISON_PATH}`);
  console.log(`Metrics -> ${METRICS_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
