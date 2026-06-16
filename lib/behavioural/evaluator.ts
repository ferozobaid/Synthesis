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
 * Key-point coverage is the RAG-grounded dimension: when retrieval returned nothing
 * relevant (`prepared === null`) it is marked "not applicable" — dropped from the
 * dimension list with an explicit feedback note — rather than scored 0.
 *
 * Live plane only. Never imports from /scripts or /n8n.
 */
import { complete, extractJSON } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import { containment } from "@/lib/text";
import { extractCanonicalSkills } from "@/lib/onet";
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

/** Deterministic, network-free heuristic evaluation (the mock-mode path). */
export function heuristicEvaluation(
  _question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
): BehaviouralScore {
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
): BehaviouralScore {
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

async function claudeEvaluation(
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
): Promise<BehaviouralScore> {
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

/**
 * Evaluate one behavioural response. Mock mode is the deterministic heuristic; real
 * mode prompts Haiku and coerces to the same `BehaviouralScore` shape.
 */
export async function evaluateBehavioural(
  question: string,
  answer: string,
  prepared: AnswerBankEntry | null,
): Promise<BehaviouralScore> {
  if (useMocks()) return heuristicEvaluation(question, answer, prepared);
  return claudeEvaluation(question, answer, prepared);
}
