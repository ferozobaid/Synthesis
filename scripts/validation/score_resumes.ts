/**
 * Scoped real-JD validation scorer - OFFLINE PLANE.
 *
 * Scores the same frozen resume x posting-level-JD split with:
 *   - structured: current deterministic rules scoreFit()
 *   - embedding : requirement-level semantic evidence retrieval
 *   - hybrid    : per-resume min-max blend of structured + embedding
 *
 * The semantic scorer lives in lib/ for future production reuse, but this phase
 * only calls it from validation; /api/fit/analyze remains rules-only.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { embeddingsEnabled } from "@/lib/config";
import { scoreFit } from "@/lib/matching";
import {
  indexJDRequirements,
  indexResumeEvidence,
  scoreSemanticIndexed,
  type IndexedJDRequirements,
} from "@/lib/matching-semantic";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import type { JDRequirements, ParsedResume } from "@/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ART = join(HERE, ".artifacts");
const smoke = process.argv.includes("--smoke") || process.argv.includes("--fixtures");
const suffix = smoke ? "smoke" : "scoped";

const resumePath = join(ART, `resumes.${suffix}.jsonl`);
const jdPath = join(ART, `jds.${suffix}.jsonl`);
const outPath = join(ART, `results.${suffix}.jsonl`);
const jdDiagnosticsPath = join(ART, `jd_parse_diagnostics.${suffix}.json`);

const HYBRID_STRUCTURED_WEIGHTS = [0.25, 0.5, 0.75] as const;
const DEFAULT_MIN_JD_REQUIREMENTS = smoke ? 0 : 3;

function loadDotenv(): void {
  const path = join(HERE, "..", "..", ".env.local");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...parts] = line.split("=");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = parts.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

loadDotenv();

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
}

interface ParsedJDCandidate extends JDRow {
  parsed: JDRequirements;
  requirementCount: number;
}

interface PreparedJD extends ParsedJDCandidate {
  semantic: IndexedJDRequirements;
}

interface PreparedResume extends ResumeRow {
  parsed: ParsedResume;
  semantic: Awaited<ReturnType<typeof indexResumeEvidence>>;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function sampleArg(): number | null {
  const i = process.argv.indexOf("--sample");
  if (i === -1) return null;
  const n = parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function intArg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const n = parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function stratifiedSample<T extends { category: string }>(rows: T[], n: number): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const row of rows) {
    const count = seen.get(row.category) ?? 0;
    if (count < n) {
      out.push(row);
      seen.set(row.category, count + 1);
    }
  }
  return out;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function minMax(scores: Record<string, number>): Record<string, number> {
  const values = Object.values(scores);
  if (!values.length) return {};
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const out: Record<string, number> = {};
  for (const [family, value] of Object.entries(scores)) {
    out[family] = span === 0 ? 0.5 : (value - lo) / span;
  }
  return out;
}

function blend(
  structured: Record<string, number>,
  embedding: Record<string, number>,
  structuredWeight: number,
): Record<string, number> {
  const s = minMax(structured);
  const e = minMax(embedding);
  const out: Record<string, number> = {};
  for (const family of new Set([...Object.keys(s), ...Object.keys(e)])) {
    out[family] =
      structuredWeight * (s[family] ?? 0) + (1 - structuredWeight) * (e[family] ?? 0);
  }
  return out;
}

function requirementCount(parsed: JDRequirements): number {
  return parsed.must_have.length + parsed.nice_to_have.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function jdFamilyCounts(rows: Pick<JDRow, "family">[]): Record<string, number> {
  const families = [...new Set(rows.map((jd) => jd.family))].sort();
  return Object.fromEntries(
    families.map((family) => [family, rows.filter((jd) => jd.family === family).length]),
  );
}

function buildJDParseDiagnostics(rows: ParsedJDCandidate[], minJDRequirements: number) {
  const families = [...new Set(rows.map((jd) => jd.family))].sort();
  const byFamily = Object.fromEntries(
    families.map((family) => {
      const familyRows = rows.filter((jd) => jd.family === family);
      const counts = familyRows.map((jd) => jd.requirementCount);
      const dropped = familyRows.filter((jd) => jd.requirementCount < minJDRequirements);
      return [
        family,
        {
          total: familyRows.length,
          kept: familyRows.length - dropped.length,
          dropped: dropped.length,
          zero_requirement: counts.filter((n) => n === 0).length,
          one_requirement: counts.filter((n) => n === 1).length,
          two_requirements: counts.filter((n) => n === 2).length,
          min: counts.length ? Math.min(...counts) : 0,
          max: counts.length ? Math.max(...counts) : 0,
          mean: Number(average(counts).toFixed(2)),
          median: Number(median(counts).toFixed(2)),
          dropped_examples: dropped.slice(0, 5).map((jd) => ({
            job_id: jd.job_id,
            title: jd.title,
            company_name: jd.company_name,
            requirement_count: jd.requirementCount,
          })),
        },
      ];
    }),
  );

  const kept = rows.filter((jd) => jd.requirementCount >= minJDRequirements).length;
  return {
    mode: smoke ? "smoke" : "scoped-real-jd",
    min_jd_requirements: minJDRequirements,
    total: rows.length,
    kept,
    dropped: rows.length - kept,
    original_counts: jdFamilyCounts(rows),
    kept_counts: jdFamilyCounts(rows.filter((jd) => jd.requirementCount >= minJDRequirements)),
    families: byFamily,
  };
}

async function prepareJDs(
  rows: JDRow[],
  minJDRequirements: number,
): Promise<{ jds: PreparedJD[]; diagnostics: ReturnType<typeof buildJDParseDiagnostics> }> {
  const parsedRows = rows.map((row) => {
    const parsed = parseJD(row.posting_text);
    return { ...row, parsed, requirementCount: requirementCount(parsed) };
  });
  const diagnostics = buildJDParseDiagnostics(parsedRows, minJDRequirements);
  const keptRows = parsedRows.filter((row) => row.requirementCount >= minJDRequirements);
  if (!keptRows.length) {
    throw new Error(
      `JD parseability gate dropped every JD (min requirements: ${minJDRequirements}).`,
    );
  }

  const out: PreparedJD[] = [];
  let n = 0;
  for (const row of keptRows) {
    const semantic = await indexJDRequirements(row.parsed);
    out.push({ ...row, semantic });
    if (++n % 25 === 0) console.log(`  indexed ${n}/${keptRows.length} JDs`);
  }
  return { jds: out, diagnostics };
}

async function prepareResumes(rows: ResumeRow[]): Promise<PreparedResume[]> {
  const out: PreparedResume[] = [];
  let n = 0;
  for (const row of rows) {
    const parsed = parseResume(row.raw_text);
    const semantic = await indexResumeEvidence(parsed);
    out.push({ ...row, parsed, semantic });
    if (++n % 50 === 0) console.log(`  indexed ${n}/${rows.length} resumes`);
  }
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(resumePath) || !existsSync(jdPath)) {
    throw new Error(
      `Missing inputs (${resumePath} / ${jdPath}). Run ` +
        `python scripts/validation/prepare_data.py${smoke ? " --smoke" : ""} first.`,
    );
  }

  let resumeRows = readJsonl<ResumeRow>(resumePath);
  const sample = sampleArg();
  if (sample) {
    resumeRows = stratifiedSample(resumeRows, sample);
    console.log(`Stratified resume sample: <=${sample}/family -> ${resumeRows.length}`);
  }
  const jdRows = readJsonl<JDRow>(jdPath);
  const minJDRequirements = intArg("--min-jd-requirements", DEFAULT_MIN_JD_REQUIREMENTS);

  console.log(
    `Scoring ${resumeRows.length} resumes x ${jdRows.length} real JDs ` +
      `(${smoke ? "smoke" : "scoped"}, embeddings: ${embeddingsEnabled() ? "enabled" : "MOCK"}).`,
  );

  console.log("Indexing JDs...");
  const { jds, diagnostics } = await prepareJDs(jdRows, minJDRequirements);
  const families = [...new Set(jds.map((jd) => jd.family))].sort();
  const jdCounts = jdFamilyCounts(jds);
  mkdirSync(dirname(jdDiagnosticsPath), { recursive: true });
  writeFileSync(jdDiagnosticsPath, JSON.stringify(diagnostics, null, 2));
  console.log(
    `JD parseability gate: >=${minJDRequirements} parsed requirements, ` +
      `${diagnostics.kept}/${diagnostics.total} JDs kept.`,
  );
  console.log(`JD diagnostics -> ${jdDiagnosticsPath}`);
  console.log("Indexing resumes...");
  const resumes = await prepareResumes(resumeRows);

  mkdirSync(dirname(outPath), { recursive: true });
  const lines: string[] = [];
  let n = 0;
  for (const resume of resumes) {
    const structuredBuckets: Record<string, number[]> = Object.fromEntries(
      families.map((family) => [family, []]),
    );
    const embeddingBuckets: Record<string, number[]> = Object.fromEntries(
      families.map((family) => [family, []]),
    );

    for (const jd of jds) {
      structuredBuckets[jd.family].push(scoreFit(resume.parsed, jd.parsed).overall_score);
      embeddingBuckets[jd.family].push(scoreSemanticIndexed(resume.semantic, jd.semantic).overall_score);
    }

    const structured = Object.fromEntries(
      families.map((family) => [family, Number(average(structuredBuckets[family]).toFixed(4))]),
    );
    const embedding = Object.fromEntries(
      families.map((family) => [family, Number(average(embeddingBuckets[family]).toFixed(4))]),
    );
    const row: Record<string, unknown> = {
      id: resume.id,
      true_category: resume.category,
      jd_counts: jdCounts,
      structured,
      embedding,
    };
    for (const weight of HYBRID_STRUCTURED_WEIGHTS) {
      row[`hybrid_${String(weight).replace(".", "_")}`] = blend(structured, embedding, weight);
    }
    lines.push(JSON.stringify(row));

    if (++n % 25 === 0) console.log(`  scored ${n}/${resumes.length} resumes`);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
