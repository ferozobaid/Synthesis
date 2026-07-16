/**
 * Qualitative post-call coaching for behavioural voice reports.
 *
 * Generated only after the finalized transcript has been mapped and the existing
 * Synthesis scores have been produced. It does not let Vapi score during the
 * call, and it deliberately avoids returning raw answer text.
 */
import { extractFeatures } from "@/lib/behavioural/evaluator";
import type { BehaviouralScore } from "@/lib/types";
import type { TranscriptMapping } from "@/lib/behavioural/transcript";

export type AddressedQuestionStatus = "yes" | "partially" | "no";
export type StarElement = "situation" | "task" | "action" | "result";

export interface BehaviouralAnswerQualitativeFeedback {
  question_id: string;
  question_number: number;
  question: string;
  addressed_question: AddressedQuestionStatus;
  addressed_rationale: string;
  strengths: string[];
  weaknesses: string[];
  missing_star_elements: StarElement[];
  absent_evidence_or_impact: string[];
  improved_answer_outline: string;
}

export interface BehaviouralQualitativeReport {
  partial_warning: string | null;
  overall_patterns: string[];
  top_three_priorities: string[];
  answers: BehaviouralAnswerQualitativeFeedback[];
}

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

function expectedQuestionCues(question: string): { label: string; patterns: RegExp[] } | null {
  const q = question.toLowerCase();
  if (/\bwhy\b.*\b(role|data analyst|analyst)\b|\binterested\b.*\brole\b/.test(q)) {
    return {
      label: "interest in the role",
      patterns: [/\brole\b/i, /\banalyst\b/i, /\bdata\b/i, /\bskill/i, /\bcareer\b/i, /\binterested\b/i],
    };
  }
  if (/\bwhy\b.*\b(company|tenazx|revature)\b|\bwork at\b/.test(q)) {
    const company = words(question).find((w) => !STOPWORDS.has(w) && /^[a-z][a-z0-9]+$/.test(w));
    return {
      label: "interest in the company",
      patterns: [
        /\bcompany\b/i,
        /\bteam\b/i,
        /\bmission\b/i,
        /\bculture\b/i,
        /\bproduct\b/i,
        /\bclient\b/i,
        new RegExp(`\\b${company ?? "company"}\\b`, "i"),
      ],
    };
  }
  if (/\bconsulting\b/.test(q)) {
    return { label: "interest in consulting", patterns: [/\bconsult/i, /\bclient/i, /\bproblem/i, /\bcase\b/i] };
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
): { status: AddressedQuestionStatus; rationale: string } {
  const trimmed = answer.trim();
  const f = extractFeatures(trimmed);
  if (f.words < 5 || /\b(i do not know|i don't know|not sure|no idea|hmm|literally now)\b/i.test(trimmed)) {
    return { status: "no", rationale: "The response is too thin or reads as a non-answer." };
  }

  if (/tell me about yourself/i.test(question)) {
    return f.words >= 12
      ? { status: "yes", rationale: "It gives a self-introduction rather than a STAR story, which fits this question type." }
      : { status: "partially", rationale: "It starts to introduce you, but needs more role-relevant substance." };
  }

  const expected = expectedQuestionCues(question);
  if (expected) {
    if (hasAny(trimmed, expected.patterns)) {
      return { status: "yes", rationale: `It directly references ${expected.label}.` };
    }
    if (f.hasSituation && f.hasAction && f.words >= 25) {
      return { status: "partially", rationale: `It gives a behavioural story, but does not clearly connect back to ${expected.label}.` };
    }
    return { status: "no", rationale: `It does not clearly address ${expected.label}.` };
  }

  const overlap = questionOverlap(question, trimmed);
  if (overlap >= 0.25) return { status: "yes", rationale: "It uses the core language of the prompt and stays on topic." };
  if (f.hasSituation && f.hasAction && f.words >= 25) {
    return { status: "partially", rationale: "It gives a plausible STAR story, but the link to the exact prompt is indirect." };
  }
  return { status: "partially", rationale: "It offers some substance, but the connection to the question is weak." };
}

function missingStarElements(answer: string): StarElement[] {
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

function lowDimensionWeaknesses(score: BehaviouralScore): string[] {
  return score.dimension_scores
    .filter((d) => d.score <= 2)
    .map((d) => {
      const dimension = d.dimension.toLowerCase();
      if (dimension.includes("star")) return "STAR structure is weak; the answer is missing important story elements.";
      if (dimension.includes("specificity")) return "Specificity is weak; the answer needs concrete details, names, numbers, or context.";
      if (dimension.includes("ownership")) return "Ownership is weak; your individual contribution is not clear enough.";
      if (dimension.includes("impact")) return "Impact is weak; the outcome or business value is not clear enough.";
      if (dimension.includes("key")) return "Prepared-answer coverage is weak; important prepared points did not come through.";
      return `${d.dimension} needs more evidence.`;
    });
}

function highDimensionStrengths(score: BehaviouralScore): string[] {
  return score.dimension_scores
    .filter((d) => d.score >= 4)
    .map((d) => {
      const dimension = d.dimension.toLowerCase();
      if (dimension.includes("star")) return "STAR structure was comparatively strong.";
      if (dimension.includes("specificity")) return "The answer included comparatively strong concrete detail.";
      if (dimension.includes("ownership")) return "Your personal ownership was comparatively clear.";
      if (dimension.includes("impact")) return "The answer included a comparatively clear result or impact.";
      if (dimension.includes("key")) return "The answer covered important prepared-answer points.";
      return `${d.dimension} was comparatively strong.`;
    });
}

function evidenceGaps(answer: string, addressed: AddressedQuestionStatus, score: BehaviouralScore): string[] {
  const f = extractFeatures(answer);
  const gaps: string[] = [];
  if (f.numbers === 0) gaps.push("No quantified metric, scale, or before/after measure was provided.");
  if (f.namedEntities === 0) gaps.push("No named tool, stakeholder, project, client, or context made the example concrete.");
  if (!f.hasResult) gaps.push("No concrete result or impact was stated.");
  else if ((dimensionScore(score, "impact") ?? 5) <= 3) gaps.push("The impact was qualitative; add a measurable outcome or business consequence.");
  if (addressed !== "yes") gaps.push("The answer did not explicitly tie the example back to the competency in the question.");
  if (f.words < 35) gaps.push("The answer was too brief to carry specific evidence, tradeoffs, or stakes.");
  return unique(gaps);
}

function fallbackStrength(score: BehaviouralScore, addressed: AddressedQuestionStatus): string[] {
  if (addressed === "no") return [];
  const strengths = unique(highDimensionStrengths(score)).slice(0, 4);
  if (strengths.length > 0) return strengths;
  return addressed === "yes"
    ? ["The answer stayed aligned to the question."]
    : ["The answer gave at least some material to coach from."];
}

function weaknessesFor(
  score: BehaviouralScore,
  addressed: { status: AddressedQuestionStatus; rationale: string },
  missing: StarElement[],
): string[] {
  const weaknesses: string[] = [];
  if (addressed.status !== "yes") weaknesses.push(addressed.rationale);
  if (missing.length > 0) {
    weaknesses.push(`Missing STAR element${missing.length === 1 ? "" : "s"}: ${missing.map((m) => STAR_LABEL[m]).join(", ")}.`);
  }
  weaknesses.push(...lowDimensionWeaknesses(score));
  const out = unique(weaknesses);
  return (out.length ? out : ["Tighten the answer by making the evidence, ownership, and impact more explicit."]).slice(0, 6);
}

function questionFocus(question: string): string {
  const expected = expectedQuestionCues(question);
  if (expected) return expected.label;
  const terms = salientWords(question).slice(0, 4);
  return terms.length ? terms.join(" / ") : "the prompt";
}

function improvedOutline(question: string, missing: StarElement[], gaps: string[]): string {
  const focus = questionFocus(question);
  const missingText = missing.length ? ` Prioritize the missing ${missing.map((m) => STAR_LABEL[m]).join(", ")}.` : "";
  const evidenceText = gaps.length ? " Add one metric, named tool/stakeholder, and a concrete result." : "";
  return `S: name the setting for ${focus}. T: state your responsibility. A: give two specific actions you personally took. R: close with the measured outcome and what it proves.${missingText}${evidenceText}`;
}

function countMissing(answers: BehaviouralAnswerQualitativeFeedback[], element: StarElement): number {
  return answers.filter((a) => a.missing_star_elements.includes(element)).length;
}

function overallPatterns(
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
  const missingResult = countMissing(answers, "result");
  if (missingResult > 0) patterns.push(`${missingResult} answer${missingResult === 1 ? "" : "s"} missed a clear Result/impact close.`);
  const missingTask = countMissing(answers, "task");
  if (missingTask > 0) patterns.push(`${missingTask} answer${missingTask === 1 ? "" : "s"} did not make your responsibility explicit.`);
  const evidenceLight = answers.filter((a) => a.absent_evidence_or_impact.length > 0).length;
  if (evidenceLight > 0) patterns.push(`${evidenceLight} answer${evidenceLight === 1 ? " was" : "s were"} light on specific evidence or measurable impact.`);
  return unique(patterns).slice(0, 5);
}

function topPriorities(
  answers: BehaviouralAnswerQualitativeFeedback[],
  dimensionAverages: { dimension: string; average: number }[],
): string[] {
  const priorities: string[] = [];
  const weakDims = [...dimensionAverages].sort((a, b) => a.average - b.average);
  for (const d of weakDims) {
    if (d.average < 4) priorities.push(`Raise ${d.dimension} by adding sharper evidence and tighter STAR structure.`);
  }
  const missingCounts = (["result", "task", "situation", "action"] as StarElement[])
    .map((element) => ({ element, count: countMissing(answers, element) }))
    .sort((a, b) => b.count - a.count);
  const mostMissing = missingCounts[0];
  if (mostMissing && mostMissing.count > 0) {
    priorities.push(`Make ${STAR_LABEL[mostMissing.element]} explicit in every answer.`);
  }
  if (answers.some((a) => a.addressed_question !== "yes")) {
    priorities.push("Start each response by anchoring to the exact competency asked before telling the story.");
  }
  if (answers.some((a) => a.absent_evidence_or_impact.some((g) => g.includes("quantified")))) {
    priorities.push("Close with a number, baseline, or business outcome so impact is not just implied.");
  }
  priorities.push("Keep each answer concise: context, responsibility, two actions, result.");
  priorities.push("Name your personal decision or action before describing what the team did.");
  priorities.push("Practice a one-sentence Result close for each prepared STAR story.");
  return unique(priorities).slice(0, 3);
}

export function buildBehaviouralQualitativeReport(opts: {
  mapping: TranscriptMapping;
  scores: Record<string, BehaviouralScore>;
  dimensionAverages: { dimension: string; average: number }[];
  totalQuestions: number;
}): BehaviouralQualitativeReport {
  const answers = opts.mapping.mapped
    .map((mapped, i): BehaviouralAnswerQualitativeFeedback | null => {
      const score = opts.scores[mapped.questionId];
      if (!mapped.answer || !score) return null;
      const addressed = assessAddressedQuestion(mapped.question, mapped.answer);
      const missing = missingStarElements(mapped.answer);
      const gaps = evidenceGaps(mapped.answer, addressed.status, score);
      return {
        question_id: mapped.questionId,
        question_number: i + 1,
        question: mapped.question,
        addressed_question: addressed.status,
        addressed_rationale: addressed.rationale,
        strengths: fallbackStrength(score, addressed.status),
        weaknesses: weaknessesFor(score, addressed, missing),
        missing_star_elements: missing,
        absent_evidence_or_impact: gaps,
        improved_answer_outline: improvedOutline(mapped.question, missing, gaps),
      };
    })
    .filter((x): x is BehaviouralAnswerQualitativeFeedback => x !== null);

  const unanswered = Math.max(0, opts.totalQuestions - answers.length);
  return {
    partial_warning:
      unanswered > 0
        ? `Partial interview: only ${answers.length} of ${opts.totalQuestions} questions were answered. The overall score is based only on completed answers and is not representative of full interview readiness.`
        : null,
    overall_patterns: overallPatterns(answers, opts.dimensionAverages),
    top_three_priorities: topPriorities(answers, opts.dimensionAverages),
    answers,
  };
}
