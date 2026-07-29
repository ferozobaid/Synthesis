/**
 * Blinded 54-pair human validation for the Fit Analyzer.
 *
 * This file is OFFLINE PLANE ONLY. It samples from the same frozen scoped
 * resume and JD artifacts as code validation, scores five arms with strict
 * local BGE embeddings, and keeps all arm outputs out of the reviewer CSV.
 *
 * Workflow:
 *   npm run validate:human54 -- --prepare
 *   npm run validate:human54 -- --apply-labels <labels.json>
 *   npm run validate:human54 -- --finalize
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { embeddingsModel } from "@/lib/config";
import { embedBatchStrict } from "@/lib/embeddings";
import { scoreFit } from "@/lib/matching";
import {
  indexJDRequirements,
  indexResumeEvidence,
  scoreFitHybrid,
  scoreSemanticIndexed,
  type IndexedJDRequirements,
  type IndexedResumeEvidence,
} from "@/lib/matching-semantic";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import type { JDRequirements, ParsedResume } from "@/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ARTIFACT_ROOT = join(HERE, ".artifacts");
export const HUMAN54_DIR = join(ARTIFACT_ROOT, "human54");
export const TARGET_PAIRS = 54;
export const STUDY_FAMILIES = ["CONSULTANT", "FINANCE", "INFORMATION-TECHNOLOGY"] as const;
export const SELECTION_BANDS = ["LOW", "MID", "HIGH"] as const;
export const ARM_NAMES = [
  "structured",
  "embedding",
  "hybrid_0_25",
  "hybrid_0_5",
  "hybrid_0_75",
] as const;
export const HUMAN_LABELS = ["WEAK", "MEDIUM", "STRONG"] as const;
export const SAMPLE_SEED = "synthesis-human-validation-54-v1";

type StudyFamily = (typeof STUDY_FAMILIES)[number];
type SelectionBand = (typeof SELECTION_BANDS)[number];
type ArmName = (typeof ARM_NAMES)[number];
type HumanLabel = (typeof HUMAN_LABELS)[number];

interface ResumeRow {
  id: string;
  category: string;
  raw_text: string;
}

interface JDRow {
  job_id: string;
  family: string;
  title: string;
  company_name: string;
  posting_text: string;
  llm_confidence?: number;
  llm_rationale?: string;
}

interface ParsedResumeRow extends ResumeRow {
  parsed: ParsedResume;
}

interface ParsedJDRow extends JDRow {
  family: StudyFamily;
  parsed: JDRequirements;
}

export interface ArmScores {
  structured: number;
  embedding: number;
  hybrid_0_25: number;
  hybrid_0_5: number;
  hybrid_0_75: number;
}

interface CandidatePair {
  resume: ParsedResumeRow;
  jd: ParsedJDRow;
  scores: ArmScores;
  percentiles: ArmScores;
  composite_percentile: number;
  selection_band: SelectionBand;
  score_range: number;
}

interface SelectedPair extends CandidatePair {
  pair_id: string;
}

interface HumanLabelRow {
  pair_id: string;
  core_requirements_0_to_2: number;
  evidence_quality_0_to_2: number;
  seniority_scope_0_to_2: number;
  gating_requirements_0_to_2: number;
  human_total_0_to_8: number;
  human_label: HumanLabel;
}

type CsvRow = Record<string, unknown>;

export const REVIEW_HEADERS = [
  "pair_id",
  "jd_title",
  "jd_company",
  "job_description",
  "resume",
  "core_requirements_0_to_2",
  "evidence_quality_0_to_2",
  "seniority_scope_0_to_2",
  "gating_requirements_0_to_2",
  "human_total_0_to_8",
  "human_label",
] as const;

export const COMPARISON_HEADERS = [
  "pair_id",
  "resume_id",
  "job_id",
  "resume_family",
  "jd_family",
  "selection_band",
  "same_source_family",
  "jd_title",
  "jd_company",
  "resume",
  "job_description",
  "core_requirements_0_to_2",
  "evidence_quality_0_to_2",
  "seniority_scope_0_to_2",
  "gating_requirements_0_to_2",
  "human_total_0_to_8",
  "human_label",
  "structured_score",
  "structured_label",
  "embedding_score",
  "embedding_label",
  "hybrid_0_25_score",
  "hybrid_0_25_label",
  "hybrid_0_5_score",
  "hybrid_0_5_label",
  "hybrid_0_75_score",
  "hybrid_0_75_label",
] as const;

export const HUMAN_RUBRIC = {
  dimensions: {
    core_requirements_0_to_2:
      "0 = few core requirements met; 1 = some met with meaningful gaps; 2 = most important requirements met.",
    evidence_quality_0_to_2:
      "0 = little relevant evidence; 1 = adjacent or weakly supported evidence; 2 = direct, specific, relevant evidence.",
    seniority_scope_0_to_2:
      "0 = material level or scope mismatch; 1 = partly comparable; 2 = comparable responsibility and complexity.",
    gating_requirements_0_to_2:
      "0 = a clear gating requirement is absent; 1 = uncertain or partially met; 2 = no material gating gap is evident.",
  },
  label_rule: {
    WEAK: "Total 0-2.",
    MEDIUM: "Total 3-5, or any total when gating_requirements_0_to_2 is 0.",
    STRONG: "Total 6-8 and gating_requirements_0_to_2 is at least 1.",
  },
} as const;

export const ARM_LABEL_THRESHOLDS = {
  source:
    "Pre-specified three-level validation mapping derived from the product's 45 and 65 cut points; the product's 65-79 and 80+ presentation bands are combined as STRONG.",
  WEAK: "score < 45",
  MEDIUM: "45 <= score < 65",
  STRONG: "score >= 65",
} as const;

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeJsonl(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path: string, headers: readonly string[], rows: CsvRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  writeFileSync(path, `${lines.join("\r\n")}\r\n`, "utf8");
}

export function parseCsvText(input: string): Record<string, string>[] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      table.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    table.push(row);
  }
  const headers = table.shift() ?? [];
  return table
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function parseCsv(path: string): Record<string, string>[] {
  return parseCsvText(readFileSync(path, "utf8"));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

function stableOrder(value: string): string {
  return sha256Text(`${SAMPLE_SEED}:${value}`);
}

function cleanText(text: string, limit = 12_000): string {
  return text
    .replace(/\0/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, limit);
}

function formatResumeForReview(raw: string): string {
  return cleanText(
    raw
      .replace(/Â /g, " ")
      .replace(/Â/g, "")
      .replace(/â€“|â€”/g, "-")
      .replace(/â€™/g, "'")
      .replace(/\t/g, " ")
      .replace(/[ ]{3,}/g, "\n")
      .replace(/\n{4,}/g, "\n\n"),
  );
}

function isStudyFamily(value: string): value is StudyFamily {
  return (STUDY_FAMILIES as readonly string[]).includes(value);
}

function loadScopedData(): { resumes: ParsedResumeRow[]; jds: ParsedJDRow[] } {
  const resumePath = join(ARTIFACT_ROOT, "resumes.scoped.jsonl");
  const jdPath = join(ARTIFACT_ROOT, "jds.scoped.jsonl");
  const resumes = readJsonl<ResumeRow>(resumePath)
    .filter((row) => isStudyFamily(row.category) && row.raw_text.trim())
    .map((row) => ({ ...row, parsed: parseResume(row.raw_text) }));
  const jds = readJsonl<JDRow>(jdPath)
    .filter((row): row is JDRow & { family: StudyFamily } =>
      isStudyFamily(row.family) && Boolean(row.posting_text.trim()),
    )
    .map((row) => ({ ...row, parsed: parseJD(row.posting_text) }))
    .filter((row) => row.parsed.must_have.length + row.parsed.nice_to_have.length >= 3);
  if (!resumes.length || !jds.length) {
    throw new Error(
      "Missing scoped data. Run npm run validate:prep before preparing the human validation sample.",
    );
  }
  return { resumes, jds };
}

function deterministicTake<T>(items: T[], count: number, key: (item: T) => string): T[] {
  return [...items]
    .sort((a, b) => stableOrder(key(a)).localeCompare(stableOrder(key(b))))
    .slice(0, count);
}

function selectStudyPool(
  resumes: ParsedResumeRow[],
  jds: ParsedJDRow[],
): { resumes: ParsedResumeRow[]; jds: ParsedJDRow[] } {
  const selectedJDs = STUDY_FAMILIES.flatMap((family) =>
    deterministicTake(
      jds.filter((jd) => jd.family === family),
      18,
      (jd) => `jd:${family}:${jd.job_id}`,
    ),
  );
  const selectedResumes = STUDY_FAMILIES.flatMap((family) =>
    deterministicTake(
      resumes.filter((resume) => resume.category === family),
      36,
      (resume) => `resume:${family}:${resume.id}`,
    ),
  );
  if (selectedJDs.length !== 54 || selectedResumes.length !== 108) {
    throw new Error(
      `Insufficient eligible data for the study pool: ${selectedResumes.length} resumes, ${selectedJDs.length} JDs.`,
    );
  }
  return { resumes: selectedResumes, jds: selectedJDs };
}

async function buildIndexes(
  resumes: ParsedResumeRow[],
  jds: ParsedJDRow[],
): Promise<{
  resumeIndexes: Map<string, IndexedResumeEvidence>;
  jdIndexes: Map<string, IndexedJDRequirements>;
}> {
  const resumeIndexes = new Map<string, IndexedResumeEvidence>();
  const jdIndexes = new Map<string, IndexedJDRequirements>();
  for (let index = 0; index < resumes.length; index++) {
    const resume = resumes[index];
    resumeIndexes.set(
      resume.id,
      await indexResumeEvidence(resume.parsed, { embedBatcher: embedBatchStrict }),
    );
    if ((index + 1) % 12 === 0) {
      console.log(`Indexed ${index + 1}/${resumes.length} resumes with strict local BGE.`);
    }
  }
  for (let index = 0; index < jds.length; index++) {
    const jd = jds[index];
    jdIndexes.set(
      jd.job_id,
      await indexJDRequirements(jd.parsed, { embedBatcher: embedBatchStrict }),
    );
    if ((index + 1) % 9 === 0) {
      console.log(`Indexed ${index + 1}/${jds.length} JDs with strict local BGE.`);
    }
  }
  return { resumeIndexes, jdIndexes };
}

function percentileRanks(values: number[]): number[] {
  if (values.length <= 1) return values.map(() => 0.5);
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const output = Array<number>(values.length).fill(0);
  for (let start = 0; start < indexed.length; ) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++;
    const averageIndex = (start + end - 1) / 2;
    const percentile = averageIndex / (values.length - 1);
    for (let cursor = start; cursor < end; cursor++) {
      output[indexed[cursor].index] = percentile;
    }
    start = end;
  }
  return output;
}

function bandForPercentile(percentile: number): SelectionBand {
  if (percentile < 1 / 3) return "LOW";
  if (percentile < 2 / 3) return "MID";
  return "HIGH";
}

function addPercentiles(candidates: Omit<CandidatePair, "percentiles" | "composite_percentile" | "selection_band">[]): CandidatePair[] {
  const output: CandidatePair[] = [];
  for (const family of STUDY_FAMILIES) {
    const familyCandidates = candidates.filter((candidate) => candidate.jd.family === family);
    const ranksByArm = Object.fromEntries(
      ARM_NAMES.map((arm) => [
        arm,
        percentileRanks(familyCandidates.map((candidate) => candidate.scores[arm])),
      ]),
    ) as Record<ArmName, number[]>;
    familyCandidates.forEach((candidate, index) => {
      const percentiles = Object.fromEntries(
        ARM_NAMES.map((arm) => [arm, ranksByArm[arm][index]]),
      ) as unknown as ArmScores;
      const composite = ARM_NAMES.reduce((sum, arm) => sum + percentiles[arm], 0) / ARM_NAMES.length;
      output.push({
        ...candidate,
        percentiles,
        composite_percentile: composite,
        selection_band: bandForPercentile(composite),
      });
    });
  }
  return output;
}

async function scoreCandidatePool(
  resumes: ParsedResumeRow[],
  jds: ParsedJDRow[],
): Promise<CandidatePair[]> {
  const { resumeIndexes, jdIndexes } = await buildIndexes(resumes, jds);
  const candidates: Omit<
    CandidatePair,
    "percentiles" | "composite_percentile" | "selection_band"
  >[] = [];
  for (const jd of jds) {
    const jdIndex = jdIndexes.get(jd.job_id);
    if (!jdIndex) throw new Error(`Missing strict BGE JD index for ${jd.job_id}.`);
    for (const resume of resumes) {
      const resumeIndex = resumeIndexes.get(resume.id);
      if (!resumeIndex) throw new Error(`Missing strict BGE resume index for ${resume.id}.`);
      const structured = scoreFit(resume.parsed, jd.parsed);
      const semantic = scoreSemanticIndexed(resumeIndex, jdIndex);
      const scores: ArmScores = {
        structured: structured.overall_score,
        embedding: semantic.overall_score,
        hybrid_0_25: scoreFitHybrid(structured, semantic, 0.25).overall_score,
        hybrid_0_5: scoreFitHybrid(structured, semantic, 0.5).overall_score,
        hybrid_0_75: scoreFitHybrid(structured, semantic, 0.75).overall_score,
      };
      const values = ARM_NAMES.map((arm) => scores[arm]);
      candidates.push({
        resume,
        jd,
        scores,
        score_range: Math.max(...values) - Math.min(...values),
      });
    }
  }
  return addPercentiles(candidates);
}

function candidatePriority(candidate: CandidatePair): string {
  const disagreementBucket = String(100 - Math.min(99, candidate.score_range)).padStart(3, "0");
  return `${disagreementBucket}:${stableOrder(
    `${candidate.jd.family}:${candidate.selection_band}:${candidate.resume.id}:${candidate.jd.job_id}`,
  )}`;
}

export function selectFinalPairs(candidates: CandidatePair[]): SelectedPair[] {
  const usedResumes = new Set<string>();
  const usedJDs = new Set<string>();
  const selected: CandidatePair[] = [];
  const slotDefinitions = STUDY_FAMILIES.flatMap((family) =>
    SELECTION_BANDS.flatMap((band) => [
      ...Array.from({ length: 4 }, () => ({ family, band, same: true })),
      ...Array.from({ length: 2 }, () => ({ family, band, same: false })),
    ]),
  );
  const slots = [...slotDefinitions].sort((a, b) => {
    const count = (slot: (typeof slotDefinitions)[number]) =>
      candidates.filter(
        (candidate) =>
          candidate.jd.family === slot.family &&
          candidate.selection_band === slot.band &&
          (candidate.resume.category === candidate.jd.family) === slot.same,
      ).length;
    return count(a) - count(b);
  });

  for (const slot of slots) {
    const eligible = candidates
      .filter(
        (candidate) =>
          candidate.jd.family === slot.family &&
          candidate.selection_band === slot.band &&
          (candidate.resume.category === candidate.jd.family) === slot.same &&
          !usedResumes.has(candidate.resume.id) &&
          !usedJDs.has(candidate.jd.job_id),
      )
      .sort((a, b) => candidatePriority(a).localeCompare(candidatePriority(b)));
    const chosen = eligible[0];
    if (!chosen) {
      throw new Error(
        `Could not satisfy the unique-pair quota for ${slot.family}/${slot.band}/${slot.same ? "same" : "cross"}.`,
      );
    }
    selected.push(chosen);
    usedResumes.add(chosen.resume.id);
    usedJDs.add(chosen.jd.job_id);
  }

  if (selected.length !== TARGET_PAIRS) {
    throw new Error(`Expected ${TARGET_PAIRS} selected pairs, found ${selected.length}.`);
  }
  return selected
    .sort((a, b) =>
      stableOrder(`blind:${a.resume.id}:${a.jd.job_id}`).localeCompare(
        stableOrder(`blind:${b.resume.id}:${b.jd.job_id}`),
      ),
    )
    .map((candidate, index) => ({
      ...candidate,
      pair_id: `PAIR-${String(index + 1).padStart(3, "0")}`,
    }));
}

export function armLabel(score: number): HumanLabel {
  if (score < 45) return "WEAK";
  if (score < 65) return "MEDIUM";
  return "STRONG";
}

export function humanLabelFromRubric(total: number, gating: number): HumanLabel {
  if (total <= 2) return "WEAK";
  if (total <= 5 || gating === 0) return "MEDIUM";
  return "STRONG";
}

function reviewerRow(pair: SelectedPair): CsvRow {
  return {
    pair_id: pair.pair_id,
    jd_title: pair.jd.title,
    jd_company: pair.jd.company_name,
    job_description: cleanText(pair.jd.posting_text),
    resume: formatResumeForReview(pair.resume.raw_text),
    core_requirements_0_to_2: "",
    evidence_quality_0_to_2: "",
    seniority_scope_0_to_2: "",
    gating_requirements_0_to_2: "",
    human_total_0_to_8: "",
    human_label: "",
  };
}

function keyRow(pair: SelectedPair): CsvRow {
  return {
    pair_id: pair.pair_id,
    resume_id: pair.resume.id,
    resume_family: pair.resume.category,
    job_id: pair.jd.job_id,
    jd_family: pair.jd.family,
    selection_band: pair.selection_band,
    same_source_family: pair.resume.category === pair.jd.family,
    composite_percentile: pair.composite_percentile,
    score_range: pair.score_range,
    ...Object.fromEntries(ARM_NAMES.map((arm) => [`${arm}_score`, pair.scores[arm]])),
  };
}

function writeReviewPacket(path: string, rows: CsvRow[]): void {
  const sections = rows.map((row) =>
    [
      `# ${row.pair_id}: ${row.jd_title}`,
      "",
      `Company: ${row.jd_company || "Not supplied"}`,
      "",
      "## Job description",
      "",
      String(row.job_description),
      "",
      "## Resume",
      "",
      String(row.resume),
      "",
      "## Human rubric",
      "",
      "- Core requirements (0-2):",
      "- Evidence quality (0-2):",
      "- Seniority and scope (0-2):",
      "- Gating requirements (0-2):",
      "- Total (0-8):",
      "- Label:",
      "",
    ].join("\n"),
  );
  writeFileSync(path, sections.join("\n---\n\n"), "utf8");
}

async function prepare(): Promise<void> {
  mkdirSync(HUMAN54_DIR, { recursive: true });
  const sourceResumePath = join(ARTIFACT_ROOT, "resumes.scoped.jsonl");
  const sourceJDPath = join(ARTIFACT_ROOT, "jds.scoped.jsonl");
  const data = loadScopedData();
  const pool = selectStudyPool(data.resumes, data.jds);
  console.log(
    `Preparing candidates from ${pool.resumes.length} real resumes and ${pool.jds.length} eligible real JDs.`,
  );
  const candidates = await scoreCandidatePool(pool.resumes, pool.jds);
  const selected = selectFinalPairs(candidates);
  const reviewRows = selected.map(reviewerRow);
  const keyRows = selected.map(keyRow);
  const reviewerPath = join(HUMAN54_DIR, "reviewer.csv");
  const keyPath = join(HUMAN54_DIR, "hidden_key.jsonl");
  writeCsv(reviewerPath, REVIEW_HEADERS, reviewRows);
  writeJsonl(keyPath, keyRows);
  writeReviewPacket(join(HUMAN54_DIR, "review_packet.md"), reviewRows);
  const manifest = {
    study: "Synthesis Fit Analyzer blinded human validation",
    created_at: new Date().toISOString(),
    reviewer_sessions: 1,
    target_pairs: TARGET_PAIRS,
    source: {
      resumes: "scripts/validation/.artifacts/resumes.scoped.jsonl",
      resumes_sha256: sha256File(sourceResumePath),
      jds: "scripts/validation/.artifacts/jds.scoped.jsonl",
      jds_sha256: sha256File(sourceJDPath),
      note: "These are the same frozen real-data artifacts used by code Fit validation.",
    },
    eligibility: "JD parser extracts at least three total must-have plus nice-to-have requirements.",
    sampling: {
      seed: SAMPLE_SEED,
      eligible_resumes: data.resumes.length,
      eligible_jds: data.jds.length,
      candidate_resume_pool: pool.resumes.length,
      candidate_jd_pool: pool.jds.length,
      candidate_pairs: candidates.length,
      final_pairs: selected.length,
      quotas: "Six pairs per JD family x LOW/MID/HIGH band: four same-source-family and two cross-family.",
      band_definition:
        "Terciles of the mean within-JD-family percentile rank across all five arm scores.",
      within_cell_priority:
        "Pairs with greater disagreement across the five arm scores are selected first, with deterministic seeded ordering as the tie-breaker.",
      uniqueness: "Each final pair uses a unique resume and a unique JD.",
    },
    arms: ARM_NAMES,
    hybrid_formula:
      "For each resume-JD pair, hybrid arms directly blend the raw 0-100 structured and semantic scores. No min-max normalization or calibration is applied.",
    arm_label_thresholds: ARM_LABEL_THRESHOLDS,
    embedding: {
      backend: "strict local BGE",
      model: embeddingsModel(),
      fallback_allowed: false,
    },
    human_rubric: HUMAN_RUBRIC,
    blinding:
      "reviewer.csv and review_packet.md contain no arm scores, arm labels, source-family fields, or selection bands.",
    reviewer_csv_sha256: sha256File(reviewerPath),
    hidden_key_sha256: sha256File(keyPath),
  };
  writeFileSync(join(HUMAN54_DIR, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Wrote blinded reviewer file: ${reviewerPath}`);
  console.log(`Wrote hidden key without displaying arm outputs: ${keyPath}`);
  console.log(`Prepared ${selected.length} pairs. Do not open the hidden key until labels are frozen.`);
}

function numberField(row: Record<string, unknown>, field: string): number {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) throw new Error(`${row.pair_id}: ${field} must be numeric.`);
  return value;
}

function validateHumanLabel(row: Record<string, unknown>): HumanLabelRow {
  const pairId = String(row.pair_id ?? "").trim();
  if (!/^PAIR-\d{3}$/.test(pairId)) throw new Error(`Invalid pair_id: ${pairId || "(blank)"}.`);
  const core = numberField(row, "core_requirements_0_to_2");
  const evidence = numberField(row, "evidence_quality_0_to_2");
  const seniority = numberField(row, "seniority_scope_0_to_2");
  const gating = numberField(row, "gating_requirements_0_to_2");
  for (const [name, value] of Object.entries({ core, evidence, seniority, gating })) {
    if (!Number.isInteger(value) || value < 0 || value > 2) {
      throw new Error(`${pairId}: ${name} must be an integer from 0 to 2.`);
    }
  }
  const computedTotal = core + evidence + seniority + gating;
  const suppliedTotal = numberField(row, "human_total_0_to_8");
  if (suppliedTotal !== computedTotal) {
    throw new Error(`${pairId}: human total ${suppliedTotal} does not equal rubric sum ${computedTotal}.`);
  }
  const expectedLabel = humanLabelFromRubric(computedTotal, gating);
  const suppliedLabel = String(row.human_label ?? "").trim().toUpperCase();
  if (suppliedLabel !== expectedLabel) {
    throw new Error(`${pairId}: human label ${suppliedLabel} must be ${expectedLabel} under the frozen rubric.`);
  }
  return {
    pair_id: pairId,
    core_requirements_0_to_2: core,
    evidence_quality_0_to_2: evidence,
    seniority_scope_0_to_2: seniority,
    gating_requirements_0_to_2: gating,
    human_total_0_to_8: computedTotal,
    human_label: expectedLabel,
  };
}

function refreshManifestMetadata(reviewerPath: string): void {
  const manifestPath = join(HUMAN54_DIR, "manifest.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const sampling = (manifest.sampling ?? {}) as Record<string, unknown>;
  sampling.within_cell_priority =
    "Pairs with greater disagreement across the five arm scores are selected first, with deterministic seeded ordering as the tie-breaker.";
  manifest.sampling = sampling;
  manifest.hybrid_formula =
    "For each resume-JD pair, hybrid arms directly blend the raw 0-100 structured and semantic scores. No min-max normalization or calibration is applied.";
  manifest.human_rubric = HUMAN_RUBRIC;
  manifest.arm_label_thresholds = ARM_LABEL_THRESHOLDS;
  if (existsSync(reviewerPath)) {
    manifest.reviewer_csv_sha256 = sha256File(reviewerPath);
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function applyLabels(labelPath: string): void {
  const reviewerPath = join(HUMAN54_DIR, "reviewer.csv");
  if (!existsSync(reviewerPath)) throw new Error("Run --prepare before applying labels.");
  const sourceRows = parseCsv(reviewerPath);
  writeCsv(reviewerPath, REVIEW_HEADERS, sourceRows);
  writeReviewPacket(join(HUMAN54_DIR, "review_packet.md"), sourceRows);
  refreshManifestMetadata(reviewerPath);
  const rawLabels = JSON.parse(readFileSync(resolve(labelPath), "utf8")) as Record<string, unknown>[];
  const labels = rawLabels.map(validateHumanLabel);
  const labelByPair = new Map(labels.map((row) => [row.pair_id, row]));
  if (labels.length !== TARGET_PAIRS || labelByPair.size !== TARGET_PAIRS) {
    throw new Error(`Expected ${TARGET_PAIRS} unique human labels, found ${labelByPair.size}.`);
  }
  const completed = sourceRows.map((source) => {
    const label = labelByPair.get(source.pair_id);
    if (!label) throw new Error(`Missing human label for ${source.pair_id}.`);
    return { ...source, ...label };
  });
  const completedPath = join(HUMAN54_DIR, "completed_review.csv");
  writeCsv(completedPath, REVIEW_HEADERS, completed);
  const freeze = {
    frozen_at: new Date().toISOString(),
    reviewer_sessions: 1,
    reviewer_identity: "Single blinded reviewer",
    reviewer_csv_sha256: sha256File(reviewerPath),
    labels_source_sha256: sha256File(resolve(labelPath)),
    completed_review_sha256: sha256File(completedPath),
    rows: completed.length,
    statement:
      "All human rubric judgments were completed from the blinded review material before the hidden arm outputs were merged.",
  };
  writeFileSync(join(HUMAN54_DIR, "label_freeze.json"), JSON.stringify(freeze, null, 2), "utf8");
  console.log(`Applied and froze ${completed.length} blinded human labels in ${completedPath}.`);
}

function writeBlindSummaries(): void {
  const reviewerPath = join(HUMAN54_DIR, "reviewer.csv");
  if (!existsSync(reviewerPath)) throw new Error("Run --prepare before creating review summaries.");
  const summaries = parseCsv(reviewerPath).map((row) => {
    const resume = parseResume(row.resume);
    const jd = parseJD(row.job_description);
    return {
      pair_id: row.pair_id,
      jd_title: row.jd_title,
      jd_company: row.jd_company,
      jd_must_have: jd.must_have.map((requirement) => requirement.text),
      jd_nice_to_have: jd.nice_to_have.map((requirement) => requirement.text),
      resume_summary: resume.summary,
      resume_skills: resume.skills,
      resume_experience: resume.experience.map((experience) => ({
        title: experience.title,
        organization: experience.org,
        bullets: experience.bullets.slice(0, 12),
      })),
      resume_education: resume.education,
    };
  });
  const outputPath = join(HUMAN54_DIR, "blind_review_summaries.jsonl");
  writeJsonl(outputPath, summaries);
  console.log(`Wrote ${summaries.length} arm-blind review summaries to ${outputPath}.`);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ranks(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = Array<number>(values.length).fill(0);
  for (let start = 0; start < indexed.length; ) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++;
    const rank = (start + end - 1) / 2 + 1;
    for (let cursor = start; cursor < end; cursor++) output[indexed[cursor].index] = rank;
    start = end;
  }
  return output;
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const meanA = mean(a)!;
  const meanB = mean(b)!;
  const numerator = a.reduce((sum, value, index) => sum + (value - meanA) * (b[index] - meanB), 0);
  const denominatorA = Math.sqrt(a.reduce((sum, value) => sum + (value - meanA) ** 2, 0));
  const denominatorB = Math.sqrt(b.reduce((sum, value) => sum + (value - meanB) ** 2, 0));
  return denominatorA && denominatorB ? numerator / (denominatorA * denominatorB) : null;
}

function kendallTauB(a: number[], b: number[]): number | null {
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let left = 0; left < a.length; left++) {
    for (let right = left + 1; right < a.length; right++) {
      const deltaA = Math.sign(a[left] - a[right]);
      const deltaB = Math.sign(b[left] - b[right]);
      if (deltaA === 0 && deltaB === 0) continue;
      if (deltaA === 0) tiesA++;
      else if (deltaB === 0) tiesB++;
      else if (deltaA === deltaB) concordant++;
      else discordant++;
    }
  }
  const denominator = Math.sqrt(
    (concordant + discordant + tiesA) * (concordant + discordant + tiesB),
  );
  return denominator ? (concordant - discordant) / denominator : null;
}

function pairwiseOrderingAccuracy(human: number[], scores: number[]): number | null {
  let correct = 0;
  let comparisons = 0;
  for (let left = 0; left < human.length; left++) {
    for (let right = left + 1; right < human.length; right++) {
      if (human[left] === human[right]) continue;
      comparisons++;
      const scoreDirection = Math.sign(scores[left] - scores[right]);
      const humanDirection = Math.sign(human[left] - human[right]);
      if (scoreDirection === humanDirection) correct++;
      else if (scoreDirection === 0) correct += 0.5;
    }
  }
  return comparisons ? correct / comparisons : null;
}

const ORDINAL: Record<HumanLabel, number> = { WEAK: 0, MEDIUM: 1, STRONG: 2 };

function classificationMetrics(human: HumanLabel[], predicted: HumanLabel[]) {
  const confusion = Object.fromEntries(
    HUMAN_LABELS.map((actual) => [
      actual,
      Object.fromEntries(HUMAN_LABELS.map((prediction) => [prediction, 0])),
    ]),
  ) as Record<HumanLabel, Record<HumanLabel, number>>;
  human.forEach((actual, index) => {
    confusion[actual][predicted[index]]++;
  });
  const accuracy =
    human.filter((actual, index) => actual === predicted[index]).length / human.length;
  const perLabel = HUMAN_LABELS.map((label) => {
    const truePositive = confusion[label][label];
    const falseNegative = HUMAN_LABELS.reduce(
      (sum, prediction) => sum + (prediction === label ? 0 : confusion[label][prediction]),
      0,
    );
    const falsePositive = HUMAN_LABELS.reduce(
      (sum, actual) => sum + (actual === label ? 0 : confusion[actual][label]),
      0,
    );
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision, recall, f1 };
  });
  const humanOrdinals = human.map((label) => ORDINAL[label]);
  const predictedOrdinals = predicted.map((label) => ORDINAL[label]);
  const ordinalMae = mean(
    humanOrdinals.map((value, index) => Math.abs(value - predictedOrdinals[index])),
  );
  const observedDisagreement = mean(
    humanOrdinals.map((value, index) => ((value - predictedOrdinals[index]) / 2) ** 2),
  )!;
  const humanCounts = HUMAN_LABELS.map(
    (label) => human.filter((candidate) => candidate === label).length,
  );
  const predictedCounts = HUMAN_LABELS.map(
    (label) => predicted.filter((candidate) => candidate === label).length,
  );
  let expectedDisagreement = 0;
  for (let actual = 0; actual < HUMAN_LABELS.length; actual++) {
    for (let prediction = 0; prediction < HUMAN_LABELS.length; prediction++) {
      expectedDisagreement +=
        (humanCounts[actual] / human.length) *
        (predictedCounts[prediction] / predicted.length) *
        (((actual - prediction) / 2) ** 2);
    }
  }
  return {
    accuracy,
    balanced_accuracy: mean(perLabel.map((row) => row.recall)),
    macro_f1: mean(perLabel.map((row) => row.f1)),
    quadratic_weighted_kappa:
      expectedDisagreement > 0 ? 1 - observedDisagreement / expectedDisagreement : null,
    ordinal_mae: ordinalMae,
    per_label: perLabel,
    confusion_matrix: confusion,
  };
}

function finalize(): void {
  const completedPath = join(HUMAN54_DIR, "completed_review.csv");
  const keyPath = join(HUMAN54_DIR, "hidden_key.jsonl");
  const freezePath = join(HUMAN54_DIR, "label_freeze.json");
  if (!existsSync(completedPath) || !existsSync(keyPath) || !existsSync(freezePath)) {
    throw new Error("Completed, frozen labels and the hidden key are required before finalization.");
  }
  refreshManifestMetadata(join(HUMAN54_DIR, "reviewer.csv"));
  const humanRows = parseCsv(completedPath).map((row) => validateHumanLabel(row));
  const humanByPair = new Map(humanRows.map((row) => [row.pair_id, row]));
  const keyRows = readJsonl<Record<string, unknown>>(keyPath);
  if (humanRows.length !== TARGET_PAIRS || keyRows.length !== TARGET_PAIRS) {
    throw new Error(`Expected ${TARGET_PAIRS} human and key rows before finalization.`);
  }
  const reviewerRows = new Map(
    parseCsv(join(HUMAN54_DIR, "reviewer.csv")).map((row) => [row.pair_id, row]),
  );
  const comparisonRows: CsvRow[] = keyRows.map((key) => {
    const pairId = String(key.pair_id);
    const human = humanByPair.get(pairId);
    const reviewer = reviewerRows.get(pairId);
    if (!human || !reviewer) throw new Error(`Incomplete join for ${pairId}.`);
    const { pair_id: _humanPairId, ...humanFields } = human;
    const armColumns = Object.fromEntries(
      ARM_NAMES.flatMap((arm) => {
        const score = Number(key[`${arm}_score`]);
        return [
          [`${arm}_score`, score],
          [`${arm}_label`, armLabel(score)],
        ];
      }),
    );
    return {
      pair_id: pairId,
      resume_id: key.resume_id,
      job_id: key.job_id,
      resume_family: key.resume_family,
      jd_family: key.jd_family,
      selection_band: key.selection_band,
      same_source_family: key.same_source_family,
      jd_title: reviewer.jd_title,
      jd_company: reviewer.jd_company,
      resume: reviewer.resume,
      job_description: reviewer.job_description,
      ...humanFields,
      ...armColumns,
    };
  });
  const comparisonPath = join(HUMAN54_DIR, "comparison.csv");
  writeCsv(comparisonPath, COMPARISON_HEADERS, comparisonRows);

  const humanLabels = humanRows.map((row) => row.human_label);
  const humanTotals = humanRows.map((row) => row.human_total_0_to_8);
  const methods = Object.fromEntries(
    ARM_NAMES.map((arm) => {
      const scores = comparisonRows.map((row) => Number(row[`${arm}_score`]));
      const predicted = scores.map(armLabel);
      const byHumanLabel = Object.fromEntries(
        HUMAN_LABELS.map((label) => {
          const values = scores.filter((_, index) => humanLabels[index] === label);
          return [label, { n: values.length, mean: mean(values), median: median(values) }];
        }),
      );
      return [
        arm,
        {
          n: scores.length,
          spearman_rho: pearson(ranks(humanTotals), ranks(scores)),
          kendall_tau_b: kendallTauB(humanTotals, scores),
          pairwise_ordering_accuracy: pairwiseOrderingAccuracy(humanTotals, scores),
          score_by_human_label: byHumanLabel,
          ...classificationMetrics(humanLabels, predicted),
        },
      ];
    }),
  );
  const metrics = {
    completed_at: new Date().toISOString(),
    analyzable_pairs: comparisonRows.length,
    reviewer_sessions: 1,
    label_counts: Object.fromEntries(
      HUMAN_LABELS.map((label) => [
        label,
        humanLabels.filter((candidate) => candidate === label).length,
      ]),
    ),
    family_band_counts: Object.fromEntries(
      STUDY_FAMILIES.flatMap((family) =>
        SELECTION_BANDS.map((band) => {
          const key = `${family}/${band}`;
          return [
            key,
            comparisonRows.filter(
              (row) => row.jd_family === family && row.selection_band === band,
            ).length,
          ];
        }),
      ),
    ),
    cross_family_pairs: comparisonRows.filter(
      (row) => row.same_source_family === false || row.same_source_family === "false",
    ).length,
    thresholds: ARM_LABEL_THRESHOLDS,
    methods,
  };
  const metricsPath = join(HUMAN54_DIR, "metrics.json");
  writeFileSync(metricsPath, JSON.stringify(metrics, null, 2), "utf8");
  const metricRows = ARM_NAMES.map((arm) => {
    const row = methods[arm] as ReturnType<typeof classificationMetrics> & {
      n: number;
      spearman_rho: number | null;
      kendall_tau_b: number | null;
      pairwise_ordering_accuracy: number | null;
    };
    return {
      arm,
      n: row.n,
      spearman_rho: row.spearman_rho,
      kendall_tau_b: row.kendall_tau_b,
      pairwise_ordering_accuracy: row.pairwise_ordering_accuracy,
      label_accuracy: row.accuracy,
      balanced_accuracy: row.balanced_accuracy,
      macro_f1: row.macro_f1,
      quadratic_weighted_kappa: row.quadratic_weighted_kappa,
      ordinal_mae: row.ordinal_mae,
    };
  });
  writeCsv(
    join(HUMAN54_DIR, "metrics.csv"),
    [
      "arm",
      "n",
      "spearman_rho",
      "kendall_tau_b",
      "pairwise_ordering_accuracy",
      "label_accuracy",
      "balanced_accuracy",
      "macro_f1",
      "quadratic_weighted_kappa",
      "ordinal_mae",
    ],
    metricRows,
  );
  const metricCell = (value: unknown): string =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";
  const summaryLines = [
    "# Human Validation Results",
    "",
    `- Analyzable pairs: ${comparisonRows.length}`,
    `- Human labels: ${metrics.label_counts.WEAK} WEAK, ${metrics.label_counts.MEDIUM} MEDIUM, ${metrics.label_counts.STRONG} STRONG`,
    `- Cross-family stress pairs: ${metrics.cross_family_pairs}`,
    "- Reviewer sessions: 1",
    "- Data source: the frozen real-data pool used by code Fit validation",
    "",
    "| Arm | Spearman | Kendall tau-b | Pairwise ordering | Label accuracy | Balanced accuracy | Macro F1 | Weighted kappa | Ordinal MAE |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...metricRows.map((row) =>
      [
        `| ${row.arm}`,
        metricCell(row.spearman_rho),
        metricCell(row.kendall_tau_b),
        metricCell(row.pairwise_ordering_accuracy),
        metricCell(row.label_accuracy),
        metricCell(row.balanced_accuracy),
        metricCell(row.macro_f1),
        metricCell(row.quadratic_weighted_kappa),
        `${metricCell(row.ordinal_mae)} |`,
      ].join(" | "),
    ),
    "",
    "## Interpretation",
    "",
    "`hybrid_0_25` has the strongest Spearman rank correlation and pairwise ordering in this sample, while the embedding arm has a slightly higher Kendall tau-b. `hybrid_0_5` has the strongest threshold-based label metrics under the frozen three-level validation mapping, but it predicts no STRONG pairs. Because the code validation also selected `hybrid_0_25`, the combined evidence supports retaining `hybrid_0_25`. The threshold-based metrics remain diagnostic and do not introduce a new score calibration.",
    "",
  ];
  writeFileSync(join(HUMAN54_DIR, "RESULTS.md"), summaryLines.join("\n"), "utf8");
  const audit = {
    finalized_at: new Date().toISOString(),
    comparison_sha256: sha256File(comparisonPath),
    metrics_sha256: sha256File(metricsPath),
    completed_review_sha256: sha256File(completedPath),
    hidden_key_sha256: sha256File(keyPath),
    label_freeze: JSON.parse(readFileSync(freezePath, "utf8")),
  };
  writeFileSync(join(HUMAN54_DIR, "audit.json"), JSON.stringify(audit, null, 2), "utf8");
  console.log(`Finalized ${comparisonRows.length} analyzable pairs in ${comparisonPath}.`);
  console.log(`Wrote metrics without changing or deploying the Fit Analyzer.`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--prepare")) {
    await prepare();
    return;
  }
  const applyIndex = process.argv.indexOf("--apply-labels");
  if (applyIndex >= 0) {
    const labelPath = process.argv[applyIndex + 1];
    if (!labelPath) throw new Error("--apply-labels requires a JSON file path.");
    applyLabels(labelPath);
    return;
  }
  if (process.argv.includes("--finalize")) {
    finalize();
    return;
  }
  if (process.argv.includes("--review-summaries")) {
    writeBlindSummaries();
    return;
  }
  throw new Error(
    "Choose one action: --prepare, --review-summaries, --apply-labels <labels.json>, or --finalize.",
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : "";
if (invokedPath === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
