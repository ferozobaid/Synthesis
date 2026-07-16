/**
 * Qualitative post-call coaching for behavioural voice reports.
 *
 * Generated only after the finalized transcript has been mapped and the existing
 * Synthesis scores have been produced. Real mode uses one Haiku structured JSON
 * request for all mapped answers; mock/offline mode keeps deterministic fallback.
 * The final persisted report contains derived feedback and short excerpts only,
 * never complete raw transcript answers.
 */
import { complete, extractJSON } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import { extractFeatures } from "@/lib/behavioural/evaluator";
import { MODEL_IDS, type BehaviouralScore } from "@/lib/types";
import type { MappedAnswer, TranscriptMapping } from "@/lib/behavioural/transcript";

export type BehaviouralQualitativeQuestionType =
  | "introduction"
  | "motivation_role_fit"
  | "company_fit"
  | "competency_star";
export type AddressedQuestionStatus = "yes" | "partially" | "no";
export type QualitativeRating = "strong" | "acceptable" | "weak" | "insufficient_evidence";
export type QualitativeConfidence = "high" | "medium" | "low";
export type StarElement = "situation" | "task" | "action" | "result";

export interface QualitativeDimensionFeedback {
  rating: QualitativeRating;
  rationale: string;
}

export interface BehaviouralAnswerQualitativeFeedback {
  question_id: string;
  question_number: number;
  question: string;
  question_type: BehaviouralQualitativeQuestionType;
  candidate_excerpt: string;
  addressed_question: AddressedQuestionStatus;
  addressed_rationale: string;
  strengths: string[];
  weaknesses: string[];
  professionalism: QualitativeDimensionFeedback;
  interview_engagement: QualitativeDimensionFeedback;
  clarity_relevance: QualitativeDimensionFeedback;
  missing_elements: string[];
  /** Empty except for competency_star answers; kept explicit for report consumers. */
  missing_star_elements: StarElement[];
  improved_answer_outline: string;
  insufficient_evidence: boolean;
  insufficient_evidence_reason: string | null;
  confidence: QualitativeConfidence;
}

export interface BehaviouralQualitativeReport {
  partial_warning: string | null;
  overall_patterns: string[];
  top_three_priorities: string[];
  answers: BehaviouralAnswerQualitativeFeedback[];
}

interface BaseAnswerInput {
  mapped: MappedAnswer;
  question_number: number;
  question_type: BehaviouralQualitativeQuestionType;
  candidate_excerpt: string;
  score: BehaviouralScore;
}

interface ModelAnswerFeedback {
  question_id?: unknown;
  addressed_question?: unknown;
  addressed_rationale?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  professionalism?: unknown;
  interview_engagement?: unknown;
  clarity_relevance?: unknown;
  missing_elements?: unknown;
  improved_answer_outline?: unknown;
  insufficient_evidence?: unknown;
  insufficient_evidence_reason?: unknown;
  confidence?: unknown;
}

interface ModelQualitativeReport {
  overall_patterns?: unknown;
  top_three_priorities?: unknown;
  answers?: unknown;
}

const EXCERPT_MAX_CHARS = 220;
const MODEL_ANSWER_MAX_CHARS = 1200;
const MODEL_TOTAL_ANSWER_CHARS = 18_000;
const QUALITATIVE_TIMEOUT_MS = 18_000;

const STAR_LABEL: Record<StarElement, string> = {
  situation: "Situation",
  task: "Task",
  action: "Action",
  result: "Result",
};

const STOPWORDS = new Set([
  "about",
  "and",
  "are",
  "asked",
  "been",
  "did",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "interested",
  "that",
  "the",
  "this",
  "time",
  "want",
  "what",
  "when",
  "why",
  "with",
  "work",
  "you",
  "your",
]);

function unique(items: string[]): string[] {
  return [...new Set(items.map((x) => x.trim()).filter(Boolean))];
}

function words(s: string): string[] {
  return s.toLowerCase().match(/[a-z][a-z0-9+-]*/g) ?? [];
}

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string {
  const t = normalizeSpaces(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

function excerpt(answer: string): string {
  return truncate(answer, EXCERPT_MAX_CHARS);
}

function salientWords(s: string): string[] {
  return unique(words(s).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

function questionOverlap(question: string, answer: string): number {
  const q = salientWords(question);
  if (q.length === 0) return 0;
  const a = new Set(salientWords(answer));
  return q.filter((w) => a.has(w)).length / q.length;
}

function hasAny(answer: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(answer));
}

export function classifyBehaviouralQuestion(q: {
  id: string;
  question: string;
  type?: string;
  competency?: string;
  source?: string;
}): BehaviouralQualitativeQuestionType {
  const id = q.id.toLowerCase();
  const type = (q.type ?? "").toLowerCase();
  const text = q.question.toLowerCase();
  const source = (q.source ?? "").toLowerCase();

  if (id === "tell_me_about_yourself" || type === "intro" || /^tell me about yourself[.?]?$/.test(text)) {
    return "introduction";
  }
  if (id === "why_this_company" || source.includes("company") || /\bwhy\b.*\bwork at\b|\bthis company\b|\btenazx\b|\brevature\b/.test(text)) {
    return "company_fit";
  }
  if (
    id === "why_this_role" ||
    id === "why_consulting" ||
    (type === "motivation" && !source.includes("company")) ||
    /\bwhy\b.*\b(role|consulting)\b|\binterested\b.*\b(role|consulting)\b/.test(text)
  ) {
    return "motivation_role_fit";
  }
  return "competency_star";
}

function expectedQuestionCues(question: string, questionType: BehaviouralQualitativeQuestionType): { label: string; patterns: RegExp[] } | null {
  const q = question.toLowerCase();
  if (questionType === "introduction") {
    return { label: "a concise self-introduction", patterns: [/\bbackground\b/i, /\bexperience\b/i, /\bdata\b/i, /\banalyst\b/i, /\bskill/i, /\bproject/i] };
  }
  if (questionType === "motivation_role_fit") {
    return {
      label: q.includes("consulting") ? "interest in consulting" : "interest in the role",
      patterns: [/\brole\b/i, /\bconsult/i, /\banalyst\b/i, /\bdata\b/i, /\bskill/i, /\bcareer\b/i, /\binterested\b/i, /\bclient\b/i, /\bproblem/i],
    };
  }
  if (questionType === "company_fit") {
    const company = words(question).find((w) => !STOPWORDS.has(w) && !["work", "company"].includes(w));
    return {
      label: "interest in the company",
      patterns: [/\bcompany\b/i, /\bteam\b/i, /\bmission\b/i, /\bculture\b/i, /\bproduct\b/i, /\bclient\b/i, new RegExp(`\\b${company ?? "company"}\\b`, "i")],
    };
  }
  if (/\bstrength/.test(q)) {
    return { label: "strengths and application", patterns: [/\bstrength/i, /\bstrong\b/i, /\bapplied\b/i, /\bexcel\b/i, /\banaly/i, /\bskill/i] };
  }
  if (/\bfailed\b|\bfailure\b|\blearned\b/.test(q)) {
    return { label: "failure and learning", patterns: [/\bfail/i, /\bmistake/i, /\bmissed\b/i, /\blearn/i, /\bwrong\b/i] };
  }
  if (/\bled\b|\blead\b|\bteam\b/.test(q)) {
    return { label: "leadership", patterns: [/\bled\b/i, /\blead/i, /\bteam\b/i, /\borganized\b/i, /\bmanaged\b/i] };
  }
  if (/\bconflict\b|\bresolved\b/.test(q)) {
    return { label: "conflict resolution", patterns: [/\bconflict\b/i, /\bdisagree/i, /\btension\b/i, /\bresolved\b/i, /\bcompromise\b/i] };
  }
  if (/\bambiguity\b|\bambiguous\b/.test(q)) {
    return { label: "ambiguity", patterns: [/\bambigu/i, /\buncertain/i, /\bunclear/i, /\bunknown/i] };
  }
  if (/\binfluenced\b|\bauthority\b/.test(q)) {
    return { label: "influence without authority", patterns: [/\binfluenc/i, /\bpersuad/i, /\bbuy-in\b/i, /\bstakeholder/i, /\bauthority\b/i] };
  }
  if (/\bdata\b|\bdecision\b/.test(q)) {
    return { label: "data-driven decision", patterns: [/\bdata\b/i, /\bmetric/i, /\banaly/i, /\bexcel\b/i, /\bsql\b/i, /\bdecision\b/i] };
  }
  if (/\bdeadline\b|\btight\b/.test(q)) {
    return { label: "deadline pressure", patterns: [/\bdeadline\b/i, /\btight\b/i, /\btime\b/i, /\bprioriti/i, /\bdelivered\b/i] };
  }
  if (/\bcross-function/.test(q)) {
    return { label: "cross-functional work", patterns: [/\bcross/i, /\bstakeholder/i, /\bfunction/i, /\bteam\b/i, /\bpartner/i] };
  }
  if (/\bbeyond\b|\basked\b/.test(q)) {
    return { label: "going beyond expectations", patterns: [/\bbeyond\b/i, /\bextra\b/i, /\binitiative\b/i, /\bvolunteer/i, /\bproactive\b/i] };
  }
  return null;
}

function assessAddressedQuestion(
  question: string,
  answer: string,
  questionType: BehaviouralQualitativeQuestionType,
): { status: AddressedQuestionStatus; rationale: string } {
  const trimmed = answer.trim();
  const f = extractFeatures(trimmed);
  if (f.words < 5 || /\b(i do not know|i don't know|not sure|no idea|hmm|literally now)\b/i.test(trimmed)) {
    return { status: "no", rationale: "The response is too thin or reads as a non-answer." };
  }

  const expected = expectedQuestionCues(question, questionType);
  if (expected) {
    if (hasAny(trimmed, expected.patterns)) {
      return { status: "yes", rationale: `It directly references ${expected.label}.` };
    }
    if (questionType === "competency_star" && f.hasSituation && f.hasAction && f.words >= 25) {
      return { status: "partially", rationale: `It gives a behavioural story, but does not clearly connect back to ${expected.label}.` };
    }
    return { status: "partially", rationale: `It has some substance, but does not clearly address ${expected.label}.` };
  }

  const overlap = questionOverlap(question, trimmed);
  if (overlap >= 0.25) return { status: "yes", rationale: "It uses the core language of the prompt and stays on topic." };
  if (questionType === "competency_star" && f.hasSituation && f.hasAction && f.words >= 25) {
    return { status: "partially", rationale: "It gives a plausible STAR story, but the link to the exact prompt is indirect." };
  }
  return { status: "partially", rationale: "It offers some substance, but the connection to the question is weak." };
}

function missingStarElements(answer: string, questionType: BehaviouralQualitativeQuestionType): StarElement[] {
  if (questionType !== "competency_star") return [];
  const f = extractFeatures(answer);
  const missing: StarElement[] = [];
  if (!f.hasSituation) missing.push("situation");
  if (!f.hasTask) missing.push("task");
  if (!f.hasAction) missing.push("action");
  if (!f.hasResult) missing.push("result");
  return missing;
}

function dimensionScore(score: BehaviouralScore, needle: string): number | null {
  const found = score.dimension_scores.find((d) =>
    d.dimension.toLowerCase().replace(/[^a-z]/g, "").includes(needle),
  );
  return found?.score ?? null;
}

function dimensionWeaknesses(score: BehaviouralScore, questionType: BehaviouralQualitativeQuestionType): string[] {
  return score.dimension_scores
    .filter((d) => d.score <= 2)
    .map((d) => {
      const dimension = d.dimension.toLowerCase();
      if (dimension.includes("star") && questionType === "competency_star") return "STAR structure is weak; the answer is missing important story elements.";
      if (dimension.includes("specificity")) return "Specificity is weak; the answer needs concrete details, names, numbers, or context.";
      if (dimension.includes("ownership") && questionType === "competency_star") return "Ownership is weak; your individual contribution is not clear enough.";
      if (dimension.includes("impact")) return "Impact is weak; the outcome or value is not clear enough.";
      if (dimension.includes("key")) return "Prepared-answer coverage is weak; important prepared points did not come through.";
      return `${d.dimension} needs more evidence.`;
    })
    .filter((x) => !/STAR|Ownership/.test(x) || questionType === "competency_star");
}

function dimensionStrengths(score: BehaviouralScore, questionType: BehaviouralQualitativeQuestionType): string[] {
  return score.dimension_scores
    .filter((d) => d.score >= 4)
    .map((d) => {
      const dimension = d.dimension.toLowerCase();
      if (dimension.includes("star") && questionType === "competency_star") return "STAR structure was comparatively strong.";
      if (dimension.includes("specificity")) return "The answer included comparatively strong concrete detail.";
      if (dimension.includes("ownership") && questionType === "competency_star") return "Your personal ownership was comparatively clear.";
      if (dimension.includes("impact")) return "The answer included a comparatively clear result or impact.";
      if (dimension.includes("key")) return "The answer covered important prepared-answer points.";
      return `${d.dimension} was comparatively strong.`;
    })
    .filter((x) => !/STAR|ownership/i.test(x) || questionType === "competency_star");
}

function missingElements(
  answer: string,
  questionType: BehaviouralQualitativeQuestionType,
  addressed: AddressedQuestionStatus,
  score: BehaviouralScore,
): string[] {
  const f = extractFeatures(answer);
  const gaps: string[] = [];
  if (questionType === "introduction") {
    if (f.words < 25) gaps.push("A more complete role-relevant background.");
    if (!/\b(data|analyst|project|experience|skill|business|technical)\b/i.test(answer)) gaps.push("A clearer link between your background and the target role.");
    if (!/\b(next|looking|interested|goal|career|target)\b/i.test(answer)) gaps.push("A concise statement of what direction you are targeting next.");
  } else if (questionType === "motivation_role_fit") {
    if (!/\b(role|consulting|analyst|data|client|problem|career|skill)\b/i.test(answer)) gaps.push("Role-specific reasons for your interest.");
    if (!/\b(my|i)\b/i.test(answer) || !/\b(skill|experience|project|background|strength)\b/i.test(answer)) gaps.push("A credible link between your skills or experience and the role.");
    if (f.words < 25) gaps.push("More detail showing authentic motivation rather than a generic preference.");
  } else if (questionType === "company_fit") {
    if (!/\b(company|team|mission|product|client|culture|industry|market|revature|tenazx)\b/i.test(answer)) gaps.push("Company-specific research or detail.");
    if (!/\bwhy|because|drawn|interested|value|fit|align/i.test(answer)) gaps.push("A clear reason this company is a fit for you.");
    if (f.words < 25) gaps.push("More substance than a generic positive statement about the company.");
  } else {
    for (const star of missingStarElements(answer, questionType)) gaps.push(`Missing ${STAR_LABEL[star]}.`);
    if (f.numbers === 0) gaps.push("A quantified metric, scale, or before/after measure.");
    if (f.namedEntities === 0) gaps.push("A named tool, stakeholder, project, client, or context.");
    if (!f.hasResult) gaps.push("A concrete result or impact.");
    else if ((dimensionScore(score, "impact") ?? 5) <= 3) gaps.push("A measurable outcome or business consequence.");
  }
  if (addressed !== "yes") gaps.push("A clearer tie back to the exact question asked.");
  return unique(gaps);
}

function rating(value: QualitativeRating, rationale: string): QualitativeDimensionFeedback {
  return { rating: value, rationale };
}

function fallbackDimensionFeedback(answer: string, addressed: AddressedQuestionStatus) {
  const f = extractFeatures(answer);
  const nonAnswer = addressed === "no";
  const professionalism = nonAnswer
    ? rating("weak", "The response is not interview-ready because it gives little or no substantive answer.")
    : f.hedges >= 2
      ? rating("acceptable", "The language is appropriate, but hedging weakens confidence.")
      : rating("acceptable", "The language is interview-appropriate.");
  const interview_engagement = nonAnswer
    ? rating("insufficient_evidence", "There is not enough observable effort or responsiveness to evaluate engagement positively.")
    : f.words >= 35
      ? rating("strong", "The answer shows observable effort through a developed response.")
      : rating("acceptable", "The answer is responsive, but brief.");
  const clarity_relevance = addressed === "yes"
    ? rating("strong", "The answer is relevant to the prompt.")
    : addressed === "partially"
      ? rating("acceptable", "The answer has some relevant material, but the connection to the prompt is not explicit enough.")
      : rating("weak", "The answer does not meaningfully respond to the prompt.");
  return { professionalism, interview_engagement, clarity_relevance };
}

function fallbackStrengths(
  score: BehaviouralScore,
  questionType: BehaviouralQualitativeQuestionType,
  addressed: AddressedQuestionStatus,
): string[] {
  if (addressed === "no") return [];
  const strengths = unique(dimensionStrengths(score, questionType)).slice(0, 4);
  if (strengths.length > 0) return strengths;
  return addressed === "yes"
    ? ["The answer stayed aligned to the question."]
    : ["The answer gave some material to build from."];
}

function fallbackWeaknesses(
  score: BehaviouralScore,
  questionType: BehaviouralQualitativeQuestionType,
  addressed: { status: AddressedQuestionStatus; rationale: string },
  missing: string[],
): string[] {
  const weaknesses: string[] = [];
  if (addressed.status !== "yes") weaknesses.push(addressed.rationale);
  if (missing.length > 0) weaknesses.push(`Missing elements: ${missing.join(", ")}.`);
  weaknesses.push(...dimensionWeaknesses(score, questionType));
  const out = unique(weaknesses);
  return (out.length ? out : ["Tighten the answer by making the evidence, relevance, and impact more explicit."]).slice(0, 6);
}

function questionFocus(question: string, questionType: BehaviouralQualitativeQuestionType): string {
  if (questionType === "introduction") return "your background, target direction, and role-relevant strengths";
  if (questionType === "motivation_role_fit") return "why this role fits your interests, skills, and career direction";
  if (questionType === "company_fit") return "specific reasons this company fits your goals and values";
  const terms = salientWords(question).slice(0, 4);
  return terms.length ? terms.join(" / ") : "the prompt";
}

function improvedOutline(question: string, questionType: BehaviouralQualitativeQuestionType, missing: string[]): string {
  const focus = questionFocus(question, questionType);
  if (questionType === "introduction") {
    return `Open with your current positioning, add two role-relevant experiences or skills, and close with the direction you want next: ${focus}.`;
  }
  if (questionType === "motivation_role_fit") {
    return `Give two specific reasons this role interests you, connect each to a skill or project from your background, and close with the contribution you want to make.`;
  }
  if (questionType === "company_fit") {
    return `Name one specific company detail, explain why it matters to you, connect it to your background, and state how you would contribute.`;
  }
  const missingText = missing.length ? ` Prioritize: ${missing.join(", ")}.` : "";
  return `S: name the setting. T: state your responsibility. A: give two specific actions you personally took. R: close with the measured outcome and what it proves.${missingText}`;
}

function fallbackAnswer(input: BaseAnswerInput): BehaviouralAnswerQualitativeFeedback {
  const addressed = assessAddressedQuestion(input.mapped.question, input.mapped.answer, input.question_type);
  const missing = missingElements(input.mapped.answer, input.question_type, addressed.status, input.score);
  const missingStar = missingStarElements(input.mapped.answer, input.question_type);
  const dims = fallbackDimensionFeedback(input.mapped.answer, addressed.status);
  const insufficient = addressed.status === "no" || extractFeatures(input.mapped.answer).words < 12;
  return {
    question_id: input.mapped.questionId,
    question_number: input.question_number,
    question: input.mapped.question,
    question_type: input.question_type,
    candidate_excerpt: input.candidate_excerpt,
    addressed_question: addressed.status,
    addressed_rationale: addressed.rationale,
    strengths: fallbackStrengths(input.score, input.question_type, addressed.status),
    weaknesses: fallbackWeaknesses(input.score, input.question_type, addressed, missing),
    professionalism: dims.professionalism,
    interview_engagement: dims.interview_engagement,
    clarity_relevance: dims.clarity_relevance,
    missing_elements: missing,
    missing_star_elements: missingStar,
    improved_answer_outline: improvedOutline(input.mapped.question, input.question_type, missing),
    insufficient_evidence: insufficient,
    insufficient_evidence_reason: insufficient ? "The response is too brief or non-substantive for confident qualitative assessment." : null,
    confidence: insufficient ? "low" : input.mapped.confidence === "high" ? "medium" : "low",
  };
}

function countMissing(answers: BehaviouralAnswerQualitativeFeedback[], pattern: RegExp): number {
  return answers.filter((a) => a.missing_elements.some((m) => pattern.test(m))).length;
}

function fallbackOverallPatterns(
  answers: BehaviouralAnswerQualitativeFeedback[],
  dimensionAverages: { dimension: string; average: number }[],
): string[] {
  if (answers.length === 0) return ["No completed answers were available for qualitative review."];
  const patterns: string[] = [];
  const weakDims = [...dimensionAverages].sort((a, b) => a.average - b.average).slice(0, 2);
  if (weakDims.length > 0) {
    patterns.push(`Lowest scoring dimensions: ${weakDims.map((d) => `${d.dimension} (${d.average}/5)`).join(", ")}.`);
  }
  const partialOrNo = answers.filter((a) => a.addressed_question !== "yes").length;
  if (partialOrNo > 0) patterns.push(`${partialOrNo} answer${partialOrNo === 1 ? "" : "s"} did not fully address the exact prompt.`);
  const missingImpact = countMissing(answers, /result|impact|outcome|quantified|measurable/i);
  if (missingImpact > 0) patterns.push(`${missingImpact} answer${missingImpact === 1 ? "" : "s"} needed stronger evidence or impact.`);
  const lowEngagement = answers.filter((a) => a.interview_engagement.rating === "weak" || a.interview_engagement.rating === "insufficient_evidence").length;
  if (lowEngagement > 0) patterns.push(`${lowEngagement} answer${lowEngagement === 1 ? "" : "s"} showed limited observable interview engagement.`);
  return unique(patterns).slice(0, 5);
}

function fallbackTopPriorities(
  answers: BehaviouralAnswerQualitativeFeedback[],
  dimensionAverages: { dimension: string; average: number }[],
): string[] {
  const priorities: string[] = [];
  const weakDims = [...dimensionAverages].sort((a, b) => a.average - b.average);
  for (const d of weakDims) {
    if (d.average < 4) priorities.push(`Raise ${d.dimension} by adding sharper evidence and tighter answer structure.`);
  }
  if (answers.some((a) => a.addressed_question !== "yes")) {
    priorities.push("Anchor every response to the exact question before adding detail.");
  }
  if (answers.some((a) => a.missing_elements.some((m) => /quantified|measurable|result|impact/i.test(m)))) {
    priorities.push("Close with a number, baseline, or concrete outcome wherever the question calls for evidence.");
  }
  if (answers.some((a) => a.question_type === "motivation_role_fit" || a.question_type === "company_fit")) {
    priorities.push("Make fit answers specific: name the role or company detail and connect it to your background.");
  }
  priorities.push("Keep each answer concise, responsive, and interview-appropriate.");
  priorities.push("Name your personal contribution before describing what the team did.");
  return unique(priorities).slice(0, 3);
}

function partialWarning(answered: number, total: number): string | null {
  const unanswered = Math.max(0, total - answered);
  return unanswered > 0
    ? `Partial interview: only ${answered} of ${total} questions were answered. The overall score is based only on completed answers and is not representative of full interview readiness.`
    : null;
}

function deterministicReport(
  baseAnswers: BaseAnswerInput[],
  dimensionAverages: { dimension: string; average: number }[],
  totalQuestions: number,
): BehaviouralQualitativeReport {
  const answers = baseAnswers.map(fallbackAnswer);
  return {
    partial_warning: partialWarning(answers.length, totalQuestions),
    overall_patterns: fallbackOverallPatterns(answers, dimensionAverages),
    top_three_priorities: fallbackTopPriorities(answers, dimensionAverages),
    answers,
  };
}

function arrayOfStrings(value: unknown, fallback: string[] = [], max = 6): string[] {
  if (!Array.isArray(value)) return fallback;
  return unique(value.map((x) => sanitizeText(String(x), 260))).slice(0, max);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function sanitizeText(text: string, max = 360): string {
  return truncate(text.replace(/[{}[\]]/g, ""), max);
}

function sanitizeModelText(text: unknown, fallback: string, max = 360): string {
  const s = typeof text === "string" ? sanitizeText(text, max) : "";
  return s || fallback;
}

function noStarLanguageForNonStar(items: string[], questionType: BehaviouralQualitativeQuestionType): string[] {
  if (questionType === "competency_star") return items;
  return items.filter((x) => !/\b(STAR|Situation|Task|Action|Result)\b/i.test(x));
}

function hasStarLanguage(text: string): boolean {
  return /\b(STAR|Situation|Task|Action|Result)\b/i.test(text);
}

function nonStarSafeModelText(
  value: unknown,
  fallback: string,
  questionType: BehaviouralQualitativeQuestionType,
  max = 360,
): string {
  const text = sanitizeModelText(value, fallback, max);
  if (questionType !== "competency_star" && hasStarLanguage(text)) return fallback;
  return text;
}

function coerceDimension(
  value: unknown,
  fallback: QualitativeDimensionFeedback,
  questionType: BehaviouralQualitativeQuestionType,
): QualitativeDimensionFeedback {
  const v = value as Partial<QualitativeDimensionFeedback> | null;
  const candidate = sanitizeModelText(v?.rationale, fallback.rationale, 260);
  return {
    rating: enumValue(v?.rating, ["strong", "acceptable", "weak", "insufficient_evidence"] as const, fallback.rating),
    rationale: questionType !== "competency_star" && hasStarLanguage(candidate) ? fallback.rationale : candidate,
  };
}

function coerceModelAnswer(
  raw: ModelAnswerFeedback | undefined,
  base: BaseAnswerInput,
  fallback: BehaviouralAnswerQualitativeFeedback,
): BehaviouralAnswerQualitativeFeedback {
  const addressed = enumValue(raw?.addressed_question, ["yes", "partially", "no"] as const, fallback.addressed_question);
  const insufficient = typeof raw?.insufficient_evidence === "boolean" ? raw.insufficient_evidence : fallback.insufficient_evidence;
  const strengths = addressed === "no"
    ? []
    : noStarLanguageForNonStar(arrayOfStrings(raw?.strengths, fallback.strengths, 5), base.question_type);
  const weaknesses = noStarLanguageForNonStar(arrayOfStrings(raw?.weaknesses, fallback.weaknesses, 6), base.question_type);
  const missing = noStarLanguageForNonStar(arrayOfStrings(raw?.missing_elements, fallback.missing_elements, 8), base.question_type);

  return {
    ...fallback,
    addressed_question: addressed,
    addressed_rationale: nonStarSafeModelText(raw?.addressed_rationale, fallback.addressed_rationale, base.question_type, 240),
    strengths,
    weaknesses,
    professionalism: coerceDimension(raw?.professionalism, fallback.professionalism, base.question_type),
    interview_engagement: coerceDimension(raw?.interview_engagement, fallback.interview_engagement, base.question_type),
    clarity_relevance: coerceDimension(raw?.clarity_relevance, fallback.clarity_relevance, base.question_type),
    missing_elements: missing,
    missing_star_elements: base.question_type === "competency_star" ? fallback.missing_star_elements : [],
    improved_answer_outline: nonStarSafeModelText(raw?.improved_answer_outline, fallback.improved_answer_outline, base.question_type, 420),
    insufficient_evidence: insufficient,
    insufficient_evidence_reason:
      insufficient
        ? sanitizeModelText(raw?.insufficient_evidence_reason, fallback.insufficient_evidence_reason ?? "Insufficient evidence for confident qualitative assessment.", 220)
        : null,
    confidence: enumValue(raw?.confidence, ["high", "medium", "low"] as const, fallback.confidence),
    // Server-owned fields; never trust model output for these.
    question_id: base.mapped.questionId,
    question_number: base.question_number,
    question: base.mapped.question,
    question_type: base.question_type,
    candidate_excerpt: base.candidate_excerpt,
  };
}

function coerceModelReport(
  raw: unknown,
  baseAnswers: BaseAnswerInput[],
  fallback: BehaviouralQualitativeReport,
  dimensionAverages: { dimension: string; average: number }[],
  totalQuestions: number,
): BehaviouralQualitativeReport {
  const model = raw as ModelQualitativeReport | null;
  if (!model || !Array.isArray(model.answers)) throw new Error("qualitative_json_invalid");
  const byId = new Map<string, ModelAnswerFeedback>();
  for (const item of model.answers) {
    const a = item as ModelAnswerFeedback;
    if (typeof a?.question_id === "string") byId.set(a.question_id, a);
  }
  const fallbackById = new Map(fallback.answers.map((a) => [a.question_id, a]));
  const answers = baseAnswers.map((base) => {
    const fb = fallbackById.get(base.mapped.questionId) ?? fallbackAnswer(base);
    return coerceModelAnswer(byId.get(base.mapped.questionId), base, fb);
  });
  return {
    partial_warning: partialWarning(answers.length, totalQuestions),
    overall_patterns: arrayOfStrings(model.overall_patterns, fallbackOverallPatterns(answers, dimensionAverages), 5),
    top_three_priorities: arrayOfStrings(model.top_three_priorities, fallbackTopPriorities(answers, dimensionAverages), 3).slice(0, 3),
    answers,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("qualitative_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function modelInputs(baseAnswers: BaseAnswerInput[]) {
  let used = 0;
  return baseAnswers.map((a) => {
    const remaining = Math.max(0, MODEL_TOTAL_ANSWER_CHARS - used);
    const maxForThis = Math.max(EXCERPT_MAX_CHARS, Math.min(MODEL_ANSWER_MAX_CHARS, remaining));
    const answer_for_review = truncate(a.mapped.answer, maxForThis);
    used += answer_for_review.length;
    return {
      question_id: a.mapped.questionId,
      question_number: a.question_number,
      question: a.mapped.question,
      question_type: a.question_type,
      candidate_excerpt: a.candidate_excerpt,
      answer_for_review,
      mapping_confidence: a.mapped.confidence,
      numeric_summary: {
        overall: a.score.overall,
        dimensions: a.score.dimension_scores.map((d) => ({ dimension: d.dimension, score: d.score })),
      },
    };
  });
}

function qualitativePrompt(baseAnswers: BaseAnswerInput[], totalQuestions: number): string {
  const input = {
    total_questions: totalQuestions,
    answered_questions: baseAnswers.length,
    rules: [
      "Question_type is deterministic and immutable; do not reclassify it.",
      "Do not apply STAR criticism to introduction, motivation_role_fit, or company_fit questions.",
      "Assess interview_engagement only from observable effort, relevance, responsiveness, and interview-appropriate language.",
      "Do not invent or rewrite candidate_excerpt. Do not return candidate_excerpt at all; the server will attach it.",
      "Do not include full answer text in any field. Use concise derived feedback.",
      "Do not alter or mention numeric score changes.",
    ],
    answers: modelInputs(baseAnswers),
  };
  return [
    "Return compact JSON only. Follow this TypeScript-like schema:",
    `{
  "overall_patterns": string[],
  "top_three_priorities": string[],
  "answers": [{
    "question_id": string,
    "addressed_question": "yes" | "partially" | "no",
    "addressed_rationale": string,
    "strengths": string[],
    "weaknesses": string[],
    "professionalism": { "rating": "strong" | "acceptable" | "weak" | "insufficient_evidence", "rationale": string },
    "interview_engagement": { "rating": "strong" | "acceptable" | "weak" | "insufficient_evidence", "rationale": string },
    "clarity_relevance": { "rating": "strong" | "acceptable" | "weak" | "insufficient_evidence", "rationale": string },
    "missing_elements": string[],
    "improved_answer_outline": string,
    "insufficient_evidence": boolean,
    "insufficient_evidence_reason": string | null,
    "confidence": "high" | "medium" | "low"
  }]
}`,
    "",
    "Question-type missing elements:",
    "- introduction: concise background, role-relevant positioning, target direction.",
    "- motivation_role_fit: role-specific reasons, credible skill/interest link, contribution.",
    "- company_fit: company-specific detail, authentic reason, connection to candidate background.",
    "- competency_star: Situation, Task, Action, Result, evidence, impact.",
    "",
    "Input JSON:",
    JSON.stringify(input),
  ].join("\n");
}

async function modelQualitativeReport(
  baseAnswers: BaseAnswerInput[],
  fallback: BehaviouralQualitativeReport,
  dimensionAverages: { dimension: string; average: number }[],
  totalQuestions: number,
): Promise<BehaviouralQualitativeReport> {
  const system =
    "You are an interview coach generating qualitative feedback after a completed voice interview. " +
    "Be concrete and evidence-grounded. Use only observable language and effort. Return valid JSON only.";
  const text = await withTimeout(
    complete(qualitativePrompt(baseAnswers, totalQuestions), {
      system,
      temperature: 0,
      maxTokens: 3500,
      model: MODEL_IDS.default,
    }),
    QUALITATIVE_TIMEOUT_MS,
  );
  return coerceModelReport(extractJSON(text), baseAnswers, fallback, dimensionAverages, totalQuestions);
}

function buildBaseAnswers(mapping: TranscriptMapping, scores: Record<string, BehaviouralScore>): BaseAnswerInput[] {
  return mapping.mapped
    .map((mapped, i): BaseAnswerInput | null => {
      const score = scores[mapped.questionId];
      if (!mapped.answer || !score) return null;
      const question_type = classifyBehaviouralQuestion({
        id: mapped.questionId,
        question: mapped.question,
        type: mapped.type,
        competency: mapped.competency,
        source: mapped.source,
      });
      return {
        mapped,
        question_number: i + 1,
        question_type,
        candidate_excerpt: excerpt(mapped.answer),
        score,
      };
    })
    .filter((x): x is BaseAnswerInput => x !== null);
}

export async function buildBehaviouralQualitativeReport(opts: {
  mapping: TranscriptMapping;
  scores: Record<string, BehaviouralScore>;
  dimensionAverages: { dimension: string; average: number }[];
  totalQuestions: number;
}): Promise<BehaviouralQualitativeReport> {
  const baseAnswers = buildBaseAnswers(opts.mapping, opts.scores);
  const fallback = deterministicReport(baseAnswers, opts.dimensionAverages, opts.totalQuestions);
  if (useMocks() || baseAnswers.length === 0) return fallback;
  try {
    return await modelQualitativeReport(baseAnswers, fallback, opts.dimensionAverages, opts.totalQuestions);
  } catch {
    return fallback;
  }
}
