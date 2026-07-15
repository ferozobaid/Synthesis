/**
 * Synthesis — shared TypeScript contract.
 *
 * Mirrors the Supabase schema (supabase/migrations) and defines the strict I/O
 * shapes that cross API boundaries. The DB migrations and this file together are
 * the locked contract every module builds on. Live plane only.
 */

// ===================== Models & embeddings =====================

export type ModelMode = "default" | "demo";

/** Locked model IDs (single switch in /lib/claude.ts). */
export const MODEL_IDS: Record<ModelMode, string> = {
  default: "claude-haiku-4-5",
  demo: "claude-sonnet-4-6",
};

/** BGE-small-en-v1.5 dimensionality — must match vector(384) in migrations. */
export const EMBEDDING_DIM = 384 as const;
export type Embedding = number[];
export type EmbeddingBackend = "disabled" | "bge" | "failed" | "mock";

// ===================== Profiles =====================

export interface Profile {
  id: string;
  display_name: string | null;
  created_at: string;
}

// ===================== Resume =====================

export interface ParsedResume {
  name: string | null;
  summary: string | null;
  skills: string[];
  experience: { title?: string; org?: string; dates?: string; bullets: string[] }[];
  education: { degree?: string; field?: string; institution?: string; year?: string }[];
  raw_text: string;
}

export interface Resume {
  id: string;
  user_id: string;
  parsed_content: ParsedResume | null;
  raw_file_url: string | null;
  embedding: Embedding | null;
  created_at: string;
}

// ===================== Job description =====================

export type RequirementKind = "must_have" | "nice_to_have";
export type RequirementCategory = "skill" | "experience" | "education" | "domain" | "other";

export interface JDRequirement {
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  /** Grounding to the O*NET taxonomy where possible. */
  onet_skill: string | null;
}

export interface JDRequirements {
  company: string | null;
  role_title: string | null;
  seniority: string | null;
  years_experience: number | null;
  domain: string | null;
  education: string | null;
  must_have: JDRequirement[];
  nice_to_have: JDRequirement[];
}

export interface JobDescription {
  id: string;
  user_id: string;
  company: string | null;
  role_title: string | null;
  parsed_requirements: JDRequirements | null;
  raw_text: string | null;
  embedding: Embedding | null;
  created_at: string;
}

// ===================== Fit analyzer =====================

export type RequirementStatus = "matched" | "partial" | "missing";

export interface PerRequirementResult {
  requirement: string;
  status: RequirementStatus;
  /** The resume line/evidence backing the decision (auditability). */
  evidence: string | null;
  weight: number; // 0..1 (must_have weighted higher than nice_to_have)
  score: number; // 0..1 similarity/coverage
}

export interface FitReport {
  overall_score: number; // 0..100
  per_requirement: PerRequirementResult[];
  top_strengths: string[];
  gaps: string[];
  missing_keywords: string[];
  recommendations: string[];
}

export interface FitResult {
  id: string;
  user_id: string;
  resume_id: string;
  jd_id: string;
  score: number | null;
  breakdown: PerRequirementResult[] | null;
  gaps: string[] | null;
  keywords: { matched: string[]; missing: string[] } | null;
  recommendations: string[] | null;
  created_at: string;
}

// ===================== Behavioural =====================

export interface Star {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface AnswerBankEntry extends Star {
  id: string;
  user_id: string;
  question: string;
  tags: string[];
  embedding: Embedding | null;
  created_at: string;
}

export interface BehaviouralQuestion {
  id: string;
  question: string;
  competency: string;
  type: string;
  dynamic: boolean;
  source?: string;
  fallback_company?: string;
}

export interface BehaviouralScore {
  dimension_scores: {
    dimension: string;
    score: number; // 1..5
    justification: string;
    evidence?: string;
  }[];
  overall: number; // 1..5
  covered_key_points: string[];
  missed_key_points: string[];
  strengths: string[];
  improvements: string[];
}

export interface BehaviouralSession {
  id: string;
  user_id: string;
  jd_id: string | null;
  questions_asked: { question_id: string; question: string }[] | null;
  scores: Record<string, BehaviouralScore> | null;
  feedback: { summary: string; next_focus: string[] } | null;
  created_at: string;
}

// ===================== Case FSM =====================

export const CASE_STATES = [
  "intro",
  "clarification",
  "framework",
  "analysis",
  "data_reveal",
  "pressure_test",
  "recommendation",
  "scoring",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export type CaseAction = "advance" | "probe" | "redirect" | "hint" | "reveal";

export interface CaseStage {
  id: CaseState;
  objective: string;
  interviewer_prompt: string;
  advance_criteria: string;
  probe_bank: string[];
  hint_ladder: string[]; // up to 3 graduated hints
  target_elements?: string[];
  data_drops?: string[]; // exhibit ids dripped in this stage
}

export interface CaseExhibit {
  id: string;
  title: string;
  stage: CaseState;
  synthesized: boolean;
  note?: string;
  data: Record<string, unknown>;
  insights?: string[];
}

export interface CaseQuant {
  stage: CaseState;
  question: string;
  solution_steps: string[];
  answer: string;
  answer_value?: number;
  tolerance?: number;
}

export interface RubricDimension {
  name: string;
  weight: number;
  description: string;
  anchors: Record<string, string>;
}

export interface ScoringRubric {
  scale: string;
  dimensions: RubricDimension[];
}

/** Full authored case (from /context/cases/*.json or the cases table). */
export interface CaseRecord {
  id: string;
  title: string;
  firm: string | null;
  type: string | null;
  prompt?: string; // opening the candidate hears (authored in /context JSON)
  content: string | null;
  stages: CaseStage[];
  exhibits: CaseExhibit[];
  quant?: CaseQuant;
  scoring_rubric: ScoringRubric;
  target_solution_notes?: string;
}

export interface CaseTurn {
  role: "interviewer" | "candidate";
  stage: CaseState;
  text: string;
  action?: CaseAction;
}

export interface CaseSessionState {
  id: string;
  user_id: string;
  case_id: string;
  fsm_state: CaseState;
  history: CaseTurn[];
  stage_attempts: Partial<Record<CaseState, number>>;
  hints_used: Partial<Record<CaseState, number>>;
  exhibits_revealed: string[];
  complete: boolean;
}

export interface CaseScore {
  dimension_scores: { dimension: string; score: number; justification: string }[];
  overall: number;
  strengths: string[];
  improvements: string[];
  next_focus: string[];
}

// ===================== Generic evaluation =====================

export interface Evaluation {
  module: "fit" | "behavioural" | "case";
  dimension_scores: {
    dimension: string;
    score: number;
    justification: string;
    transcript_evidence?: string;
  }[];
  overall: number;
  strengths: string[];
  improvements: string[];
  next_focus: string[];
}
