/**
 * Fit-scorer validation harness — OFFLINE PLANE, but it scores with the LIVE engine.
 *
 * For every retained resume, score it against all 21 field profiles with two arms and
 * write the per-family scores to results.jsonl; validate_matching.py turns those into
 * top-1/top-3 accuracy, a confusion matrix, and the embeddings-vs-structured ablation.
 *
 *   - structured arm : the live deterministic engine — parseResume + parseJD + scoreFit
 *                      (lib/matching.ts), i.e. the product exactly as it ships.
 *   - embeddings arm : BGE-small cosine via lib/embeddings.ts. Requires
 *                      EMBEDDINGS_ENABLED=true + `npm i @xenova/transformers`, else it
 *                      falls back to the deterministic NON-semantic mock vector (the run
 *                      still completes; the arm is flagged as mock so the ablation isn't
 *                      misread).
 *
 * Two-plane note: this offline script imports live PURE functions from lib/* (no network,
 * no Supabase). It is never imported by the app; tests/two-plane.test.ts (which scans only
 * app/ + lib/) is unaffected.
 *
 * Run:  npx tsx scripts/validation/score_resumes.ts            (full, from .artifacts/)
 *       npx tsx scripts/validation/score_resumes.ts --fixtures (committed smoke sample)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseResume } from "@/lib/parsers/resume-parser";
import { parseJD } from "@/lib/parsers/jd-parser";
import { scoreFit } from "@/lib/matching";
import { embed, cosine } from "@/lib/embeddings";
import { embeddingsEnabled } from "@/lib/config";
import type { JDRequirements, Embedding } from "@/lib/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = process.argv.includes("--fixtures");

/** `--sample N` keeps the first N resumes per family (stratified) — for a fast real-embeddings ablation. */
function sampleArg(): number | null {
  const i = process.argv.indexOf("--sample");
  if (i === -1) return null;
  const n = parseInt(process.argv[i + 1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Keep at most `n` resumes per category, preserving input order (deterministic). */
function stratifiedSample<T extends { category: string }>(rows: T[], n: number): T[] {
  const seen = new Map<string, number>();
  const out: T[] = [];
  for (const r of rows) {
    const c = seen.get(r.category) ?? 0;
    if (c < n) {
      out.push(r);
      seen.set(r.category, c + 1);
    }
  }
  return out;
}

const profilePath = fixtures
  ? join(HERE, "fixtures", "field_profiles.json")
  : join(HERE, "field_profiles.json");
const resumePath = fixtures
  ? join(HERE, "fixtures", "resumes.jsonl")
  : join(HERE, ".artifacts", "resumes.jsonl");
const outPath = fixtures
  ? join(HERE, ".artifacts", "results.fixtures.jsonl")
  : join(HERE, ".artifacts", "results.jsonl");

interface ResumeRow {
  id: string;
  category: string;
  raw_text: string;
}
interface FieldProfile {
  family: string;
  profile_text: string;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

async function main(): Promise<void> {
  if (!existsSync(profilePath) || !existsSync(resumePath)) {
    throw new Error(
      `Missing inputs (${profilePath} / ${resumePath}). ` +
        (fixtures ? "" : "Run `python3 scripts/validation/prepare_data.py` first."),
    );
  }

  const profilesObj = JSON.parse(readFileSync(profilePath, "utf8")) as {
    families: Record<string, FieldProfile>;
  };
  const families = Object.values(profilesObj.families);
  let resumes = readJsonl<ResumeRow>(resumePath);
  const sample = sampleArg();
  if (sample) {
    resumes = stratifiedSample(resumes, sample);
    console.log(`Stratified sample: ≤${sample}/family → ${resumes.length} resumes.`);
  }

  const realEmbeddings = embeddingsEnabled();
  if (!realEmbeddings) {
    console.warn(
      "⚠ EMBEDDINGS_ENABLED!=true — the embeddings arm uses the NON-semantic mock vector.\n" +
        "  For the real ablation: `npm i @xenova/transformers` and set EMBEDDINGS_ENABLED=true.",
    );
  }

  // Pre-parse + pre-embed the 21 profiles once (not per resume).
  const profileJD: Record<string, JDRequirements> = {};
  const profileVec: Record<string, Embedding> = {};
  for (const p of families) {
    profileJD[p.family] = parseJD(p.profile_text);
    profileVec[p.family] = await embed(p.profile_text);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const lines: string[] = [];
  let n = 0;
  for (const r of resumes) {
    const parsed = parseResume(r.raw_text);
    const resumeVec = await embed(r.raw_text, { query: true });

    const structured: Record<string, number> = {};
    const embeddings: Record<string, number> = {};
    for (const p of families) {
      structured[p.family] = scoreFit(parsed, profileJD[p.family]).overall_score;
      embeddings[p.family] = cosine(resumeVec, profileVec[p.family]);
    }

    lines.push(
      JSON.stringify({ id: r.id, true_category: r.category, structured, embeddings }),
    );
    if (++n % 250 === 0) console.log(`  scored ${n}/${resumes.length}`);
  }

  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(
    `\nScored ${resumes.length} resumes × ${families.length} profiles ` +
      `(embeddings: ${realEmbeddings ? "real BGE" : "MOCK"}).\nWrote ${outPath}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
