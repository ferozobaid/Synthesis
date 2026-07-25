/**
 * Shared types for the technical question banks
 * (context/technical/data_analyst.json, context/technical/data_engineer.json).
 *
 * Types only — erased at build — so this module is safe to import from either the
 * server-only bank loader (lib/voice/question-bank.ts) or a client component.
 */

export type QuestionBankRole = "data_analyst" | "data_engineer";

export interface QuestionBankTargetElement {
  id: string;
  description: string;
  required: boolean;
}

export interface QuestionBankProbe {
  id: string;
  trigger: string;
  prompt: string;
  target_element_ids: string[];
}

export interface QuestionBankRubricDimension {
  name: string;
  weight: number;
  description: string;
  anchors: Record<string, string>;
}

export interface QuestionBankQuestion {
  id: string;
  order: number;
  role: QuestionBankRole;
  title: string;
  domain: string;
  difficulty: string;
  estimated_minutes: number;
  scenario: {
    context: string;
    constraints: string[];
    prompt: string;
  };
  objective: string;
  target_elements: QuestionBankTargetElement[];
  adaptive: {
    max_probes: number;
    probes: QuestionBankProbe[];
    hint_ladder: string[];
  };
  rubric: {
    scale: string;
    dimensions: QuestionBankRubricDimension[];
  };
  answer_key: {
    strong_answer_outline: string[];
    acceptable_alternatives: string[];
    red_flags: string[];
  };
}

export interface QuestionBank {
  version: number;
  track: "technical";
  role: QuestionBankRole;
  title: string;
  description: string;
  question_count: number;
  default_order: string[];
  scoring: {
    question_weighting: "equal";
    per_question_weight: number;
    scale: string;
    pass_threshold: number;
    final_score_normalization: string;
  };
  questions: QuestionBankQuestion[];
}
