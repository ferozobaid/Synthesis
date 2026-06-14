/**
 * Case response evaluator — scores ONE candidate response at the current FSM stage
 * against the case's 5-dimension rubric (structure, hypothesis, quant, synthesis,
 * communication) and returns the shared `Evaluation` shape, so mock and real modes
 * are interchangeable (mirrors how lib/matching.ts produces real FitReports).
 *
 *  - MOCK MODE (no credentials): a deterministic, feature-based heuristic. It counts
 *    structure / hypothesis / synthesis markers, numeric & arithmetic reasoning,
 *    hedging, data references and length, and maps them to a 1–5 score per dimension.
 *    Pure function of the text ⇒ varied across inputs, identical for identical input,
 *    no network — so a full session scores sensibly with no API keys.
 *  - REAL MODE (Haiku 4.5): a rubric-anchored, low-temperature scoring prompt that
 *    returns the same shape; falls back to the heuristic on any error (mirrors
 *    lib/embeddings.ts).
 *
 * `isStrong()` collapses an Evaluation into the boolean the pure FSM
 * (lib/fsm/case-fsm) needs to decide advance vs. probe/redirect/hint.
 *
 * Live plane only. Never imports from /scripts or /n8n.
 */
import { complete, extractJSON } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import { getStage } from "@/lib/fsm/case-fsm";
import type { CaseRecord, CaseState, Evaluation } from "@/lib/types";

export const CASE_DIMENSIONS = [
  "structure",
  "hypothesis",
  "quant",
  "synthesis",
  "communication",
] as const;
export type CaseDimension = (typeof CASE_DIMENSIONS)[number];

/** Strength bar (on the 0.6·primary + 0.4·secondary blend) to advance a stage. */
export const ADVANCE_THRESHOLD = 3.0;

/**
 * The two rubric dimensions each stage is judged on (primary first). intro and
 * clarification lead on communication/clarity (restating the prompt, asking sharp
 * questions) rather than visible structure.
 */
const STAGE_EMPHASIS: Record<CaseState, CaseDimension[]> = {
  intro: ["communication", "structure"],
  clarification: ["communication", "structure"],
  framework: ["structure", "hypothesis"],
  analysis: ["structure", "synthesis"],
  // Interpreting exhibits; the dynamic quant override below makes this quant-led
  // only for cases whose quant calculation actually lands at data_reveal (Beautify).
  data_reveal: ["synthesis", "structure"],
  pressure_test: ["hypothesis", "synthesis"],
  recommendation: ["synthesis", "communication"],
  scoring: ["synthesis", "communication"],
};

/** Dimensions that matter at `stage`; the case's own quant stage is forced to weigh quant. */
export function emphasisFor(c: CaseRecord, stage: CaseState): CaseDimension[] {
  const base = STAGE_EMPHASIS[stage] ?? ["structure", "communication"];
  if (c.quant?.stage === stage && !base.includes("quant")) {
    return ["quant", base[0]];
  }
  return base;
}

// --------------------------------------------------------------------------- //
// Feature extraction (pure)
// --------------------------------------------------------------------------- //
interface Features {
  words: number;
  numbers: number; // numeric / %/ currency / magnitude tokens
  calc: number; // explicit arithmetic
  structure: number; // signposting + framework language + lists
  hypothesis: number; // explicit point-of-view markers
  synthesisMarkers: number; // connective / conclusion language
  dataRefs: number; // references to the case's data
  hedges: number; // uncertainty language
}

function count(re: RegExp, s: string): number {
  return s.match(re)?.length ?? 0;
}

export function extractFeatures(answer: string): Features {
  const a = (answer ?? "").trim();
  const words = a ? a.split(/\s+/).length : 0;

  const numbers =
    count(/[€$£]\s?\d[\d.,]*/g, a) +
    count(/\b\d[\d.,]*\s?%/g, a) +
    count(/\b\d[\d.,]*\b/g, a) +
    count(/\b(million|billion|percent|pesos?|payback|roi)\b/gi, a);

  const calc = count(/[=÷×≈]|\b(divided by|divide|multiply|multiplied|times|minus|equals)\b|\d\s*\/\s*\d/gi, a);

  const structure =
    count(/\b(first(ly)?|second(ly)?|third(ly)?|fourth(ly)?|fifth|finally|lastly)\b/gi, a) +
    count(/\b(framework|structure|structured|mece|buckets?|categor(?:y|ies)|dimensions?|levers?|two (?:factors|areas|buckets|things|questions)|three (?:factors|areas|buckets|things|questions))\b/gi, a) +
    count(/(?:^|\n)\s*(?:\d+[.)]|[-*•])/g, a) +
    (count(/,/g, a) >= 2 ? 1 : 0);

  const hypothesis = count(
    /\b(hypothes\w+|my (?:hypothesis|view|sense|take|prior)|i(?:'|’| a)?d? (?:expect|argue|bet|believe|think|suspect)|i expect|i believe|the key driver|i'd hypothesi[sz]e)\b/gi,
    a,
  );

  const dataRefs = count(
    /\b(exhibit|the data|the numbers|payback|savings|conversion|return rate|try-on|region [abc]|warehouses?|crime)\b/gi,
    a,
  );

  const synthesisMarkers = count(
    /\b(therefore|thus|hence|as a result|which means|this (?:means|suggests|implies)|in (?:conclusion|summary|short)|net[- ]net|the takeaway|overall|so (?:my|the|i|we)|recommend\w*|my recommendation|bottom line)\b/gi,
    a,
  );

  const hedges = count(
    /\b(maybe|perhaps|i guess|sort of|kind of|not sure|probably|might be|possibly|dunno|hard to say)\b/gi,
    a.toLowerCase(),
  );

  return { words, numbers, calc, structure, hypothesis, synthesisMarkers, dataRefs, hedges };
}

// --------------------------------------------------------------------------- //
// Heuristic dimension scoring (pure, deterministic, 1..5 each)
// --------------------------------------------------------------------------- //
function clamp15(x: number): number {
  return Math.max(1, Math.min(5, Math.round(x)));
}

export function scoreDimensions(answer: string): Record<CaseDimension, number> {
  const f = extractFeatures(answer);
  const veryShort = f.words < 8;
  const answerFirst =
    /^(my recommendation|i(?:'|’| a)?d? recommend|i recommend|in short|in summary|overall|yes[,.\s]|no[,.\s]|the answer is|bottom line)/i.test(
      answer.trim(),
    );

  let structure = 1 + Math.min(3, f.structure);
  if (f.words >= 60) structure += 1;
  if (veryShort) structure = Math.min(structure, 2);

  let hypothesis = 1 + Math.min(3, f.hypothesis * 2);
  if (f.hypothesis >= 1 && f.synthesisMarkers >= 1) hypothesis += 1;
  if (f.hedges >= 2) hypothesis -= 1;
  if (veryShort) hypothesis = Math.min(hypothesis, 2);

  let quant = 1;
  if (f.numbers >= 1) quant = 3;
  if (f.numbers >= 4) quant = 4;
  if (f.numbers >= 2 && f.calc >= 1) quant += 1;

  let synthesis = 1 + Math.min(2, f.synthesisMarkers);
  if (f.dataRefs >= 1) synthesis += 1;
  if (f.synthesisMarkers >= 1 && f.numbers >= 1) synthesis += 1;
  if (f.hedges >= 2) synthesis -= 1;
  if (veryShort) synthesis = Math.min(synthesis, 2);

  let communication = 2;
  if (answerFirst) communication += 1;
  if (f.structure >= 2) communication += 1;
  if (f.words >= 20 && f.words <= 170) communication += 1;
  if (f.words < 8 || f.words > 280) communication -= 1;
  if (f.hedges >= 3) communication -= 1;

  return {
    structure: clamp15(structure),
    hypothesis: clamp15(hypothesis),
    quant: clamp15(quant),
    synthesis: clamp15(synthesis),
    communication: clamp15(communication),
  };
}

// --------------------------------------------------------------------------- //
// Build an Evaluation from dimension scores
// --------------------------------------------------------------------------- //
export const DIM_LABEL: Record<CaseDimension, string> = {
  structure: "Structure",
  hypothesis: "Hypothesis-driven thinking",
  quant: "Quantitative reasoning",
  synthesis: "Synthesis",
  communication: "Communication",
};

function justify(d: CaseDimension, score: number): string {
  const band = score >= 4 ? "hi" : score >= 3 ? "mid" : "lo";
  const text: Record<CaseDimension, Record<string, string>> = {
    structure: {
      hi: "Clear, signposted, MECE-style structure.",
      mid: "Some structure, but partly generic or overlapping.",
      lo: "Little visible structure; ideas listed at random.",
    },
    hypothesis: {
      hi: "States and drives toward an explicit point of view.",
      mid: "An implicit hypothesis, only weakly tested.",
      lo: "Reactive — no clear hypothesis.",
    },
    quant: {
      hi: "Numbers and arithmetic are worked through clearly.",
      mid: "Some quantification, but thin or unexplained.",
      lo: "Little or no quantitative reasoning.",
    },
    synthesis: {
      hi: "Connects evidence into a crisp, supported conclusion.",
      mid: "Partial synthesis; the conclusion is under-supported.",
      lo: "Data and ideas left unconnected.",
    },
    communication: {
      hi: "Answer-first, concise and easy to follow.",
      mid: "Mostly clear, but buries the answer.",
      lo: "Hard to follow or too thin to assess.",
    },
  };
  return text[d][band];
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function buildEvaluation(c: CaseRecord, stage: CaseState, answer: string, dims: Record<CaseDimension, number>): Evaluation {
  const emphasized = emphasisFor(c, stage);
  const snippet = answer.trim().replace(/\s+/g, " ").slice(0, 160);

  const dimension_scores = CASE_DIMENSIONS.map((d) => ({
    dimension: d,
    score: dims[d],
    justification: justify(d, dims[d]),
    ...(emphasized.includes(d) && snippet ? { transcript_evidence: snippet } : {}),
  }));

  const emph = emphasized.map((d) => dims[d]);
  const overall = round1(emph.reduce((a, b) => a + b, 0) / Math.max(1, emph.length));

  const strengths = emphasized.filter((d) => dims[d] >= 4).map((d) => `${DIM_LABEL[d]} was strong here.`);
  const improvements = emphasized.filter((d) => dims[d] <= 2).map((d) => `${DIM_LABEL[d].toLowerCase()} needs work at the ${stage} stage.`);
  const next_focus = emphasized.filter((d) => dims[d] < 3).map((d) => DIM_LABEL[d]);

  return { module: "case", dimension_scores, overall, strengths, improvements, next_focus };
}

/** Deterministic, network-free heuristic evaluation (the mock-mode path). */
export function heuristicEvaluation(c: CaseRecord, stage: CaseState, answer: string): Evaluation {
  return buildEvaluation(c, stage, answer, scoreDimensions(answer));
}

// --------------------------------------------------------------------------- //
// Real-mode (Haiku) evaluation + coercion
// --------------------------------------------------------------------------- //
function rubricText(c: CaseRecord): string {
  return c.scoring_rubric.dimensions
    .map((d) => `- ${d.name}: ${d.description} (1=${d.anchors["1"]} 3=${d.anchors["3"]} 5=${d.anchors["5"]})`)
    .join("\n");
}

function coerceEvaluation(raw: unknown, c: CaseRecord, stage: CaseState, answer: string): Evaluation {
  const r = raw as Partial<Evaluation> | null;
  const ds = Array.isArray(r?.dimension_scores) ? r!.dimension_scores : [];
  if (ds.length === 0) return heuristicEvaluation(c, stage, answer); // unusable → heuristic
  const dimension_scores = CASE_DIMENSIONS.map((d) => {
    const hit = ds.find((x) => String(x?.dimension).toLowerCase().startsWith(d.slice(0, 4)));
    const score = clamp15(Number(hit?.score) || 3);
    return {
      dimension: d,
      score,
      justification: String(hit?.justification ?? justify(d, score)),
      ...(hit?.transcript_evidence ? { transcript_evidence: String(hit.transcript_evidence) } : {}),
    };
  });
  const emph = emphasisFor(c, stage).map((d) => dimension_scores.find((x) => x.dimension === d)!.score);
  return {
    module: "case",
    dimension_scores,
    overall: typeof r?.overall === "number" ? round1(r.overall) : round1(emph.reduce((a, b) => a + b, 0) / Math.max(1, emph.length)),
    strengths: Array.isArray(r?.strengths) ? r!.strengths.map(String) : [],
    improvements: Array.isArray(r?.improvements) ? r!.improvements.map(String) : [],
    next_focus: Array.isArray(r?.next_focus) ? r!.next_focus.map(String) : [],
  };
}

async function claudeEvaluation(c: CaseRecord, stage: CaseState, answer: string): Promise<Evaluation> {
  const s = getStage(c, stage);
  const system =
    "You are a McKinsey case interviewer scoring a single candidate response against a fixed rubric. " +
    "Score only what the response demonstrates. Be strict and evidence-grounded. Return JSON only.";
  const prompt = [
    `Case: ${c.title}`,
    `Stage: ${stage} — ${s?.objective ?? ""}`,
    `What a strong response does here: ${s?.advance_criteria ?? ""}`,
    s?.target_elements?.length ? `Target elements: ${s.target_elements.join("; ")}` : "",
    "",
    "Rubric (score each 1-5):",
    rubricText(c),
    "",
    `Candidate response:\n"""${answer}"""`,
    "",
    'Return JSON: {"module":"case","dimension_scores":[{"dimension":"structure|hypothesis|quant|synthesis|communication","score":1-5,"justification":"...","transcript_evidence":"short quote"}],"overall":1-5,"strengths":[],"improvements":[],"next_focus":[]}',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const text = await complete(prompt, { system, temperature: 0, maxTokens: 900 });
    return coerceEvaluation(extractJSON(text), c, stage, answer);
  } catch {
    return heuristicEvaluation(c, stage, answer); // network/parse failure → heuristic
  }
}

/**
 * Evaluate one candidate response at `stage`. Mock mode is the deterministic
 * heuristic; real mode prompts Haiku and coerces to the same shape.
 */
export async function evaluateResponse(c: CaseRecord, stage: CaseState, answer: string): Promise<Evaluation> {
  if (useMocks()) return heuristicEvaluation(c, stage, answer);
  return claudeEvaluation(c, stage, answer);
}

/** Collapse an Evaluation into the FSM's advance/weak decision for `stage`. */
export function isStrong(ev: Evaluation, stage: CaseState, c: CaseRecord): boolean {
  const emphasized = emphasisFor(c, stage);
  const get = (d: CaseDimension) => ev.dimension_scores.find((x) => x.dimension === d)?.score ?? 0;
  const primary = get(emphasized[0]);
  const secondary = emphasized[1] ? get(emphasized[1]) : primary;
  return 0.6 * primary + 0.4 * secondary >= ADVANCE_THRESHOLD;
}
