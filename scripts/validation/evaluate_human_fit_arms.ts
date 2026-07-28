/**
 * Evaluate all five Fit Analyzer validation arms against frozen human ratings.
 *
 * Offline plane only. The primary reference is the human rubric total (0-8);
 * Weak/Medium/Strong is retained for monotonicity, pairwise ordering, and the
 * descriptive threshold view.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const PACKAGE_DIR = join(HERE, "human_fit_validation");
const ARTIFACT_DIR = join(HERE, ".artifacts");

const PAIRS_PATH = join(PACKAGE_DIR, "pairs.json");
const REVIEW_PATH = join(PACKAGE_DIR, "reviewer_sheet.csv");
const SCORES_PATH = join(ARTIFACT_DIR, "human_fit_five_arm_scores.csv");
const METRICS_PATH = join(ARTIFACT_DIR, "human_fit_five_arm_metrics.json");

const LABELS = ["Weak", "Medium", "Strong"] as const;
type HumanLabel = (typeof LABELS)[number];

const ARMS = [
  "structured",
  "embedding",
  "hybrid_0_25",
  "hybrid_0_50",
  "hybrid_0_75",
] as const;
type Arm = (typeof ARMS)[number];

const ARM_LABELS: Record<Arm, string> = {
  structured: "Rules-only structured",
  embedding: "Embedding-only semantic",
  hybrid_0_25: "Hybrid 0.25 rules / 0.75 semantic",
  hybrid_0_50: "Hybrid 0.50 rules / 0.50 semantic",
  hybrid_0_75: "Hybrid 0.75 rules / 0.25 semantic",
};

interface PairRow {
  pair_id: string;
  jd_title: string;
  resume_title: string;
  jd_text: string;
  resume_text: string;
}

interface EvaluationRow {
  pair_id: string;
  jd_title: string;
  resume_title: string;
  human_total_0_8: number;
  human_category: HumanLabel;
  scores: Record<Arm, number>;
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
  const input = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      table.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    table.push(row);
  }
  const headers = table.shift() ?? [];
  return table
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""])));
}

function humanLabel(value: string): HumanLabel {
  const label = LABELS.find((candidate) => candidate.toLowerCase() === value.trim().toLowerCase());
  if (!label) throw new Error(`Invalid human category: ${value}`);
  return label;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array<number>(values.length);
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[start].value) end++;
    const averageRank = ((start + 1) + (end + 1)) / 2;
    for (let i = start; i <= end; i++) out[sorted[i].index] = averageRank;
    start = end + 1;
  }
  return out;
}

function correlation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let i = 0; i < left.length; i++) {
    const x = left[i] - leftMean;
    const y = right[i] - rightMean;
    numerator += x * y;
    leftVariance += x * x;
    rightVariance += y * y;
  }
  if (!leftVariance || !rightVariance) return null;
  return numerator / Math.sqrt(leftVariance * rightVariance);
}

function spearman(left: number[], right: number[]): number | null {
  return correlation(ranks(left), ranks(right));
}

function labelOrdinal(label: HumanLabel): number {
  return LABELS.indexOf(label);
}

function round(value: number | null, digits = 4): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function pairwiseOrdering(rows: EvaluationRow[], arm: Arm, reference: "total" | "category") {
  let comparable = 0;
  let correct = 0;
  let ties = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const left = reference === "total" ? rows[i].human_total_0_8 : labelOrdinal(rows[i].human_category);
      const right = reference === "total" ? rows[j].human_total_0_8 : labelOrdinal(rows[j].human_category);
      if (left === right) continue;
      comparable++;
      const humanDirection = Math.sign(left - right);
      const scoreDirection = Math.sign(rows[i].scores[arm] - rows[j].scores[arm]);
      if (scoreDirection === 0) ties++;
      else if (scoreDirection === humanDirection) correct++;
    }
  }
  return {
    comparable_pairs: comparable,
    correct,
    ties,
    strict_accuracy: round(correct / Math.max(1, comparable)),
    tie_adjusted_accuracy: round((correct + 0.5 * ties) / Math.max(1, comparable)),
  };
}

function predictedLabel(score: number, weakMax: number, mediumMax: number): HumanLabel {
  if (score <= weakMax) return "Weak";
  if (score <= mediumMax) return "Medium";
  return "Strong";
}

function bestThresholds(rows: EvaluationRow[], arm: Arm) {
  let best = { weak_max: 0, medium_max: 1, correct: -1 };
  for (let weakMax = 0; weakMax < 100; weakMax++) {
    for (let mediumMax = weakMax + 1; mediumMax <= 100; mediumMax++) {
      const correct = rows.filter(
        (row) => predictedLabel(row.scores[arm], weakMax, mediumMax) === row.human_category,
      ).length;
      if (correct > best.correct) best = { weak_max: weakMax, medium_max: mediumMax, correct };
    }
  }
  const confusion = Object.fromEntries(
    LABELS.map((actual) => [
      actual,
      Object.fromEntries(
        LABELS.map((predicted) => [
          predicted,
          rows.filter(
            (row) =>
              row.human_category === actual &&
              predictedLabel(row.scores[arm], best.weak_max, best.medium_max) === predicted,
          ).length,
        ]),
      ),
    ]),
  );
  return {
    ...best,
    accuracy: round(best.correct / rows.length),
    confusion_matrix: confusion,
  };
}

async function main(): Promise<void> {
  const pairs = JSON.parse(readFileSync(PAIRS_PATH, "utf8")) as PairRow[];
  const reviews = new Map(parseCsv(REVIEW_PATH).map((row) => [row.pair_id, row]));
  if (pairs.length !== 36 || reviews.size !== 36) {
    throw new Error(`Expected 36 pairs and ratings; received ${pairs.length} pairs and ${reviews.size} ratings.`);
  }

  const resumeCache = new Map<string, { parsed: ParsedResume; indexed: IndexedResumeEvidence }>();
  const jdCache = new Map<string, { parsed: JDRequirements; indexed: IndexedJDRequirements }>();

  async function preparedResume(text: string) {
    const cached = resumeCache.get(text);
    if (cached) return cached;
    const parsed = parseResume(text);
    const indexed = await indexResumeEvidence(parsed, { embedBatcher: embedBatchStrict });
    const prepared = { parsed, indexed };
    resumeCache.set(text, prepared);
    return prepared;
  }

  async function preparedJD(text: string) {
    const cached = jdCache.get(text);
    if (cached) return cached;
    const parsed = parseJD(text);
    const indexed = await indexJDRequirements(parsed, { embedBatcher: embedBatchStrict });
    const prepared = { parsed, indexed };
    jdCache.set(text, prepared);
    return prepared;
  }

  const evaluated: EvaluationRow[] = [];
  for (const pair of pairs) {
    const review = reviews.get(pair.pair_id);
    if (!review) throw new Error(`Missing human rating for ${pair.pair_id}`);
    const total = Number.parseInt(review.human_total_0_8 ?? "", 10);
    if (!Number.isInteger(total) || total < 0 || total > 8) {
      throw new Error(`Invalid human total for ${pair.pair_id}: ${review.human_total_0_8}`);
    }

    const [resume, jd] = await Promise.all([preparedResume(pair.resume_text), preparedJD(pair.jd_text)]);
    const structured = scoreFit(resume.parsed, jd.parsed);
    const semantic = scoreSemanticIndexed(resume.indexed, jd.indexed);
    const scores: Record<Arm, number> = {
      structured: structured.overall_score,
      embedding: semantic.overall_score,
      hybrid_0_25: scoreFitHybrid(structured, semantic, 0.25).overall_score,
      hybrid_0_50: scoreFitHybrid(structured, semantic, 0.5).overall_score,
      hybrid_0_75: scoreFitHybrid(structured, semantic, 0.75).overall_score,
    };
    evaluated.push({
      pair_id: pair.pair_id,
      jd_title: pair.jd_title,
      resume_title: pair.resume_title,
      human_total_0_8: total,
      human_category: humanLabel(review.human_category ?? ""),
      scores,
    });
    console.log(`Scored ${evaluated.length}/${pairs.length}: ${pair.pair_id}`);
  }

  const humanTotals = evaluated.map((row) => row.human_total_0_8);
  const humanOrdinals = evaluated.map((row) => labelOrdinal(row.human_category));
  const armMetrics = Object.fromEntries(
    ARMS.map((arm) => {
      const scores = evaluated.map((row) => row.scores[arm]);
      const byCategory = Object.fromEntries(
        LABELS.map((label) => {
          const values = evaluated.filter((row) => row.human_category === label).map((row) => row.scores[arm]);
          return [
            label,
            {
              n: values.length,
              mean: round(mean(values), 2),
              min: Math.min(...values),
              max: Math.max(...values),
            },
          ];
        }),
      );
      return [
        arm,
        {
          label: ARM_LABELS[arm],
          spearman_human_total: round(spearman(humanTotals, scores)),
          spearman_human_category: round(spearman(humanOrdinals, scores)),
          mean_score_by_human_category: byCategory,
          pairwise_by_human_total: pairwiseOrdering(evaluated, arm, "total"),
          pairwise_by_human_category: pairwiseOrdering(evaluated, arm, "category"),
          descriptive_thresholds: bestThresholds(evaluated, arm),
        },
      ];
    }),
  ) as Record<Arm, Record<string, unknown>>;

  const bestArm = [...ARMS].sort((left, right) => {
    const leftMetric = Number(armMetrics[left].spearman_human_total ?? -1);
    const rightMetric = Number(armMetrics[right].spearman_human_total ?? -1);
    return rightMetric - leftMetric || left.localeCompare(right);
  })[0];

  const metrics = {
    generated_at: new Date().toISOString(),
    mode: "synthetic-pair-human-validation",
    n_pairs: evaluated.length,
    human_label_counts: Object.fromEntries(
      LABELS.map((label) => [label, evaluated.filter((row) => row.human_category === label).length]),
    ),
    primary_reference: "human_total_0_8",
    best_arm_by_spearman_human_total: bestArm,
    arms: armMetrics,
    notes: [
      "Hybrid weights are the structured-score share; the remainder is semantic.",
      "Pair-level blends use raw pair scores, unlike the original family-level proxy's per-resume min-max blend.",
      "Thresholds are optimized on this same sample and are descriptive only.",
    ],
  };

  mkdirSync(ARTIFACT_DIR, { recursive: true });
  writeFileSync(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  const csvRows = evaluated.map((row) => ({
    pair_id: row.pair_id,
    jd_title: row.jd_title,
    resume_title: row.resume_title,
    human_total_0_8: row.human_total_0_8,
    human_category: row.human_category,
    structured: row.scores.structured,
    embedding: row.scores.embedding,
    hybrid_0_25: row.scores.hybrid_0_25,
    hybrid_0_50: row.scores.hybrid_0_50,
    hybrid_0_75: row.scores.hybrid_0_75,
  }));
  writeCsv(
    SCORES_PATH,
    [
      "pair_id",
      "jd_title",
      "resume_title",
      "human_total_0_8",
      "human_category",
      "structured",
      "embedding",
      "hybrid_0_25",
      "hybrid_0_50",
      "hybrid_0_75",
    ],
    csvRows,
  );

  console.log(`\nBest arm by Spearman versus human total: ${bestArm}`);
  for (const arm of ARMS) {
    const metric = armMetrics[arm];
    console.log(
      `${arm}: rho(total)=${metric.spearman_human_total}, ` +
        `rho(category)=${metric.spearman_human_category}`,
    );
  }
  console.log(`Scores -> ${SCORES_PATH.replace(`${REPO}\\`, "")}`);
  console.log(`Metrics -> ${METRICS_PATH.replace(`${REPO}\\`, "")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
