/**
 * Final case scoring — aggregates a completed session's transcript into one
 * rubric-anchored `CaseScore` (5 dimensions: structure, hypothesis, quant,
 * synthesis, communication) with feedback that cites specific moments.
 *
 *  - MOCK MODE: deterministic. Re-evaluates every candidate turn from
 *    `session.history` (same heuristic as the live evaluator), takes the best
 *    score per dimension across the stages that emphasize it, then applies
 *    transcript penalties from the probe/hint counts — e.g. needing the level-3
 *    hint at the quant stage caps the quant dimension (per scoring_criteria.md).
 *    Feedback references the actual session (which stages needed help, whether the
 *    final recommendation anchored on the numbers).
 *  - REAL MODE (Haiku): one holistic, low-temperature call over the transcript +
 *    rubric anchors + target_solution_notes; falls back to the mock aggregation.
 *
 * Live plane only. Never imports from /scripts or /n8n.
 */
import { complete, extractJSON } from "@/lib/claude";
import { useMocks } from "@/lib/config";
import type { CaseRecord, CaseScore, CaseSessionState, CaseState, CaseTurn } from "@/lib/types";
import {
  CASE_DIMENSIONS,
  DIM_LABEL,
  emphasisFor,
  extractFeatures,
  scoreDimensions,
  type CaseDimension,
} from "@/lib/fsm/case-evaluator";

function clamp15(x: number): number {
  return Math.max(1, Math.min(5, Math.round(x)));
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Score ceiling for a stage's primary dimension given how much help it needed. */
function stageCap(hints: number, attempts: number): number {
  let cap = 5;
  if (hints >= 1) cap = 4;
  if (hints >= 2) cap = 3;
  if (hints >= 3) cap = 2;
  if (attempts >= 2 && cap > 4) cap = 4; // needed a redirect, even without hints
  return cap;
}

// --------------------------------------------------------------------------- //
// Deterministic aggregation (mock mode)
// --------------------------------------------------------------------------- //
export function aggregateScore(c: CaseRecord, session: CaseSessionState): CaseScore {
  const candidateTurns = session.history.filter((t) => t.role === "candidate");

  // Best score per dimension, taken only from stages that emphasize that dimension.
  const best: Record<CaseDimension, number> = {
    structure: 0,
    hypothesis: 0,
    quant: 0,
    synthesis: 0,
    communication: 0,
  };
  const seen: Record<CaseDimension, boolean> = {
    structure: false,
    hypothesis: false,
    quant: false,
    synthesis: false,
    communication: false,
  };

  for (const turn of candidateTurns) {
    const dims = scoreDimensions(turn.text);
    const emphasized = emphasisFor(c, turn.stage);
    for (const d of emphasized) {
      seen[d] = true;
      if (dims[d] > best[d]) best[d] = dims[d];
    }
  }
  // Any dimension never emphasized in this run: fall back to its best across all turns.
  for (const d of CASE_DIMENSIONS) {
    if (!seen[d]) {
      for (const turn of candidateTurns) {
        const v = scoreDimensions(turn.text)[d];
        if (v > best[d]) best[d] = v;
      }
      if (best[d] === 0) best[d] = 2;
    }
  }

  // Transcript penalties: cap a stage's PRIMARY dimension by how much help it needed.
  const cap: Record<CaseDimension, number> = {
    structure: 5,
    hypothesis: 5,
    quant: 5,
    synthesis: 5,
    communication: 5,
  };
  for (const stage of Object.keys(session.stage_attempts ?? {}).concat(Object.keys(session.hints_used ?? {})) as CaseState[]) {
    const primary = emphasisFor(c, stage)[0];
    const hints = session.hints_used?.[stage] ?? 0;
    const attempts = session.stage_attempts?.[stage] ?? 0;
    cap[primary] = Math.min(cap[primary], stageCap(hints, attempts));
  }

  const dimension_scores = c.scoring_rubric.dimensions.map((rd) => {
    const d = rd.name as CaseDimension;
    const raw = best[d] || 3;
    const score = clamp15(Math.min(raw, cap[d] ?? 5));
    return { dimension: d, score, justification: dimJustification(c, session, d, score, raw, cap[d] ?? 5) };
  });

  const totalW = c.scoring_rubric.dimensions.reduce((a, d) => a + d.weight, 0) || 1;
  const overall = round1(
    c.scoring_rubric.dimensions.reduce((a, rd) => {
      const s = dimension_scores.find((x) => x.dimension === rd.name)!.score;
      return a + rd.weight * s;
    }, 0) / totalW,
  );

  const { strengths, improvements, next_focus } = buildFeedback(c, session, dimension_scores);
  return { dimension_scores, overall, strengths, improvements, next_focus };
}

function dimJustification(
  c: CaseRecord,
  session: CaseSessionState,
  d: CaseDimension,
  score: number,
  raw: number,
  cap: number,
): string {
  const base =
    score >= 4
      ? `${DIM_LABEL[d]} was a clear strength across the case.`
      : score >= 3
        ? `${DIM_LABEL[d]} was solid but uneven.`
        : `${DIM_LABEL[d]} was a weak point.`;
  if (raw > cap) {
    // The score was held back by needing help at the stage that drives this dimension.
    const stage = (Object.keys(session.hints_used ?? {}) as CaseState[]).find((s) => emphasisFor(c, s)[0] === d);
    return `${base} Capped because you needed hints at the ${stage ?? "key"} stage.`;
  }
  return base;
}

function buildFeedback(
  c: CaseRecord,
  session: CaseSessionState,
  dimension_scores: { dimension: string; score: number }[],
): { strengths: string[]; improvements: string[]; next_focus: string[] } {
  const get = (d: CaseDimension) => dimension_scores.find((x) => x.dimension === d)?.score ?? 0;
  const strengths: string[] = [];
  const improvements: string[] = [];

  for (const d of CASE_DIMENSIONS) {
    if (get(d) >= 4) strengths.push(`${DIM_LABEL[d]}: ${justifyShort(d, true)}`);
  }

  // Specific moment: which stage leaned on hints the most.
  const hintStages = Object.entries(session.hints_used ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (hintStages.length > 0) {
    const [stage, n] = hintStages[0];
    improvements.push(`You leaned on hints most at the ${stage} stage (${n} used) — aim to get there unaided next time.`);
  }

  // Specific moment: did the final recommendation anchor on the numbers + exhibit?
  const rec = [...session.history].reverse().find((t) => t.role === "candidate" && t.stage === "recommendation");
  if (rec) {
    const f = extractFeatures(rec.text);
    if (f.numbers >= 1 && f.dataRefs >= 1) {
      strengths.push("Your final recommendation was anchored on the quant result and the exhibit insight.");
    } else {
      improvements.push("Your final recommendation didn't tie back to the payback/savings math and the key exhibit — lead with the answer, then the numbers.");
    }
  }

  // Specific moment: strong framework that wasn't carried through to synthesis.
  if (get("structure") >= 4 && get("synthesis") <= 2) {
    improvements.push("Your framework was clear early on, but you didn't return to it when synthesizing the recommendation.");
  }

  for (const d of CASE_DIMENSIONS) {
    if (get(d) <= 2) improvements.push(`${DIM_LABEL[d]}: ${justifyShort(d, false)}`);
  }

  const next_focus = CASE_DIMENSIONS.filter((d) => get(d) < 3).map((d) => DIM_LABEL[d]);
  if (next_focus.length === 0) next_focus.push("Tighten the answer-first delivery under pressure.");

  return {
    strengths: dedupe(strengths).slice(0, 5),
    improvements: dedupe(improvements).slice(0, 5),
    next_focus: dedupe(next_focus).slice(0, 4),
  };
}

function justifyShort(d: CaseDimension, positive: boolean): string {
  const pos: Record<CaseDimension, string> = {
    structure: "tailored, MECE structure.",
    hypothesis: "an explicit, tested point of view.",
    quant: "clean, well-narrated math.",
    synthesis: "evidence pulled into a crisp recommendation.",
    communication: "answer-first, executive-ready delivery.",
  };
  const neg: Record<CaseDimension, string> = {
    structure: "structure your approach into clear, non-overlapping buckets before diving in.",
    hypothesis: "state a hypothesis up front and test it as data arrives.",
    quant: "show the calculation steps and talk through the numbers.",
    synthesis: "connect the math and the exhibits into one supported answer.",
    communication: "lead with the answer, then support it concisely.",
  };
  return positive ? pos[d] : neg[d];
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

// --------------------------------------------------------------------------- //
// Real-mode holistic scoring (Haiku) + coercion
// --------------------------------------------------------------------------- //
function transcriptText(history: CaseTurn[]): string {
  return history
    .map((t) => `[${t.stage}] ${t.role === "candidate" ? "Candidate" : "Interviewer"}${t.action ? ` (${t.action})` : ""}: ${t.text}`)
    .join("\n");
}

function rubricText(c: CaseRecord): string {
  return c.scoring_rubric.dimensions
    .map((d) => `- ${d.name} (weight ${d.weight}): ${d.description} [1=${d.anchors["1"]} | 3=${d.anchors["3"]} | 5=${d.anchors["5"]}]`)
    .join("\n");
}

function coerceScore(raw: unknown, c: CaseRecord, session: CaseSessionState): CaseScore {
  const r = raw as Partial<CaseScore> | null;
  const ds = Array.isArray(r?.dimension_scores) ? r!.dimension_scores : [];
  if (ds.length === 0) return aggregateScore(c, session);
  const dimension_scores = c.scoring_rubric.dimensions.map((rd) => {
    const hit = ds.find((x) => String(x?.dimension).toLowerCase().startsWith(rd.name.slice(0, 4)));
    const score = clamp15(Number(hit?.score) || 3);
    return { dimension: rd.name, score, justification: String(hit?.justification ?? "") };
  });
  const totalW = c.scoring_rubric.dimensions.reduce((a, d) => a + d.weight, 0) || 1;
  const overall =
    typeof r?.overall === "number"
      ? round1(r.overall)
      : round1(c.scoring_rubric.dimensions.reduce((a, rd) => a + rd.weight * dimension_scores.find((x) => x.dimension === rd.name)!.score, 0) / totalW);
  return {
    dimension_scores,
    overall,
    strengths: Array.isArray(r?.strengths) ? r!.strengths.map(String) : [],
    improvements: Array.isArray(r?.improvements) ? r!.improvements.map(String) : [],
    next_focus: Array.isArray(r?.next_focus) ? r!.next_focus.map(String) : [],
  };
}

async function claudeScore(c: CaseRecord, session: CaseSessionState): Promise<CaseScore> {
  const system =
    "You are a McKinsey case interviewer writing the final, rubric-anchored evaluation of a case. " +
    "Score strictly against the rubric and the target solution, citing specific moments from the transcript. Return JSON only.";
  const prompt = [
    `Case: ${c.title}`,
    `Target solution: ${c.target_solution_notes ?? ""}`,
    "",
    "Rubric (score each 1-5):",
    rubricText(c),
    "",
    `Probe/hint history: attempts=${JSON.stringify(session.stage_attempts)} hints=${JSON.stringify(session.hints_used)} (needing hints should cap the related dimension).`,
    "",
    "Transcript:",
    transcriptText(session.history),
    "",
    'Return JSON: {"dimension_scores":[{"dimension":"structure|hypothesis|quant|synthesis|communication","score":1-5,"justification":"cites a moment"}],"overall":1-5,"strengths":[],"improvements":[],"next_focus":[]}',
  ].join("\n");

  try {
    const text = await complete(prompt, { system, temperature: 0, maxTokens: 1200 });
    return coerceScore(extractJSON(text), c, session);
  } catch {
    return aggregateScore(c, session);
  }
}

/** Produce the final CaseScore for a completed session. */
export async function scoreCase(c: CaseRecord, session: CaseSessionState): Promise<CaseScore> {
  if (useMocks()) return aggregateScore(c, session);
  return claudeScore(c, session);
}
