/**
 * Offline human-validation package generator for the Fit Analyzer.
 *
 * This script intentionally lives in scripts/validation only. It creates
 * synthetic JD/resume pairs, scores them through the current analyzer helper,
 * and writes blind reviewer and answer-key artifacts for human validation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { embeddingsEnabled } from "@/lib/config";
import { scoreFitAnalyzer } from "@/lib/matching-semantic";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(HERE, "human_fit_validation");

type RoleFamily = "INFORMATION-TECHNOLOGY" | "FINANCE" | "CONSULTANT";
type SampledBand = "low" | "medium" | "high";
type ExpectedCategory = "Weak" | "Medium" | "Strong";

interface Rubric {
  core_skills: 0 | 1 | 2;
  experience_domain: 0 | 1 | 2;
  seniority_years: 0 | 1 | 2;
  education_hard_constraints: 0 | 1 | 2;
}

interface RoleSeed {
  id: string;
  family: RoleFamily;
  title: string;
  domain: string;
  years: string;
  education: string;
  must: string[];
  nice: string[];
}

interface ResumeVariant {
  label: "strong" | "medium" | "cross";
  family: RoleFamily;
  title: string;
  summary: string;
  skills: string[];
  bullets: string[];
  years: string;
  education: string;
  rubric: Rubric;
  mismatchType: "same-family-strong" | "same-family-partial" | "cross-family-mismatch";
}

interface PairSeed {
  source_id: string;
  role: RoleSeed;
  resume: ResumeVariant;
}

interface ScoredPair {
  pair_id: string;
  source_id: string;
  jd_title: string;
  resume_title: string;
  role_family: RoleFamily;
  resume_profile_family: RoleFamily;
  mismatch_type: ResumeVariant["mismatchType"];
  jd_text: string;
  resume_text: string;
  analyzer_method: string;
  analyzer_score: number;
  sampled_score_band: SampledBand;
  expected_category: ExpectedCategory;
  expected_rubric: Rubric;
  expected_total_0_8: number;
  relevant_evidence: string;
  top_gaps: string;
  missing_keywords: string;
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}

function outputDir(): string {
  return argValue("--out-dir") ?? DEFAULT_OUT;
}

function csvCell(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(path: string, rows: Record<string, unknown>[], columns: string[]): void {
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((col) => csvCell(row[col])).join(",")),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function rubricTotal(r: Rubric): number {
  return r.core_skills + r.experience_domain + r.seniority_years + r.education_hard_constraints;
}

function humanCategory(total: number): ExpectedCategory {
  if (total <= 3) return "Weak";
  if (total <= 6) return "Medium";
  return "Strong";
}

function hash32(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function bandByRank(sortedIndex: number, total: number): SampledBand {
  const bucket = Math.floor((sortedIndex * 3) / total);
  return bucket === 0 ? "low" : bucket === 1 ? "medium" : "high";
}

function joinSentence(items: string[]): string {
  return items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

function jdText(role: RoleSeed): string {
  return [
    `Title: ${role.title}`,
    "Company: Synthetic Validation Employer",
    `Domain: ${role.domain}`,
    `Education: ${role.education}`,
    "",
    "Requirements:",
    `- ${role.years} years of relevant experience required.`,
    `- ${role.education} required.`,
    ...role.must.map((item) => `- ${item} required.`),
    "Preferred Qualifications:",
    ...role.nice.map((item) => `- ${item} preferred.`),
  ].join("\n");
}

function resumeText(role: RoleSeed, resume: ResumeVariant): string {
  return [
    "SYNTHETIC CANDIDATE PROFILE",
    "",
    "SUMMARY",
    resume.summary,
    "",
    "SKILLS",
    resume.skills.join(", "),
    "",
    "EXPERIENCE",
    `${resume.title}, Fictional Practice Group | ${resume.years}`,
    ...resume.bullets.map((item) => `- ${item}`),
    "",
    "EDUCATION",
    resume.education,
    "",
    "VALIDATION NOTE",
    `Synthetic resume written for an offline validation pair against ${role.title}.`,
  ].join("\n");
}

const ROLES: RoleSeed[] = [
  {
    id: "it-backend",
    family: "INFORMATION-TECHNOLOGY",
    title: "Backend Software Engineer",
    domain: "Software product engineering",
    years: "3+",
    education: "Bachelor's degree in Computer Science or related field",
    must: [
      "Hands-on Python development",
      "SQL database design and query optimization",
      "REST API implementation",
      "AWS cloud deployment",
      "Docker container workflows",
    ],
    nice: ["React experience", "Git collaboration"],
  },
  {
    id: "it-data",
    family: "INFORMATION-TECHNOLOGY",
    title: "Data Engineer",
    domain: "Analytics platform engineering",
    years: "4+",
    education: "Bachelor's degree in Computer Science, Data Science, or related field",
    must: [
      "Python data pipeline development",
      "SQL data modeling",
      "ETL workflow ownership",
      "Spark or distributed processing",
      "AWS data platform experience",
    ],
    nice: ["Tableau exposure", "Docker deployment"],
  },
  {
    id: "it-frontend",
    family: "INFORMATION-TECHNOLOGY",
    title: "Frontend Engineer",
    domain: "Web application development",
    years: "3+",
    education: "Bachelor's degree in Computer Science or equivalent experience",
    must: [
      "React application development",
      "TypeScript implementation",
      "JavaScript debugging",
      "API integration",
      "Git-based release workflow",
    ],
    nice: ["AWS deployment experience", "Accessibility testing"],
  },
  {
    id: "it-devops",
    family: "INFORMATION-TECHNOLOGY",
    title: "Cloud DevOps Engineer",
    domain: "Cloud infrastructure operations",
    years: "5+",
    education: "Bachelor's degree in Computer Science, Engineering, or related field",
    must: [
      "AWS infrastructure administration",
      "Docker and Kubernetes operations",
      "Python automation scripting",
      "CI/CD pipeline support",
      "Production incident troubleshooting",
    ],
    nice: ["Terraform exposure", "Data visualization for service metrics"],
  },
  {
    id: "fin-analyst",
    family: "FINANCE",
    title: "Financial Analyst",
    domain: "Corporate finance",
    years: "2+",
    education: "Bachelor's degree in Finance, Accounting, Economics, or related field",
    must: [
      "Excel financial modeling",
      "Forecasting and budget analysis",
      "Variance analysis",
      "Management reporting",
      "Stakeholder communication",
    ],
    nice: ["Power BI dashboards", "SQL exposure"],
  },
  {
    id: "fin-fpa",
    family: "FINANCE",
    title: "FP&A Analyst",
    domain: "Financial planning and analysis",
    years: "3+",
    education: "Bachelor's degree in Finance or Accounting",
    must: [
      "Forecasting model ownership",
      "Budget planning",
      "Excel scenario analysis",
      "Monthly variance reporting",
      "Cross-functional stakeholder management",
    ],
    nice: ["Tableau reporting", "Process improvement"],
  },
  {
    id: "fin-investment",
    family: "FINANCE",
    title: "Investment Analyst",
    domain: "Investment research",
    years: "3+",
    education: "Bachelor's degree in Finance, Economics, or related field",
    must: [
      "Financial modeling and valuation",
      "Portfolio analysis",
      "Market research",
      "Excel investment analysis",
      "Executive presentation writing",
    ],
    nice: ["Python analysis", "Regression analysis"],
  },
  {
    id: "fin-manager",
    family: "FINANCE",
    title: "Finance Manager",
    domain: "Business unit finance",
    years: "6+",
    education: "Bachelor's degree in Finance or Accounting; MBA preferred",
    must: [
      "Financial reporting leadership",
      "Forecasting and planning cadence",
      "Excel modeling review",
      "Team management",
      "Stakeholder management",
    ],
    nice: ["Power BI dashboard ownership", "Project management"],
  },
  {
    id: "con-management",
    family: "CONSULTANT",
    title: "Management Consultant",
    domain: "Client advisory",
    years: "3+",
    education: "Bachelor's degree in Business, Economics, Engineering, or related field",
    must: [
      "Client-facing consulting experience",
      "Process improvement analysis",
      "Project management",
      "Stakeholder management",
      "Structured communication",
    ],
    nice: ["Financial modeling exposure", "Data visualization"],
  },
  {
    id: "con-strategy",
    family: "CONSULTANT",
    title: "Strategy Consultant",
    domain: "Growth strategy",
    years: "4+",
    education: "Bachelor's degree in Business, Economics, or related field; MBA preferred",
    must: [
      "Market analysis",
      "Customer segmentation",
      "Executive presentation development",
      "Financial modeling for business cases",
      "Stakeholder interviews",
    ],
    nice: ["SQL analysis", "Experimentation design"],
  },
  {
    id: "con-operations",
    family: "CONSULTANT",
    title: "Operations Consultant",
    domain: "Operating model improvement",
    years: "4+",
    education: "Bachelor's degree in Business, Operations, Engineering, or related field",
    must: [
      "Process improvement",
      "Operating model analysis",
      "Project management",
      "Data visualization",
      "Client-ready communication",
    ],
    nice: ["Lean methods", "Forecasting exposure"],
  },
  {
    id: "con-technology",
    family: "CONSULTANT",
    title: "Technology Consultant",
    domain: "Digital transformation",
    years: "5+",
    education: "Bachelor's degree in Computer Science, Business, or related field",
    must: [
      "Technology advisory experience",
      "Cloud implementation planning",
      "SQL analysis",
      "Project management",
      "Stakeholder management",
    ],
    nice: ["Python prototyping", "AWS implementation"],
  },
];

const STRONG_BY_FAMILY: Record<RoleFamily, Omit<ResumeVariant, "rubric" | "mismatchType">> = {
  "INFORMATION-TECHNOLOGY": {
    label: "strong",
    family: "INFORMATION-TECHNOLOGY",
    title: "Senior Software and Data Engineer",
    summary:
      "Technology practitioner with six years building production software, cloud services, data pipelines, and web applications.",
    skills: [
      "Python",
      "SQL",
      "React",
      "TypeScript",
      "JavaScript",
      "AWS",
      "Docker",
      "Kubernetes",
      "Git",
      "ETL",
      "Spark",
      "data modeling",
      "project management",
      "communication",
    ],
    bullets: [
      "Built Python REST APIs backed by SQL data models and improved query performance for analytics workloads.",
      "Deployed Docker containers to AWS and supported Kubernetes services during production incident troubleshooting.",
      "Delivered React and TypeScript application features with JavaScript debugging and Git-based release reviews.",
      "Owned ETL pipelines using Python and Spark, including data modeling and data visualization for service metrics.",
      "Led project management routines with stakeholders across product, finance, and operations teams.",
    ],
    years: "2018-2026",
    education: "Bachelor's degree in Computer Science, Fictional Technical University",
  },
  FINANCE: {
    label: "strong",
    family: "FINANCE",
    title: "Senior Finance Analyst",
    summary:
      "Finance professional with seven years in FP&A, investment analysis, forecasting, reporting, and executive decision support.",
    skills: [
      "Excel",
      "financial modeling",
      "forecasting",
      "variance analysis",
      "budget planning",
      "financial reporting",
      "Power BI",
      "Tableau",
      "stakeholder management",
      "project management",
      "communication",
      "SQL",
    ],
    bullets: [
      "Built Excel financial modeling templates for budget planning, forecasting, and monthly variance analysis.",
      "Prepared management reporting packs and executive presentation materials for operating reviews.",
      "Analyzed portfolio performance, market research, valuation cases, and investment scenarios.",
      "Partnered with business stakeholders to improve planning cadence and financial reporting quality.",
      "Managed junior analysts and reviewed Excel models before leadership submissions.",
    ],
    years: "2017-2026",
    education: "Bachelor's degree in Finance, Fictional City University; MBA coursework completed",
  },
  CONSULTANT: {
    label: "strong",
    family: "CONSULTANT",
    title: "Senior Management Consultant",
    summary:
      "Consultant with six years advising clients on strategy, operations, digital transformation, and implementation planning.",
    skills: [
      "consulting",
      "process improvement",
      "project management",
      "stakeholder management",
      "communication",
      "financial modeling",
      "data visualization",
      "market analysis",
      "segmentation",
      "SQL",
      "AWS",
      "Python",
    ],
    bullets: [
      "Led client-facing consulting workstreams covering process improvement and operating model analysis.",
      "Managed project plans, stakeholder interviews, and structured communication for executive steering meetings.",
      "Built market analysis, customer segmentation, and financial modeling for growth strategy cases.",
      "Created data visualization exhibits and SQL analyses to support technology advisory recommendations.",
      "Translated cloud implementation planning into phased digital transformation roadmaps.",
    ],
    years: "2018-2026",
    education: "Bachelor's degree in Business and Economics, Fictional State College; MBA preferred profile",
  },
};

const MEDIUM_BY_FAMILY: Record<RoleFamily, Omit<ResumeVariant, "rubric" | "mismatchType">> = {
  "INFORMATION-TECHNOLOGY": {
    label: "medium",
    family: "INFORMATION-TECHNOLOGY",
    title: "Junior Application Developer",
    summary:
      "Early-career developer with two years of application support and lightweight automation experience.",
    skills: ["Python", "SQL", "JavaScript", "Git", "communication", "data visualization"],
    bullets: [
      "Maintained SQL reports and small Python scripts for internal support requests.",
      "Fixed JavaScript defects in an existing web application using Git pull requests.",
      "Coordinated with stakeholders on issue triage but did not own cloud deployment or container operations.",
    ],
    years: "2024-2026",
    education: "Associate diploma in Information Systems, Fictional Community College",
  },
  FINANCE: {
    label: "medium",
    family: "FINANCE",
    title: "Finance Operations Associate",
    summary:
      "Finance associate with two years in reporting support, reconciliations, and basic spreadsheet analysis.",
    skills: ["Excel", "variance analysis", "financial reporting", "communication", "stakeholder management"],
    bullets: [
      "Updated Excel reporting workbooks and summarized monthly variance analysis for a finance manager.",
      "Supported budget planning meetings by collecting assumptions from operations stakeholders.",
      "Maintained reconciliations but has not owned forecasting models, portfolio analysis, or team leadership.",
    ],
    years: "2024-2026",
    education: "Bachelor's degree in Business Administration, Fictional Regional University",
  },
  CONSULTANT: {
    label: "medium",
    family: "CONSULTANT",
    title: "Business Analyst",
    summary:
      "Business analyst with two years supporting consulting-style projects, status tracking, and basic process documentation.",
    skills: ["project management", "communication", "data visualization", "stakeholder management", "Excel"],
    bullets: [
      "Documented process improvement opportunities and prepared data visualization exhibits for senior consultants.",
      "Tracked project management actions and coordinated stakeholder interviews for client workshops.",
      "Has limited ownership of financial modeling, market analysis, cloud implementation, or executive recommendations.",
    ],
    years: "2024-2026",
    education: "Bachelor's degree in Communications, Fictional Liberal Arts College",
  },
};

const CROSS_BY_FAMILY: Record<RoleFamily, Omit<ResumeVariant, "rubric" | "mismatchType">> = {
  "INFORMATION-TECHNOLOGY": {
    label: "cross",
    family: "INFORMATION-TECHNOLOGY",
    title: "IT Help Desk Coordinator",
    summary:
      "Technical support coordinator focused on ticket triage, password resets, hardware inventory, and user training.",
    skills: ["communication", "customer service", "project management", "Excel"],
    bullets: [
      "Resolved help desk tickets, documented user issues, and escalated infrastructure incidents to engineers.",
      "Maintained inventory spreadsheets and prepared simple training guides for non-technical employees.",
      "No production coding, data pipeline, cloud deployment, or financial analysis ownership.",
    ],
    years: "2021-2026",
    education: "Certificate in Technical Support, Fictional Career Institute",
  },
  FINANCE: {
    label: "cross",
    family: "FINANCE",
    title: "Accounting Clerk",
    summary:
      "Accounting clerk with bookkeeping support experience but limited forecasting, valuation, or advisory exposure.",
    skills: ["Excel", "financial reporting", "communication", "customer service"],
    bullets: [
      "Processed invoices, maintained spreadsheets, and supported month-end documentation for a small office.",
      "Prepared simple financial reporting extracts but did not own forecasting, financial modeling, or strategy work.",
      "No SQL, Python, cloud deployment, consulting, or project management responsibilities.",
    ],
    years: "2022-2026",
    education: "Bookkeeping certificate, Fictional Business College",
  },
  CONSULTANT: {
    label: "cross",
    family: "CONSULTANT",
    title: "Administrative Project Coordinator",
    summary:
      "Coordinator with meeting logistics, notes, and schedule tracking experience, but no advisory or analysis ownership.",
    skills: ["communication", "project management", "Excel", "customer service"],
    bullets: [
      "Scheduled workshops, captured meeting notes, and tracked action items for internal departments.",
      "Created simple Excel trackers but did not perform market analysis, financial modeling, or process redesign.",
      "No technology implementation, software engineering, portfolio analysis, or client recommendation ownership.",
    ],
    years: "2021-2026",
    education: "Bachelor's degree in General Studies, Fictional Metro College",
  },
};

function withAssessment(
  base: Omit<ResumeVariant, "rubric" | "mismatchType">,
  rubric: Rubric,
  mismatchType: ResumeVariant["mismatchType"],
): ResumeVariant {
  return { ...base, rubric, mismatchType };
}

function mediumForRole(role: RoleSeed): ResumeVariant {
  const base = MEDIUM_BY_FAMILY[role.family];
  const rubric: Rubric =
    role.id === "fin-manager" || role.id === "it-devops" || role.id === "con-technology"
      ? { core_skills: 1, experience_domain: 1, seniority_years: 0, education_hard_constraints: 1 }
      : { core_skills: 1, experience_domain: 1, seniority_years: 1, education_hard_constraints: 1 };
  return withAssessment(base, rubric, "same-family-partial");
}

function crossForRole(role: RoleSeed): ResumeVariant {
  const crossFamily: RoleFamily =
    role.family === "INFORMATION-TECHNOLOGY"
      ? "FINANCE"
      : role.family === "FINANCE"
        ? "CONSULTANT"
        : "INFORMATION-TECHNOLOGY";
  const base = CROSS_BY_FAMILY[crossFamily];
  const educationScore: 0 | 1 =
    role.family === "CONSULTANT" && crossFamily === "INFORMATION-TECHNOLOGY" ? 1 : 0;
  return withAssessment(
    base,
    {
      core_skills: 0,
      experience_domain: 0,
      seniority_years: 0,
      education_hard_constraints: educationScore,
    },
    "cross-family-mismatch",
  );
}

function buildSeeds(): PairSeed[] {
  const seeds: PairSeed[] = [];
  for (const role of ROLES) {
    seeds.push({
      source_id: `${role.id}-strong`,
      role,
      resume: withAssessment(
        STRONG_BY_FAMILY[role.family],
        { core_skills: 2, experience_domain: 2, seniority_years: 2, education_hard_constraints: 2 },
        "same-family-strong",
      ),
    });
    seeds.push({
      source_id: `${role.id}-medium`,
      role,
      resume: mediumForRole(role),
    });
    seeds.push({
      source_id: `${role.id}-cross`,
      role,
      resume: crossForRole(role),
    });
  }
  return seeds;
}

function compactEvidence(items: string[], fallback: string): string {
  const text = items.slice(0, 4).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
  return text || fallback;
}

async function scoreSeed(seed: PairSeed): Promise<Omit<ScoredPair, "pair_id" | "sampled_score_band">> {
  const jd = jdText(seed.role);
  const resume = resumeText(seed.role, seed.resume);
  const scoring = await scoreFitAnalyzer(parseResume(resume), parseJD(jd));
  const report = scoring.report;
  const total = rubricTotal(seed.resume.rubric);
  const matchedEvidence = report.per_requirement
    .filter((item) => item.status !== "missing" && item.evidence)
    .slice(0, 4)
    .map((item) => `${item.requirement}: ${item.evidence}`);
  return {
    source_id: seed.source_id,
    jd_title: seed.role.title,
    resume_title: seed.resume.title,
    role_family: seed.role.family,
    resume_profile_family: seed.resume.family,
    mismatch_type: seed.resume.mismatchType,
    jd_text: jd,
    resume_text: resume,
    analyzer_method: scoring.method,
    analyzer_score: report.overall_score,
    expected_category: humanCategory(total),
    expected_rubric: seed.resume.rubric,
    expected_total_0_8: total,
    relevant_evidence: compactEvidence(matchedEvidence, "No matched analyzer evidence."),
    top_gaps: compactEvidence(report.gaps, "No major analyzer gaps."),
    missing_keywords: report.missing_keywords.join("; "),
  };
}

function bandScores(rows: Omit<ScoredPair, "pair_id" | "sampled_score_band">[]): Omit<ScoredPair, "pair_id">[] {
  const sorted = [...rows].sort(
    (a, b) => a.analyzer_score - b.analyzer_score || a.source_id.localeCompare(b.source_id),
  );
  const bands = new Map<string, SampledBand>();
  sorted.forEach((row, i) => bands.set(row.source_id, bandByRank(i, sorted.length)));
  return rows.map((row) => ({ ...row, sampled_score_band: bands.get(row.source_id) ?? "medium" }));
}

function assignReviewerOrder(rows: Omit<ScoredPair, "pair_id">[]): ScoredPair[] {
  return [...rows]
    .sort((a, b) => hash32(a.source_id) - hash32(b.source_id) || a.source_id.localeCompare(b.source_id))
    .map((row, i) => ({
      ...row,
      pair_id: `HFV-${String(i + 1).padStart(3, "0")}`,
    }));
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  return items.reduce(
    (acc, item) => {
      acc[item] = (acc[item] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

function methodologyMarkdown(rows: ScoredPair[]): string {
  const scores = rows.map((row) => row.analyzer_score).sort((a, b) => a - b);
  const min = scores[0];
  const max = scores[scores.length - 1];
  const methods = [...new Set(rows.map((row) => row.analyzer_method))].sort().join(", ");
  return `# Fit Analyzer Human-Validation Package

## Purpose

This offline package supports blind human review of synthetic JD/resume pairs for
the Synthesis Fit Analyzer. It is designed for pair-level validation, not model
tuning. The reviewer-facing sheet hides analyzer method, analyzer score,
expected category, sampled score band, and answer-key metadata.

## Files

- \`reviewer_sheet.csv\` - blind review sheet with JD/resume text and empty rubric fields.
- \`answer_key.csv\` - analyzer outputs, score-band metadata, expected rubric, and evidence.
- \`pairs.json\` - machine-readable copy of the same pair package.
- \`manifest.json\` - counts, score ranges, and regeneration metadata.
- \`methodology.md\` - this note.

## Sample Design

- Total pairs: ${rows.length}
- Role families: IT, Finance, and Consulting.
- Synthetic source only: no private, real, or scraped candidate information.
- Cross-family mismatches: ${rows.filter((row) => row.mismatch_type === "cross-family-mismatch").length}
- Analyzer methods observed in this artifact: ${methods}
- Analyzer score range in this artifact: ${min}-${max}

The sampled score bands are rank-stratified terciles within this generated
package: the lowest third is \`low\`, the middle third is \`medium\`, and the
highest third is \`high\`. These are sampling bands, not universal score
thresholds.

## Human Rubric

Review each pair without consulting the answer key.

| Dimension | Score |
|---|---|
| Core skills | 0-2 |
| Experience/domain | 0-2 |
| Seniority/years | 0-2 |
| Education/hard constraints | 0-2 |

Map the human total to categories:

- Weak: 0-3
- Medium: 4-6
- Strong: 7-8

## Regeneration

Default deterministic regeneration uses the structured fallback path for
reproducibility and avoids depending on a local BGE model cache:

\`\`\`bash
env TMPDIR=/private/tmp EMBEDDINGS_ENABLED=false npm exec -- tsx scripts/validation/generate_human_fit_package.ts
\`\`\`

Optional output directory override:

\`\`\`bash
env TMPDIR=/private/tmp EMBEDDINGS_ENABLED=false npm exec -- tsx scripts/validation/generate_human_fit_package.ts --out-dir scripts/validation/human_fit_validation
\`\`\`

Recommended checks after regeneration:

\`\`\`bash
npm run validate:smoke
npm run typecheck
npm test
\`\`\`

## Known Limitations

- The pairs are synthetic and intentionally scoped to IT, Finance, and Consulting.
- The reviewer sample is small and should support directional claims only.
- The score bands are within-sample terciles, not product-level thresholds.
- The default command disables embeddings for deterministic offline regeneration;
  answer-key method values record the actual analyzer mode used.
- The expected rubric values are calibration metadata, not a substitute for blind
  human review.
- Do not tune Fit Analyzer weights on this package.
`;
}

async function main(): Promise<void> {
  if (process.env.EMBEDDINGS_ENABLED === undefined) {
    process.env.EMBEDDINGS_ENABLED = "false";
  }

  const out = outputDir();
  mkdirSync(out, { recursive: true });

  const seeds = buildSeeds();
  const scored = await Promise.all(seeds.map(scoreSeed));
  const pairs = assignReviewerOrder(bandScores(scored));

  const reviewerRows = pairs.map((row) => ({
    pair_id: row.pair_id,
    jd_title: row.jd_title,
    jd_text: row.jd_text,
    resume_title: row.resume_title,
    resume_text: row.resume_text,
    core_skills_0_2: "",
    experience_domain_0_2: "",
    seniority_years_0_2: "",
    education_hard_constraints_0_2: "",
    human_total_0_8: "",
    human_category: "",
    reviewer_notes: "",
    parser_or_evidence_issue_observed: "",
  }));

  const answerRows = pairs.map((row) => ({
    pair_id: row.pair_id,
    analyzer_method: row.analyzer_method,
    analyzer_score: row.analyzer_score,
    sampled_score_band: row.sampled_score_band,
    role_family: row.role_family,
    resume_profile_family: row.resume_profile_family,
    mismatch_type: row.mismatch_type,
    expected_category: row.expected_category,
    expected_core_skills_0_2: row.expected_rubric.core_skills,
    expected_experience_domain_0_2: row.expected_rubric.experience_domain,
    expected_seniority_years_0_2: row.expected_rubric.seniority_years,
    expected_education_hard_constraints_0_2: row.expected_rubric.education_hard_constraints,
    expected_total_0_8: row.expected_total_0_8,
    jd_title: row.jd_title,
    resume_title: row.resume_title,
    relevant_evidence: row.relevant_evidence,
    top_gaps: row.top_gaps,
    missing_keywords: row.missing_keywords,
    source_id: row.source_id,
  }));

  const reviewerColumns = [
    "pair_id",
    "jd_title",
    "jd_text",
    "resume_title",
    "resume_text",
    "core_skills_0_2",
    "experience_domain_0_2",
    "seniority_years_0_2",
    "education_hard_constraints_0_2",
    "human_total_0_8",
    "human_category",
    "reviewer_notes",
    "parser_or_evidence_issue_observed",
  ];
  const answerColumns = [
    "pair_id",
    "analyzer_method",
    "analyzer_score",
    "sampled_score_band",
    "role_family",
    "resume_profile_family",
    "mismatch_type",
    "expected_category",
    "expected_core_skills_0_2",
    "expected_experience_domain_0_2",
    "expected_seniority_years_0_2",
    "expected_education_hard_constraints_0_2",
    "expected_total_0_8",
    "jd_title",
    "resume_title",
    "relevant_evidence",
    "top_gaps",
    "missing_keywords",
    "source_id",
  ];

  writeCsv(join(out, "reviewer_sheet.csv"), reviewerRows, reviewerColumns);
  writeCsv(join(out, "answer_key.csv"), answerRows, answerColumns);
  writeFileSync(join(out, "pairs.json"), `${JSON.stringify(pairs, null, 2)}\n`, "utf8");
  writeFileSync(
    join(out, "manifest.json"),
    `${JSON.stringify(
      {
        generator: "scripts/validation/generate_human_fit_package.ts",
        deterministic: true,
        total_pairs: pairs.length,
        role_family_counts: countBy(pairs.map((row) => row.role_family)),
        sampled_score_band_counts: countBy(pairs.map((row) => row.sampled_score_band)),
        expected_category_counts: countBy(pairs.map((row) => row.expected_category)),
        mismatch_counts: countBy(pairs.map((row) => row.mismatch_type)),
        analyzer_methods: [...new Set(pairs.map((row) => row.analyzer_method))].sort(),
        embeddings_enabled: embeddingsEnabled(),
        score_min: Math.min(...pairs.map((row) => row.analyzer_score)),
        score_max: Math.max(...pairs.map((row) => row.analyzer_score)),
        regeneration_command:
          "env TMPDIR=/private/tmp EMBEDDINGS_ENABLED=false npm exec -- tsx scripts/validation/generate_human_fit_package.ts",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(join(out, "methodology.md"), methodologyMarkdown(pairs), "utf8");

  console.log(`Wrote ${pairs.length} pairs to ${out}`);
  console.log(`Bands: ${JSON.stringify(countBy(pairs.map((row) => row.sampled_score_band)))}`);
  console.log(`Families: ${JSON.stringify(countBy(pairs.map((row) => row.role_family)))}`);
  console.log(`Embeddings enabled: ${embeddingsEnabled()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
