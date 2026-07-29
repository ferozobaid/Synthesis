/**
 * Scoped real-JD validation scorer - OFFLINE PLANE.
 *
 * Scores the same frozen resume x posting-level-JD split with:
 *   - structured: current deterministic rules scoreFit()
 *   - embedding : requirement-level semantic evidence retrieval
 *   - hybrid    : per-resume family-normalized blend of structured + embedding
 *
 * The main scoped study requires strict local BGE embeddings and never falls
 * back to mock vectors. Smoke mode uses an explicitly identified deterministic
 * mock backend. Production and 54-pair validation blend raw pair scores instead
 * of family-normalized score maps.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { embeddingsModel, embeddingsModelRevision } from "@/lib/config";
import { BGE_QUERY_PREFIX, embedBatchStrict, mockEmbed } from "@/lib/embeddings";
import { scoreFit } from "@/lib/matching";
import {
  indexJDRequirements,
  indexResumeEvidence,
  scoreSemanticIndexed,
  type IndexedJDRequirements,
} from "@/lib/matching-semantic";
import { parseJD } from "@/lib/parsers/jd-parser";
import { parseResume } from "@/lib/parsers/resume-parser";
import type { Embedding, JDRequirements, ParsedResume } from "@/lib/types";
import { combine } from "./rank";
import { resolveValidationRun } from "./run-mode";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ART = join(HERE, ".artifacts");
const run = resolveValidationRun(process.argv.slice(2));
const smoke = run.smoke;
const suffix = run.outputSuffix;

const resumePath = join(ART, `resumes.${run.inputSuffix}.jsonl`);
const jdPath = join(ART, `jds.${run.inputSuffix}.jsonl`);
const outPath = join(ART, `results.${suffix}.jsonl`);
const jdDiagnosticsPath = join(ART, `jd_parse_diagnostics.${suffix}.json`);
const manifestPath = join(ART, `validation_manifest.${suffix}.json`);

const HYBRID_STRUCTURED_WEIGHTS = [0.25, 0.5, 0.75] as const;
const PACKAGED_MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
] as const;

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

async function validationEmbedBatch(
  texts: string[],
  opts: { query?: boolean } = {},
): Promise<Embedding[]> {
  if (!smoke) return embedBatchStrict(texts, opts);
  return texts.map((text) =>
    mockEmbed(opts.query ? `${BGE_QUERY_PREFIX}${text}` : text),
  );
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
    const semantic = await indexJDRequirements(row.parsed, {
      embedBatcher: validationEmbedBatch,
    });
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
    const semantic = await indexResumeEvidence(parsed, {
      embedBatcher: validationEmbedBatch,
    });
    out.push({ ...row, parsed, semantic });
    if (++n % 50 === 0) console.log(`  indexed ${n}/${rows.length} resumes`);
  }
  return out;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function repoPath(path: string): string {
  return relative(REPO, path).replaceAll("\\", "/");
}

function currentCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function worktreeDirty(): boolean | null {
  try {
    return (
      execFileSync("git", ["status", "--porcelain"], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().length > 0
    );
  } catch {
    return null;
  }
}

function implementationFiles(): Record<string, string> {
  const paths = [
    join(REPO, "scripts", "validation", "score_resumes.ts"),
    join(REPO, "scripts", "validation", "rank.ts"),
    join(REPO, "scripts", "validation", "run-mode.ts"),
    join(REPO, "scripts", "validation", "prepare_data.py"),
    join(REPO, "scripts", "validation", "llm_family_map.py"),
    join(REPO, "scripts", "validation", "validate_matching.py"),
    join(REPO, "lib", "config.ts"),
    join(REPO, "lib", "embeddings.ts"),
    join(REPO, "lib", "matching.ts"),
    join(REPO, "lib", "matching-semantic.ts"),
    join(REPO, "lib", "onet.ts"),
    join(REPO, "lib", "types.ts"),
    join(REPO, "lib", "data", "onet-taxonomy.json"),
    join(REPO, "lib", "parsers", "resume-parser.ts"),
    join(REPO, "lib", "parsers", "jd-parser.ts"),
    join(REPO, "package-lock.json"),
  ];
  return Object.fromEntries(paths.map((path) => [repoPath(path), sha256File(path)]));
}

function packagedModelEvidence(): {
  source: "packaged-local" | "remote-or-cache";
  bundle_sha256: string | null;
  files_sha256: Record<string, string>;
} {
  const modelRoot = join(REPO, "models", ...embeddingsModel().split("/"));
  const configPath = join(modelRoot, "config.json");
  if (!existsSync(configPath)) {
    return {
      source: "remote-or-cache",
      bundle_sha256: null,
      files_sha256: {},
    };
  }
  const files = Object.fromEntries(
    PACKAGED_MODEL_FILES.map((relativePath) => {
      const path = join(modelRoot, ...relativePath.split("/"));
      if (!existsSync(path)) {
        throw new Error(`Packaged BGE model is incomplete: missing ${path}`);
      }
      return [repoPath(path), sha256File(path)];
    }),
  );
  return {
    source: "packaged-local",
    bundle_sha256: sha256Text(JSON.stringify(files)),
    files_sha256: files,
  };
}

async function main(): Promise<void> {
  if (!existsSync(resumePath) || !existsSync(jdPath)) {
    throw new Error(
      `Missing inputs (${resumePath} / ${jdPath}). Run ` +
        `python scripts/validation/prepare_data.py${smoke ? " --smoke" : ""} first.`,
    );
  }

  const sourceResumeRows = readJsonl<ResumeRow>(resumePath);
  let resumeRows = sourceResumeRows;
  if (run.samplePerFamily !== null) {
    resumeRows = stratifiedSample(resumeRows, run.samplePerFamily);
    console.log(
      `Stratified resume sample: <=${run.samplePerFamily}/family -> ${resumeRows.length}`,
    );
  }
  const jdRows = readJsonl<JDRow>(jdPath);
  const minJDRequirements = run.minJDRequirements;

  console.log(
    `Scoring ${resumeRows.length} resumes x ${jdRows.length} real JDs ` +
      `(${
        smoke
          ? "smoke, explicit mock embeddings"
          : run.diagnostic
            ? `diagnostic ${suffix.replace("diagnostic-", "")}, strict local BGE`
            : "scoped, strict local BGE"
      }).`,
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
      row[`hybrid_${String(weight).replace(".", "_")}`] = combine(
        structured,
        embedding,
        weight,
      );
    }
    lines.push(JSON.stringify(row));

    if (++n % 25 === 0) console.log(`  scored ${n}/${resumes.length} resumes`);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
  const samplingReportPath = join(ART, `sampling_report.${run.inputSuffix}.json`);
  const modelEvidence = smoke ? null : packagedModelEvidence();
  const manifest = {
    schema_version: 1,
    mode: run.mode,
    diagnostic_parameters: run.diagnostic
      ? {
          sample_per_family: run.samplePerFamily,
          min_jd_requirements: minJDRequirements,
        }
      : null,
    generated_at: new Date().toISOString(),
    git_commit: currentCommit(),
    git_worktree_dirty: worktreeDirty(),
    implementation_sha256: implementationFiles(),
    evaluation_unit:
      "One resume is scored against every retained JD; pair scores are averaged by JD family.",
    scoring: {
      structured: "scoreFit() raw 0-100 pair scores averaged by JD family",
      embedding:
        "scoreSemanticIndexed() raw 0-100 pair scores averaged by JD family",
      hybrids:
        "Structured and semantic family-average score maps are independently min-max normalized per resume, then blended.",
      structured_weights: HYBRID_STRUCTURED_WEIGHTS,
    },
    embedding: {
      backend: smoke ? "mock" : "bge",
      model: smoke ? "deterministic-test-vector" : embeddingsModel(),
      requested_revision: smoke ? null : embeddingsModelRevision(),
      revision_enforced_for_remote_loading: !smoke,
      source: smoke ? "deterministic-test-vector" : modelEvidence!.source,
      model_bundle_sha256: smoke ? null : modelEvidence!.bundle_sha256,
      model_files_sha256: smoke ? {} : modelEvidence!.files_sha256,
      fallback_allowed: false,
    },
    parser_gate: {
      minimum_requirements_per_jd: minJDRequirements,
      diagnostics: repoPath(jdDiagnosticsPath),
      diagnostics_sha256: sha256File(jdDiagnosticsPath),
    },
    inputs: {
      resumes: repoPath(resumePath),
      resumes_sha256: sha256File(resumePath),
      resume_source_rows: sourceResumeRows.length,
      resume_rows: resumeRows.length,
      selected_resume_ids_sha256: sha256Text(
        `${resumeRows.map((row) => row.id).join("\n")}\n`,
      ),
      jds: repoPath(jdPath),
      jds_sha256: sha256File(jdPath),
      jd_rows: jdRows.length,
      sampling_report:
        existsSync(samplingReportPath) ? repoPath(samplingReportPath) : null,
      sampling_report_sha256:
        existsSync(samplingReportPath) ? sha256File(samplingReportPath) : null,
    },
    output: {
      results: repoPath(outPath),
      results_sha256: sha256File(outPath),
      result_rows: lines.length,
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`\nWrote ${outPath}`);
  console.log(`Evidence manifest -> ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
