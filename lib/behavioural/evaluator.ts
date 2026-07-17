/**
 * Behavioural response evaluator — scores ONE candidate STAR answer against the
 * 5-dimension rubric in context/scoring_criteria.md (STAR structure, Specificity,
 * Ownership, Impact, Key-point coverage) and returns the shared `BehaviouralScore`
 * shape, so mock and real modes are interchangeable (mirrors lib/fsm/case-evaluator.ts).
 *
 *  - MOCK MODE (no credentials): a deterministic, feature-based heuristic. It detects
 *    STAR elements, counts numbers / named tools / first-person ownership / outcome
 *    language, and (when a prepared answer was retrieved) lexical coverage of it.
 *    Pure function of (answer, prepared) ⇒ varied across inputs, identical for
 *    identical input, no network — a full session scores sensibly with no API keys.
 *  - REAL MODE (Haiku 4.5): a rubric-anchored, low-temperature scoring prompt that
 *    returns the same shape; falls back to the heuristic on any error.
 *
 * Key-point coverage is the retrieval-grounded dimension: when retrieval returned nothing
 * relevant (`prepared === null`) it is marked "not applicable" — dropped from the
 * dimension list with an explicit feedback note — rather than scored 0.
 *
 * Live plane only. Never imports from offline scripts.
 */
import { complete, extractJSON } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import { containment } from "@/lib/text";
import { extractCanonicalSkills } from "@/lib/onet";
import {
  classifyBehaviouralQuestion,
  type BehaviouralQuestionClassificationInput,
  type BehaviouralQuestionType,
} from "@/lib/behavioural/question-types";
import type { AnswerBankEntry, BehaviouralScore } from "@/lib/types";

export const BEHAVIOURAL_DIMENSIONS = [
  "star_structure",
  "specificity",
  "ownership",
  "impact",
  "key_point_coverage",
] as const;
export type BehaviouralDimension = (typeof BEHAVIOURAL_DIMENSIONS)[number];

export const DIM_LABEL: Record<BehaviouralDimension, string> = {
  star_structure: "STAR structure",
  specificity: "Specificity / evidence",
  ownership: "Ownership",
  impact: "Impact / result",
  key_point_coverage: "Key-point coverage",
};

export interface BehaviouralScoringContext extends BehaviouralQuestionClassificationInput {
  questionId?: string;
  fallback_company?: string;
}

type NonStarQuestionType = Exclude<BehaviouralQuestionType, "competency_star">;

interface NonStarDimensionSpec {
  label: string;
  rubric: string;
  high: string;
  mid: string;
  low: string;
  improvement: string;
  evidence?: boolean;
}

const NON_STAR_PROFILES: Record<NonStarQuestionType, readonly NonStarDimensionSpec[]> = {
  introduction: [
    {
      label: "Professional positioning",
      rubric: "clear current background, target direction, and role-ready identity",
      high: "Clearly positions the candidate with a role-ready professional identity.",
      mid: "Gives some professional positioning, but the target direction is partly implicit.",
      low: "Does not clearly explain who the candidate is professionally.",
      improvement: "State your current background and the role-relevant direction you are targeting.",
    },
    {
      label: "Relevance",
      rubric: "links background to the target role or interview context",
      high: "Connects the background directly to the target role.",
      mid: "Has some relevant material, but the role connection needs tightening.",
      low: "The answer does not clearly connect to the target role.",
      improvement: "Tie the introduction to the role, business problem, or skills the interviewer is evaluating.",
    },
    {
      label: "Specificity",
      rubric: "uses concrete skills, projects, tools, domains, or measurable facts",
      high: "Includes concrete skills, projects, tools, or evidence.",
      mid: "Includes a few specifics, but still reads partly generic.",
      low: "Stays generic with little concrete evidence.",
      improvement: "Add one concrete project, skill, tool, domain, or measurable result.",
      evidence: true,
    },
    {
      label: "Clarity",
      rubric: "easy to follow, direct, and interview-appropriate",
      high: "The answer is clear and easy to follow.",
      mid: "Mostly clear, with some room to tighten the phrasing.",
      low: "The answer is hard to follow or too thin to assess clearly.",
      improvement: "Use a simple sequence: background, relevant experience, target direction.",
    },
    {
      label: "Concision",
      rubric: "complete but not rambling",
      high: "Gives enough context without rambling.",
      mid: "Length is workable, but it could be tighter or more complete.",
      low: "The answer is either too thin or too unfocused.",
      improvement: "Keep the introduction to a concise, complete 30-90 second arc.",
    },
  ],
  motivation_role_fit: [
    {
      label: "Role-specific motivation",
      rubric: "specific reasons for interest in this role or consulting path",
      high: "Gives role-specific reasons for the interest.",
      mid: "Shows some interest, but the role-specific reason needs sharpening.",
      low: "Motivation sounds generic or unclear.",
      improvement: "Name why this role specifically interests you, not just the field in general.",
    },
    {
      label: "Skill/experience fit",
      rubric: "connects motivation to candidate skills, experience, or career direction",
      high: "Connects the role to concrete skills or experience.",
      mid: "Mentions fit, but the evidence is thin.",
      low: "Does not show why the candidate fits the role.",
      improvement: "Connect the role to one concrete skill, project, or experience from your background.",
    },
    {
      label: "Credibility",
      rubric: "sounds grounded, authentic, and backed by observable effort",
      high: "Motivation sounds grounded and credible.",
      mid: "Generally plausible, but needs more evidence.",
      low: "The answer gives little reason to believe the motivation is grounded.",
      improvement: "Add a specific reason or experience that makes the motivation credible.",
    },
    {
      label: "Specificity",
      rubric: "uses concrete role details, work examples, or domain details",
      high: "Includes concrete role, work, or domain detail.",
      mid: "Some detail is present, but it remains partly generic.",
      low: "Lacks specific detail.",
      improvement: "Add a concrete role responsibility, skill, client problem, or project detail.",
      evidence: true,
    },
    {
      label: "Clarity",
      rubric: "directly answers the why-this-role question",
      high: "The answer is direct and easy to follow.",
      mid: "The answer is understandable, but could be structured more directly.",
      low: "The answer does not clearly answer the role-fit question.",
      improvement: "Lead with the reason, then support it with one concise example.",
    },
  ],
  company_fit: [
    {
      label: "Company knowledge",
      rubric: "mentions specific company, product, client, market, mission, or culture details",
      high: "Shows specific knowledge of the company.",
      mid: "Mentions the company, but the detail is limited.",
      low: "Does not show company-specific knowledge.",
      improvement: "Name one specific company, product, client, market, mission, or culture detail.",
      evidence: true,
    },
    {
      label: "Alignment",
      rubric: "connects company details to candidate goals, values, or work style",
      high: "Clearly connects the company to candidate goals or values.",
      mid: "Shows some fit, but the connection is underdeveloped.",
      low: "Does not explain why the company is a fit.",
      improvement: "Explain why that company detail matters to your goals, values, or work style.",
    },
    {
      label: "Specificity",
      rubric: "avoids generic praise by giving concrete reasons",
      high: "Uses concrete reasons rather than generic praise.",
      mid: "Some specificity is present, but parts could apply to many companies.",
      low: "Relies on generic praise.",
      improvement: "Replace generic praise with one precise reason this company stands out.",
      evidence: true,
    },
    {
      label: "Authenticity",
      rubric: "candidate-owned reason, not a brochure summary",
      high: "The reason sounds candidate-owned and authentic.",
      mid: "The answer is plausible, but needs a more personal link.",
      low: "The answer sounds generic or disconnected from the candidate.",
      improvement: "Connect the company reason to your own experience, interests, or contribution.",
    },
    {
      label: "Clarity",
      rubric: "directly answers why this company",
      high: "Directly and clearly answers why this company.",
      mid: "Mostly clear, but the reasoning could be more direct.",
      low: "The answer does not clearly answer the company-fit question.",
      improvement: "Use a direct because-statement followed by one supporting detail.",
    },
  ],
  self_assessment: [
    {
      label: "Self-awareness",
      rubric: "names a real strength, weakness, or trait with appropriate reflection",
      high: "Shows clear self-awareness about the trait.",
      mid: "Names a trait, but reflection is limited.",
      low: "Does not clearly show self-awareness.",
      improvement: "Name the trait directly and explain how you know it matters.",
    },
    {
      label: "Supporting evidence",
      rubric: "uses an example, feedback, result, or observed behavior",
      high: "Supports the trait with concrete evidence.",
      mid: "Provides some support, but the example is thin.",
      low: "Gives little evidence for the self-assessment.",
      improvement: "Add a concise example, feedback signal, or result that proves the trait.",
      evidence: true,
    },
    {
      label: "Role relevance",
      rubric: "connects the trait to role-relevant performance",
      high: "Connects the trait clearly to role performance.",
      mid: "The trait is plausible, but the role link needs work.",
      low: "Does not show why the trait matters for the role.",
      improvement: "Explain how the trait helps you perform in the target role.",
    },
    {
      label: "Credibility",
      rubric: "balanced, believable, and not overclaimed",
      high: "The claim is balanced and credible.",
      mid: "Generally believable, but needs more grounding.",
      low: "The claim sounds unsupported or generic.",
      improvement: "Make the claim more credible with a measured, specific example.",
    },
    {
      label: "Clarity",
      rubric: "direct, structured, and easy to follow",
      high: "The self-assessment is clear and easy to follow.",
      mid: "Understandable, but could be structured more cleanly.",
      low: "The answer is hard to follow or too thin.",
      improvement: "Use a clear structure: trait, evidence, role relevance.",
    },
  ],
};

/** One-line example of each STAR element, used in feedback when one is missing. */
const STAR_EXAMPLE: Record<"situation" | "task" | "action" | "result", string> = {
  situation: "briefly set the scene — e.g. 'During my final-year project…'",
  task: "state your specific responsibility — e.g. 'I was responsible for…'",
  action: "describe what you personally did — e.g. 'I rebuilt the model…'",
  result: "give the outcome, ideally quantified — e.g. 'cut reporting time by ~6 hrs/week'",
};

// --------------------------------------------------------------------------- //
// Feature extraction (pure)
// --------------------------------------------------------------------------- //
interface Features {
  words: number;
  iCount: number;
  weCount: number;
  numbers: number;
  namedEntities: number;
  actionVerbs: number;
  outcomeLanguage: number;
  hedges: number;
  hasSituation: boolean;
  hasTask: boolean;
  hasAction: boolean;
  hasResult: boolean;
}

function count(re: RegExp, s: string): number {
  return s.match(re)?.length ?? 0;
}

export function extractFeatures(answer: string): Features {
  const a = (answer ?? "").trim();
  const words = a ? a.split(/\s+/).length : 0;

  const iCount = count(/\bi\b/gi, a);
  const weCount = count(/\b(we|our)\b/gi, a);

  const numbers =
    count(/[€$£]\s?\d[\d.,]*/g, a) +
    count(/\b\d[\d.,]*\s?%/g, a) +
    count(/\b\d[\d.,]*\b/g, a) +
    count(/\b(million|billion|percent)\b/gi, a);

  // Named tools/methods grounded in the O*NET taxonomy + mid-sentence proper nouns.
  const properNouns = count(/(?<=[a-z,] )[A-Z][A-Za-z][A-Za-z.&-]+/g, a);
  const namedEntities = properNouns + extractCanonicalSkills(a).length;

  const actionVerbs = count(
    /\bi (?:led|built|created|made|proposed|organi[sz]ed|set up|designed|implemented|analy[sz]ed|ran|reached out|drove|coordinated|developed|wrote|presented|negotiated|resolved|decided|prioriti[sz]ed|rebuilt|restructured|launched|delivered|managed|reviewed|tested|automated|interviewed|suggested|started|framed|pitched|introduced|gathered|identified)\b/gi,
    a,
  );

  const outcomeLanguage = count(
    /\b(as a result|resulted in|led to|we delivered|i delivered|ultimately|in the end|the outcome|this (?:led|resulted|meant|improved|reduced|increased|saved|helped)|reduced|increased|improved|grew|saved|won|achieved|cut|adopted|delivered on time|highest grade|second place|first place)\b/gi,
    a,
  );

  const hedges = count(
    /\b(maybe|perhaps|i guess|sort of|kind of|not sure|probably|might be|possibly|i think i|i don't really)\b/gi,
    a.toLowerCase(),
  );

  const hasSituation =
    /\b(when|during|while|at the time|in my (?:first|previous|final|current|last|role|internship|job)|our team|we were (?:asked|tasked|working)|the (?:project|company|client|team) (?:was|had)|last (?:year|summer|semester|quarter))\b/i.test(
      a,
    );
  const hasTask =
    /\b(my (?:job|task|role|goal|responsibility|objective) was|i was responsible|i had to|i needed to|i was asked to|i was tasked|it was my job|i wanted to)\b/i.test(
      a,
    );
  const hasAction = actionVerbs >= 1;
  const hasResult = outcomeLanguage >= 1;

  return {
    words,
    iCount,
    weCount,
    numbers,
    namedEntities,
    actionVerbs,
    outcomeLanguage,
    hedges,
    hasSituation,
    hasTask,
    hasAction,
    hasResult,
  };
}

// --------------------------------------------------------------------------- //
// Heuristic dimension scoring (pure, deterministic, 1..5 each; null = N/A)
// --------------------------------------------------------------------------- //
function clamp15(x: number): number {
  return Math.max(1, Math.min(5, Math.round(x)));
}

function questionTypeFor(
  question: string,
  context?: BehaviouralScoringContext,
): BehaviouralQuestionType {
  if (!context) return "competency_star";
  return classifyBehaviouralQuestion({
    id: context.id ?? context.questionId,
    question: context.question ?? question,
    type: context.type,
    competency: context.competency,
    source: context.source,
  });
}

function isNonStarQuestionType(type: BehaviouralQuestionType): type is NonStarQuestionType {
  return type !== "competency_star";
}

function has(re: RegExp, s: string): boolean {
  return re.test(s);
}

function scoreSignals(...signals: boolean[]): number {
  return clamp15(1 + signals.filter(Boolean).length);
}

function genericSpecificityScore(f: Features): number {
  let score = 1;
  if (f.words >= 20) score += 1;
  if (f.numbers >= 1 || f.namedEntities >= 1) score += 1;
  if (f.numbers + f.namedEntities >= 2) score += 1;
  if (f.words >= 35 && (f.actionVerbs >= 1 || f.outcomeLanguage >= 1)) score += 1;
  if (f.words < 10) score = Math.min(score, 2);
  return clamp15(score);
}

function clarityScore(f: Features, answer: string): number {
  const sentenceLike = /[.!?]/.test(answer) || f.words <= 35;
  let score = scoreSignals(
    f.words >= 12,
    sentenceLike,
    f.hedges <= 1,
    f.words <= 160,
  );
  if (f.words < 6) score = 1;
  return score;
}

function concisionScore(f: Features): number {
  if (f.words < 8) return 1;
  if (f.words < 18) return 2;
  if (f.words <= 95) return 5;
  if (f.words <= 130) return 4;
  if (f.words <= 170) return 3;
  return 2;
}

function noSubstantiveAnswer(answer: string, f: Features): boolean {
  return f.words < 5 || /\b(i do not know|i don't know|not sure|no idea|hmm|literally now)\b/i.test(answer);
}

function companyNameFromQuestion(question: string): string | null {
  const match = question.match(/\b(?:at|for|with)\s+([A-Z][A-Za-z0-9&.'-]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function nonStarDimensionScores(
  question: string,
  answer: string,
  questionType: NonStarQuestionType,
): number[] {
  const f = extractFeatures(answer);
  if (noSubstantiveAnswer(answer, f)) return [1, 1, 1, 1, 1];

  const a = answer.toLowerCase();
  const q = question.toLowerCase();
  const company = companyNameFromQuestion(question);
  const hasFirstPerson = has(/\b(i|my|me)\b/i, answer);
  const hasBecause = has(/\b(because|drawn to|interested in|excited by|motivated by|appeals to|aligns? with|value)\b/i, answer);
  const roleTerms = has(/\b(role|consulting|consultant|analyst|data|client|business|problem|stakeholder|project|career)\b/i, answer);
  const companyTerms =
    has(/\b(company|team|mission|product|client|culture|industry|market|values|technology|talent)\b/i, answer) ||
    (!!company && a.includes(company));
  const selfTerms = has(/\b(strength|weakness|self|aware|feedback|learn|improve|applied|trait)\b/i, answer);
  const evidence = f.numbers >= 1 || f.namedEntities >= 1 || f.hasSituation || f.hasAction;
  const clarity = clarityScore(f, answer);
  const specificity = genericSpecificityScore(f);

  if (questionType === "introduction") {
    const positioning = scoreSignals(
      has(/\b(data|analyst|consult|business|technical|engineering|student|graduate|professional|background|experience)\b/i, answer),
      has(/\b(project|internship|role|work|experience|skill|built|led|analy[sz]ed)\b/i, answer),
      has(/\b(target|looking|interested|goal|career|next|want)\b/i, answer),
      f.words >= 25,
    );
    const relevance = scoreSignals(
      roleTerms,
      has(/\b(skill|project|experience|analysis|client|business|technical|data)\b/i, answer),
      hasFirstPerson,
      f.words >= 20,
    );
    return [positioning, relevance, specificity, clarity, concisionScore(f)];
  }

  if (questionType === "motivation_role_fit") {
    const motivation = scoreSignals(
      hasBecause,
      roleTerms || /\bconsult/.test(q),
      has(/\b(solve|build|analy[sz]e|learn|impact|client|business|problem)\b/i, answer),
      f.words >= 20,
    );
    const fit = scoreSignals(
      hasFirstPerson,
      has(/\b(skill|experience|project|background|strength|worked|built|analy[sz]ed)\b/i, answer),
      roleTerms,
      evidence,
    );
    const credibility = scoreSignals(hasFirstPerson, hasBecause, evidence, f.hedges <= 1 && f.words >= 20);
    return [motivation, fit, credibility, specificity, clarity];
  }

  if (questionType === "company_fit") {
    const knowledge = scoreSignals(
      companyTerms,
      !!company && a.includes(company),
      has(/\b(product|client|mission|culture|market|industry|team|technology|talent)\b/i, answer),
      f.namedEntities >= 1 || f.words >= 30,
    );
    const alignment = scoreSignals(
      hasBecause,
      hasFirstPerson,
      has(/\b(goal|values|career|fit|align|contribute|impact|learn|work style)\b/i, answer),
      f.words >= 20,
    );
    const authenticity = scoreSignals(hasFirstPerson, hasBecause, evidence || f.words >= 30, f.hedges <= 1);
    return [knowledge, alignment, specificity, authenticity, clarity];
  }

  const selfAwareness = scoreSignals(
    selfTerms,
    hasFirstPerson,
    has(/\b(learn|feedback|improve|aware|because|noticed|developed)\b/i, answer),
    f.words >= 20,
  );
  const supportingEvidence = scoreSignals(evidence, f.words >= 25, f.actionVerbs >= 1, f.outcomeLanguage >= 1 || f.numbers >= 1);
  const roleRelevance = scoreSignals(
    roleTerms,
    has(/\b(work|team|project|client|business|analysis|data|contribution|perform)\b/i, answer),
    hasFirstPerson,
    f.words >= 20,
  );
  const credibility = scoreSignals(hasFirstPerson, selfTerms, evidence, f.hedges <= 1 && f.words >= 20);
  return [selfAwareness, supportingEvidence, roleRelevance, credibility, clarity];
}

export function scoreDimensions(
  answer: string,
  prepared: AnswerBankEntry | null,
): Record<BehaviouralDimension, number | null> {
  const f = extractFeatures(answer);
  const veryShort = f.words < 12;

  const present = [f.hasSituation, f.hasTask, f.hasAction, f.hasResult].filter(Boolean).length;
  // A number in the closing portion (where results live) signals a quantified result,
  // rather than crediting numbers that only appear in the setup.
  const quantifiedResult =
    f.hasResult && /\d/.test(answer.slice(Math.floor(answer.length * 0.55)));

  // Anchored to the rubric: missing ≥2 elements is low; all four present is 4, and 5
  // only when it also reads as complete (quantified result or a substantial answer).
  let star: number;
  if (present <= 1) star = 1;
  else if (present === 2) star = 2;
  else if (present === 3) star = 3;
  else star = quantifiedResult || f.words >= 60 ? 5 : 4;
  if (veryShort) star = Math.min(star, 2);

  let specificity = 1;
  if (f.numbers >= 1) specificity += 1;
  if (f.numbers >= 3) specificity += 1;
  if (f.namedEntities >= 1) specificity += 1;
  if (f.namedEntities >= 3) specificity += 1;
  if (veryShort) specificity = Math.min(specificity, 2);

  let ownership: number;
  if (f.iCount === 0 && f.weCount === 0) ownership = 2;
  else ownership = 1 + Math.round((f.iCount / Math.max(1, f.iCount + f.weCount)) * 4);
  if (f.hasAction && f.iCount >= 2) ownership = Math.max(ownership, 4);

  let impact = 1;
  if (f.hasResult) impact = 3;
  if (quantifiedResult) impact = 4;
  if (quantifiedResult && f.outcomeLanguage >= 2) impact = 5;

  let key_point_coverage: number | null = null;
  if (prepared) {
    const reference = `${prepared.situation} ${prepared.task} ${prepared.action} ${prepared.result}`;
    key_point_coverage = clamp15(1 + Math.round(containment(reference, answer) * 4));
  }

  return {
    star_structure: clamp15(star),
    specificity: clamp15(specificity),
    ownership: clamp15(ownership),
    impact: clamp15(impact),
    key_point_coverage,
  };
}

// --------------------------------------------------------------------------- //
// Build a BehaviouralScore from dimension scores + feedback
// --------------------------------------------------------------------------- //
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function justify(d: BehaviouralDimension, score: number): string {
  const band = score >= 4 ? "hi" : score >= 3 ? "mid" : "lo";
  const text: Record<BehaviouralDimension, Record<string, string>> = {
    star_structure: {
      hi: "Clean, complete S-T-A-R — all four elements come through.",
      mid: "Most STAR elements present, but at least one is thin.",
      lo: "Missing two or more STAR elements; hard to follow as a story.",
    },
    specificity: {
      hi: "Rich, credible specifics — real numbers and named methods.",
      mid: "Some concrete detail, but parts stay generic.",
      lo: "Vague and generic; little verifiable detail.",
    },
    ownership: {
      hi: "Clear first-person contribution — what you did is unambiguous.",
      mid: "Mixed 'I' and 'we'; your individual role is partly blurred.",
      lo: "Mostly 'we'; your personal contribution is unclear.",
    },
    impact: {
      hi: "Closes with a concrete, quantified outcome.",
      mid: "States an outcome, but only qualitatively.",
      lo: "No clear result or impact.",
    },
    key_point_coverage: {
      hi: "Covers the key points from your prepared answer.",
      mid: "Covers some of your prepared points; a few are missing.",
      lo: "Misses most of the points you had prepared.",
    },
  };
  return text[d][band];
}

/** Salient key points from the prepared answer's action + result. */
function keyPointsFrom(p: AnswerBankEntry): string[] {
  return `${p.action} ${p.result}`
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 180)
    .slice(0, 4);
}

function shorten(s: string, n = 80): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

function buildScore(
  answer: string,
  prepared: AnswerBankEntry | null,
  dims: Record<BehaviouralDimension, number | null>,
): BehaviouralScore {
  const f = extractFeatures(answer);
  const snippet = answer.trim().replace(/\s+/g, " ").slice(0, 140);

  // Present dimensions (key-point coverage dropped when not applicable).
  const dimension_scores = BEHAVIOURAL_DIMENSIONS.filter((d) => dims[d] !== null).map((d) => {
    const score = dims[d] as number;
    const withEvidence = d === "specificity" || d === "impact";
    return {
      dimension: DIM_LABEL[d],
      score,
      justification: justify(d, score),
      ...(withEvidence && snippet ? { evidence: snippet } : {}),
    };
  });

  const present = dimension_scores.map((x) => x.score);
  const overall = round1(present.reduce((a, b) => a + b, 0) / Math.max(1, present.length));

  // Covered / missed key points from the prepared answer.
  const covered_key_points: string[] = [];
  const missed_key_points: string[] = [];
  if (prepared) {
    for (const kp of keyPointsFrom(prepared)) {
      (containment(kp, answer) >= 0.4 ? covered_key_points : missed_key_points).push(shorten(kp));
    }
  }

  // Strengths — tied to detected features of the actual response.
  const strengths: string[] = [];
  if ((dims.star_structure ?? 0) >= 4) strengths.push("Complete STAR structure — situation, task, action, and result all land.");
  if ((dims.specificity ?? 0) >= 4) strengths.push("Strong specifics — concrete numbers and named methods make it credible.");
  if ((dims.ownership ?? 0) >= 4) strengths.push("Clear first-person ownership of what you did.");
  if ((dims.impact ?? 0) >= 4) strengths.push("Closes with a concrete, quantified outcome.");
  if ((dims.key_point_coverage ?? 0) >= 4) strengths.push("Covered the key points from your prepared answer.");

  // Improvements — name missing STAR elements with an example, and concrete fixes.
  const improvements: string[] = [];
  if (!f.hasSituation) improvements.push(`Add the situation: ${STAR_EXAMPLE.situation}.`);
  if (!f.hasTask) improvements.push(`Add the task: ${STAR_EXAMPLE.task}.`);
  if (!f.hasAction) improvements.push(`Add your action: ${STAR_EXAMPLE.action}.`);
  if (!f.hasResult) improvements.push(`Add the result: ${STAR_EXAMPLE.result}.`);
  if ((dims.specificity ?? 5) <= 2) improvements.push("Add concrete detail — a number, a timeframe, or a named tool (e.g. 'Power BI' or '28% drop-off').");
  if ((dims.ownership ?? 5) <= 2) improvements.push("Use 'I' rather than 'we' so your individual contribution is clear.");
  if (dims.key_point_coverage === null) {
    improvements.push("Relevance to your prepared answer wasn't scored — no close match was found in your answer bank.");
  } else if (dims.key_point_coverage <= 2) {
    improvements.push("A few of your prepared key points didn't come through this time.");
  }

  return { dimension_scores, overall, covered_key_points, missed_key_points, strengths, improvements };
}

function nonStarJustify(spec: NonStarDimensionSpec, score: number): string {
  if (score >= 4) return spec.high;
  if (score >= 3) return spec.mid;
  return spec.low;
}

function buildNonStarScore(
  question: string,
  answer: string,
  questionType: NonStarQuestionType,
): BehaviouralScore {
  const profile = NON_STAR_PROFILES[questionType];
  const scores = nonStarDimensionScores(question, answer, questionType);
  const snippet = answer.trim().replace(/\s+/g, " ").slice(0, 140);
  const dimension_scores = profile.map((spec, i) => ({
    dimension: spec.label,
    score: clamp15(scores[i] ?? 1),
    justification: nonStarJustify(spec, scores[i] ?? 1),
    ...(spec.evidence && snippet ? { evidence: snippet } : {}),
  }));
  const overall = round1(
    dimension_scores.reduce((sum, d) => sum + d.score, 0) / dimension_scores.length,
  );
  const strengths = dimension_scores
    .filter((d) => d.score >= 4)
    .map((d) => `${d.dimension} was comparatively strong.`)
    .slice(0, 4);
  const improvements = profile
    .filter((spec, i) => (scores[i] ?? 1) <= 2)
    .map((spec) => spec.improvement);

  if (noSubstantiveAnswer(answer, extractFeatures(answer))) {
    improvements.unshift("Give a substantive answer that directly addresses the question.");
  }

  return {
    dimension_scores,
    overall,
    covered_key_points: [],
    missed_key_points: [],
    strengths,
    improvements: [...new Set(improvements)],
  };
}

/** Deterministic, network-free heuristic evaluation (the mock-mode path). */
export function heuristicEvaluation(
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
  context?: BehaviouralScoringContext,
): BehaviouralScore {
  const questionType = questionTypeFor(question, context);
  if (isNonStarQuestionType(questionType)) {
    return buildNonStarScore(question, answer, questionType);
  }
  return buildScore(answer, prepared, scoreDimensions(answer, prepared));
}

// --------------------------------------------------------------------------- //
// Real-mode (Haiku) evaluation + coercion
// --------------------------------------------------------------------------- //
const RUBRIC_TEXT = [
  "- STAR structure (1-5): are Situation, Task, Action, Result all present and clear?",
  "- Specificity / evidence (1-5): concrete numbers, named tools/methods vs. generic claims.",
  "- Ownership (1-5): first-person 'I' contribution vs. vague 'we'.",
  "- Impact / result (1-5): quantified, meaningful outcome vs. none.",
  "- Key-point coverage (1-5): does the answer cover the key points from the candidate's OWN prepared answer (below)? Omit this dimension entirely if no prepared answer is provided.",
].join("\n");

function nonStarRubricText(questionType: NonStarQuestionType): string {
  return NON_STAR_PROFILES[questionType]
    .map((d) => `- ${d.label} (1-5): ${d.rubric}.`)
    .join("\n");
}

function preparedText(p: AnswerBankEntry | null): string {
  if (!p) return "(no prepared answer was retrieved — do not score Key-point coverage)";
  return `Situation: ${p.situation}\nTask: ${p.task}\nAction: ${p.action}\nResult: ${p.result}`;
}

/** True if a model-returned dimension label refers to Key-point coverage (any casing/punctuation). */
function isKeyPointCoverage(dimension: string): boolean {
  return dimension.toLowerCase().replace(/[^a-z]/g, "").includes("keypoint");
}

/** Note mock mode adds when coverage can't be scored; reused so real mode matches. */
const NO_COVERAGE_NOTE =
  "Relevance to your prepared answer wasn't scored — no close match was found in your answer bank.";

export function coerceScore(
  raw: unknown,
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
  context?: BehaviouralScoringContext,
): BehaviouralScore {
  const questionType = questionTypeFor(question, context);
  if (isNonStarQuestionType(questionType)) {
    return coerceNonStarScore(raw, question, answer, questionType);
  }

  const r = raw as Partial<BehaviouralScore> | null;
  const ds = Array.isArray(r?.dimension_scores) ? r!.dimension_scores : [];
  if (ds.length === 0) return heuristicEvaluation(question, answer, prepared); // unusable → heuristic
  let dimension_scores = ds
    .filter((x) => x && x.dimension)
    .map((x) => ({
      dimension: String(x.dimension),
      score: clamp15(Number(x.score) || 3),
      justification: String(x.justification ?? ""),
      ...(x.evidence ? { evidence: String(x.evidence) } : {}),
    }));

  // F2: with no matched prepared answer, Key-point coverage is "not applicable". Drop it even if
  // the model returned it (Haiku doesn't always honor the "omit" instruction), so real mode matches
  // the mock heuristic — then recompute `overall` from the remaining dimensions, never the model's
  // (possibly coverage-inclusive) overall.
  const noPrepared = prepared === null;
  if (noPrepared) {
    dimension_scores = dimension_scores.filter((x) => !isKeyPointCoverage(x.dimension));
  }
  if (dimension_scores.length === 0) return heuristicEvaluation(question, answer, prepared);

  const present = dimension_scores.map((x) => x.score);
  const overall =
    !noPrepared && typeof r?.overall === "number"
      ? round1(r.overall)
      : round1(present.reduce((a, b) => a + b, 0) / Math.max(1, present.length));

  const improvements = Array.isArray(r?.improvements) ? r!.improvements.map(String) : [];
  if (noPrepared && !improvements.includes(NO_COVERAGE_NOTE)) improvements.push(NO_COVERAGE_NOTE);

  return {
    dimension_scores,
    overall,
    covered_key_points: Array.isArray(r?.covered_key_points) ? r!.covered_key_points.map(String) : [],
    missed_key_points: Array.isArray(r?.missed_key_points) ? r!.missed_key_points.map(String) : [],
    strengths: Array.isArray(r?.strengths) ? r!.strengths.map(String) : [],
    improvements,
  };
}

function normalizedDimensionLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z]/g, "");
}

function noStarLanguage(items: string[]): string[] {
  return items.filter((x) => !/\b(STAR|Situation|Task|Action|Result)\b/i.test(x));
}

function coerceNonStarScore(
  raw: unknown,
  question: string,
  answer: string,
  questionType: NonStarQuestionType,
): BehaviouralScore {
  const fallback = buildNonStarScore(question, answer, questionType);
  const r = raw as Partial<BehaviouralScore> | null;
  const ds = Array.isArray(r?.dimension_scores) ? r!.dimension_scores : [];
  if (ds.length === 0) return fallback;

  const byLabel = new Map(
    ds
      .filter((x) => x && x.dimension)
      .map((x) => [
        normalizedDimensionLabel(String(x.dimension)),
        {
          score: clamp15(Number(x.score) || 3),
          justification: String(x.justification ?? ""),
          evidence: x.evidence ? String(x.evidence) : undefined,
        },
      ]),
  );
  const fallbackByLabel = new Map(
    fallback.dimension_scores.map((d) => [normalizedDimensionLabel(d.dimension), d]),
  );

  const dimension_scores = NON_STAR_PROFILES[questionType].map((spec) => {
    const normalized = normalizedDimensionLabel(spec.label);
    const model = byLabel.get(normalized);
    const fb = fallbackByLabel.get(normalized);
    const score = model?.score ?? fb?.score ?? 1;
    const justification = model?.justification || fb?.justification || nonStarJustify(spec, score);
    return {
      dimension: spec.label,
      score,
      justification: hasStarAdvice(justification) ? nonStarJustify(spec, score) : justification,
      ...(spec.evidence && (model?.evidence || fb?.evidence) ? { evidence: model?.evidence ?? fb?.evidence } : {}),
    };
  });
  const overall = round1(
    dimension_scores.reduce((sum, d) => sum + d.score, 0) / dimension_scores.length,
  );
  const modelStrengths = Array.isArray(r?.strengths) ? noStarLanguage(r!.strengths.map(String)) : [];
  const modelImprovements = Array.isArray(r?.improvements) ? noStarLanguage(r!.improvements.map(String)) : [];

  return {
    dimension_scores,
    overall,
    covered_key_points: [],
    missed_key_points: [],
    strengths: modelStrengths.length ? modelStrengths : fallback.strengths,
    improvements: modelImprovements.length ? modelImprovements : fallback.improvements,
  };
}

function hasStarAdvice(text: string): boolean {
  return /\b(STAR|Situation|Task|Action|Result)\b/i.test(text);
}

async function claudeEvaluation(
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
  context?: BehaviouralScoringContext,
): Promise<BehaviouralScore> {
  const questionType = questionTypeFor(question, context);
  if (isNonStarQuestionType(questionType)) {
    return claudeNonStarEvaluation(question, answer, questionType);
  }

  const system =
    "You are an interview coach scoring a single behavioural (STAR) answer against a fixed rubric. " +
    "Score only what the response demonstrates. Be strict and evidence-grounded. Return compact valid JSON only, with no prose outside the JSON.";
  const prompt = [
    `Question: ${question}`,
    "",
    "Rubric (score each 1-5):",
    RUBRIC_TEXT,
    "",
    "Candidate's own prepared answer (for Key-point coverage):",
    preparedText(prepared),
    "",
    `Candidate's live response:\n"""${answer}"""`,
    "",
    "Feedback must reference at least one specific element of the response, name any missing STAR element with a one-line example, and (when relevant) note the gap vs. the prepared answer.",
    "",
    'Return JSON: {"dimension_scores":[{"dimension":"STAR structure|Specificity / evidence|Ownership|Impact / result|Key-point coverage","score":1-5,"justification":"...","evidence":"short quote"}],"overall":1-5,"covered_key_points":[],"missed_key_points":[],"strengths":[],"improvements":[]}',
  ].join("\n");

  try {
    const text = await complete(prompt, { system, temperature: 0, maxTokens: 2000 });
    return coerceScore(extractJSON(text), question, answer, prepared);
  } catch {
    return heuristicEvaluation(question, answer, prepared); // network/parse failure → heuristic
  }
}

async function claudeNonStarEvaluation(
  question: string,
  answer: string,
  questionType: NonStarQuestionType,
): Promise<BehaviouralScore> {
  const labels = NON_STAR_PROFILES[questionType].map((d) => d.label).join("|");
  const system =
    "You are an interview coach scoring a single interview answer against a fixed question-type rubric. " +
    "Score only what the response demonstrates. Do not use STAR criteria unless the rubric explicitly asks for it. Return compact valid JSON only, with no prose outside the JSON.";
  const prompt = [
    `Question type: ${questionType}`,
    `Question: ${question}`,
    "",
    "Rubric (score each 1-5):",
    nonStarRubricText(questionType),
    "",
    `Candidate's live response:\n"""${answer}"""`,
    "",
    "Feedback must reference only observable answer content. Do not mention STAR, Situation, Task, Action, or Result for this question type.",
    "",
    `Return JSON: {"dimension_scores":[{"dimension":"${labels}","score":1-5,"justification":"...","evidence":"short quote"}],"overall":1-5,"covered_key_points":[],"missed_key_points":[],"strengths":[],"improvements":[]}`,
  ].join("\n");

  try {
    const text = await complete(prompt, { system, temperature: 0, maxTokens: 2000 });
    return coerceScore(extractJSON(text), question, answer, null, { question, type: questionType });
  } catch {
    return buildNonStarScore(question, answer, questionType);
  }
}

/**
 * Evaluate one behavioural response. Mock mode is the deterministic heuristic; real
 * mode prompts Haiku and coerces to the same `BehaviouralScore` shape.
 */
export async function evaluateBehavioural(
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
  context?: BehaviouralScoringContext,
): Promise<BehaviouralScore> {
  if (useMocks()) return heuristicEvaluation(question, answer, prepared, context);
  return claudeEvaluation(question, answer, prepared, context);
}
