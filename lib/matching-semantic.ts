/**
 * Requirement-level semantic fit scoring.
 *
 * The live Fit Analyzer uses the hybrid helper below when local embeddings are
 * enabled. The validation study also uses this module to compare structured
 * rules, semantic evidence retrieval, and hybrid blends on the same frozen split.
 */
import type {
  Embedding,
  EmbeddingBackend,
  FitReport,
  JDRequirement,
  JDRequirements,
  ParsedResume,
  PerRequirementResult,
  RequirementStatus,
} from "@/lib/types";
import { embeddingsEnabled } from "@/lib/config";
import {
  cosine,
  embedBatch,
  embedBatchStrict,
  EmbeddingError,
  type EmbeddingFailureCategory,
} from "@/lib/embeddings";
import { scoreFit } from "@/lib/matching";
import { extractCanonicalSkills } from "@/lib/onet";

const WEIGHT = { must_have: 1.0, nice_to_have: 0.4 } as const;
export const FIT_ANALYZER_STRUCTURED_WEIGHT = 0.25;

export type FitAnalyzerMethod = "structured" | "hybrid_0_25";

export interface FitAnalyzerScore {
  report: FitReport;
  method: FitAnalyzerMethod;
  structured: FitReport;
  semantic: FitReport | null;
  structured_weight: number;
  semantic_weight: number;
  embeddings_enabled: boolean;
  embedding_backend: EmbeddingBackend;
  fallback_reason?: string;
}

export interface EvidenceChunk {
  text: string;
  embedding: Embedding;
}

export interface IndexedResumeEvidence {
  chunks: EvidenceChunk[];
}

export interface IndexedJDRequirement {
  requirement: JDRequirement;
  weight: number;
  embedding: Embedding;
}

export interface IndexedJDRequirements {
  requirements: IndexedJDRequirement[];
}

type EmbedBatcher = (
  texts: string[],
  opts?: { query?: boolean },
) => Promise<Embedding[]>;

interface SemanticIndexOptions {
  embedBatcher?: EmbedBatcher;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function label(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[.;,:]\s*$/, "").trim();
}

function shorten(text: string, n = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}...`;
}

function dedupe(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const text = label(raw);
    const key = text.toLowerCase();
    if (text.length < 12 || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function resumeEvidenceTexts(resume: ParsedResume): string[] {
  const chunks: string[] = [];
  if (resume.summary) chunks.push(resume.summary);
  if (resume.skills.length) chunks.push(`Skills: ${resume.skills.join(", ")}`);
  for (const exp of resume.experience) {
    for (const bullet of exp.bullets) {
      chunks.push(exp.title ? `${exp.title}: ${bullet}` : bullet);
    }
  }
  for (const edu of resume.education) {
    const text = [edu.degree, edu.field, edu.institution, edu.year].filter(Boolean).join(", ");
    if (text) chunks.push(`Education: ${text}`);
  }

  // Fallback for resumes that parse poorly: short, line-level passages.
  if (chunks.length < 3) {
    for (const line of resume.raw_text.split(/\n+/)) {
      const t = line.trim();
      if (t.length >= 20 && t.length <= 240) chunks.push(t);
      if (chunks.length >= 24) break;
    }
  }
  return dedupe(chunks).slice(0, 40);
}

export function jdRequirementItems(jd: JDRequirements): { requirement: JDRequirement; weight: number }[] {
  return [
    ...jd.must_have.map((requirement) => ({ requirement, weight: WEIGHT.must_have })),
    ...jd.nice_to_have.map((requirement) => ({ requirement, weight: WEIGHT.nice_to_have })),
  ];
}

export async function indexResumeEvidence(
  resume: ParsedResume,
  options: SemanticIndexOptions = {},
): Promise<IndexedResumeEvidence> {
  const texts = resumeEvidenceTexts(resume);
  const embeddings = await (options.embedBatcher ?? embedBatch)(texts);
  return { chunks: texts.map((text, i) => ({ text, embedding: embeddings[i] })) };
}

export async function indexJDRequirements(
  jd: JDRequirements,
  options: SemanticIndexOptions = {},
): Promise<IndexedJDRequirements> {
  const items = jdRequirementItems(jd);
  const embeddings = await (options.embedBatcher ?? embedBatch)(
    items.map((item) => item.requirement.text),
    { query: true },
  );
  return {
    requirements: items.map((item, i) => ({
      requirement: item.requirement,
      weight: item.weight,
      embedding: embeddings[i],
    })),
  };
}

function statusFor(score: number): RequirementStatus {
  if (score >= 0.76) return "matched";
  if (score >= 0.62) return "partial";
  return "missing";
}

function mergeRequirementResults(
  structured: FitReport,
  semantic: FitReport,
  structuredWeight: number,
): PerRequirementResult[] {
  const w = clamp01(structuredWeight);
  const semanticByRequirement = new Map(
    semantic.per_requirement.map((result) => [result.requirement, result]),
  );
  const merged: PerRequirementResult[] = [];
  const seen = new Set<string>();

  for (const structuredResult of structured.per_requirement) {
    const semanticResult = semanticByRequirement.get(structuredResult.requirement);
    const semanticScore = semanticResult?.score ?? structuredResult.score;
    const score = clamp01(w * structuredResult.score + (1 - w) * semanticScore);
    const status = statusFor(score);
    merged.push({
      requirement: structuredResult.requirement,
      status,
      evidence:
        status === "missing"
          ? null
          : (semanticResult?.evidence ?? structuredResult.evidence),
      weight: structuredResult.weight,
      score,
    });
    seen.add(structuredResult.requirement);
  }

  for (const semanticResult of semantic.per_requirement) {
    if (seen.has(semanticResult.requirement)) continue;
    merged.push(semanticResult);
  }

  return merged;
}

function semanticResult(
  indexed: IndexedJDRequirement,
  resume: IndexedResumeEvidence,
): PerRequirementResult {
  let bestScore = -1;
  let bestEvidence: string | null = null;
  for (const chunk of resume.chunks) {
    const sim = cosine(indexed.embedding, chunk.embedding);
    if (sim > bestScore) {
      bestScore = sim;
      bestEvidence = shorten(chunk.text);
    }
  }
  const score = clamp01((bestScore + 1) / 2);
  const status = statusFor(score);
  return {
    requirement: label(indexed.requirement.text),
    status,
    evidence: status === "missing" ? null : bestEvidence,
    weight: indexed.weight,
    score,
  };
}

export function scoreSemanticIndexed(
  resume: IndexedResumeEvidence,
  jd: IndexedJDRequirements,
): FitReport {
  const per_requirement = jd.requirements.map((req) => semanticResult(req, resume));
  const totalW = per_requirement.reduce((sum, p) => sum + p.weight, 0);
  const overall_score =
    totalW > 0
      ? Math.round((100 * per_requirement.reduce((sum, p) => sum + p.weight * p.score, 0)) / totalW)
      : 0;

  const top_strengths = per_requirement
    .filter((p) => p.status === "matched")
    .sort((a, b) => b.weight * b.score - a.weight * a.score)
    .slice(0, 4)
    .map((p) => (p.evidence ? `${p.requirement} - ${p.evidence}` : p.requirement));

  const gaps = per_requirement
    .filter((p) => p.weight === WEIGHT.must_have && p.status !== "matched")
    .slice(0, 5)
    .map((p) =>
      p.status === "missing"
        ? `${p.requirement} - semantically weak or absent evidence.`
        : `${p.requirement} - partial semantic evidence only.`,
    );

  const missing_keywords: string[] = [];
  for (const req of jd.requirements) {
    const result = per_requirement.find((p) => p.requirement === label(req.requirement.text));
    if (result?.status === "matched") continue;
    for (const skill of extractCanonicalSkills(req.requirement.text)) {
      if (!missing_keywords.includes(skill)) missing_keywords.push(skill);
      if (missing_keywords.length >= 8) break;
    }
  }

  const recommendations = gaps
    .slice(0, 4)
    .map((gap) => `Add or strengthen resume evidence for: ${gap.replace(/\s+-\s+.*$/, "")}.`);

  return {
    overall_score,
    per_requirement,
    top_strengths,
    gaps,
    missing_keywords,
    recommendations,
  };
}

export async function scoreFitSemantic(
  resume: ParsedResume,
  jd: JDRequirements,
  options: SemanticIndexOptions = {},
): Promise<FitReport> {
  const [resumeIndex, jdIndex] = await Promise.all([
    indexResumeEvidence(resume, options),
    indexJDRequirements(jd, options),
  ]);
  return scoreSemanticIndexed(resumeIndex, jdIndex);
}

export function scoreFitHybrid(
  structured: FitReport,
  semantic: FitReport,
  structuredWeight: number,
): FitReport {
  const w = clamp01(structuredWeight);
  const overall_score = Math.round(w * structured.overall_score + (1 - w) * semantic.overall_score);
  const per_requirement = mergeRequirementResults(structured, semantic, w);
  return {
    overall_score,
    per_requirement: per_requirement.length ? per_requirement : structured.per_requirement,
    top_strengths: [...structured.top_strengths, ...semantic.top_strengths].slice(0, 4),
    gaps: [...structured.gaps, ...semantic.gaps].slice(0, 5),
    missing_keywords: [...new Set([...structured.missing_keywords, ...semantic.missing_keywords])].slice(0, 8),
    recommendations: [...structured.recommendations, ...semantic.recommendations].slice(0, 6),
  };
}

function embeddingFailureCategory(error: unknown): EmbeddingFailureCategory {
  return error instanceof EmbeddingError ? error.category : "inference";
}

function embeddingFallbackReason(category: EmbeddingFailureCategory): string {
  return category === "load"
    ? "Local BGE embeddings could not be loaded; using structured scoring."
    : "Local BGE embedding inference failed; using structured scoring.";
}

function warnEmbeddingFailure(category: EmbeddingFailureCategory): void {
  console.warn(`[fit] BGE embedding ${category} failed; using structured scoring.`);
}

export async function scoreFitAnalyzer(
  resume: ParsedResume,
  jd: JDRequirements,
): Promise<FitAnalyzerScore> {
  const structured = scoreFit(resume, jd);
  const structuredWeight = FIT_ANALYZER_STRUCTURED_WEIGHT;
  const semanticWeight = 1 - structuredWeight;

  if (!embeddingsEnabled()) {
    return {
      report: structured,
      method: "structured",
      structured,
      semantic: null,
      structured_weight: 1,
      semantic_weight: 0,
      embeddings_enabled: false,
      embedding_backend: "disabled",
      fallback_reason: "EMBEDDINGS_ENABLED is not true",
    };
  }

  try {
    const semantic = await scoreFitSemantic(resume, jd, { embedBatcher: embedBatchStrict });
    return {
      report: scoreFitHybrid(structured, semantic, structuredWeight),
      method: "hybrid_0_25",
      structured,
      semantic,
      structured_weight: structuredWeight,
      semantic_weight: semanticWeight,
      embeddings_enabled: true,
      embedding_backend: "bge",
    };
  } catch (error) {
    const category = embeddingFailureCategory(error);
    warnEmbeddingFailure(category);
    return {
      report: structured,
      method: "structured",
      structured,
      semantic: null,
      structured_weight: 1,
      semantic_weight: 0,
      embeddings_enabled: true,
      embedding_backend: "failed",
      fallback_reason: embeddingFallbackReason(category),
    };
  }
}
