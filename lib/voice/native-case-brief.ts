/**
 * Candidate-facing brief / round overview panels (client-safe).
 *
 * Everything here is material the assistant states aloud to the candidate during
 * the interview: the Clickstream problem, required outputs, scale, service
 * levels, and correctness requirements, plus a plain description of how each
 * technical round is run. No scenario private guidance, target element, rubric,
 * acceptable alternative, answer key, red flag, reference solution, or scoring
 * material appears in this module, and none is reachable from it.
 *
 * PROGRESSIVE DISCLOSURE
 * ----------------------
 * The Clickstream case reveals its constraints in step with the interview rather
 * than all at once, so the candidate is never handed information the interviewer
 * has not yet stated. Each fact declares the progress step at which it becomes
 * visible, and the panel is a PURE FUNCTION of the current step index — it keeps
 * no record of what has already been shown. That is what makes the panel
 * reconstruct correctly after a refresh or recovery: whatever step the existing
 * technical progress state resolves to, the same facts are visible, with no
 * separate reveal state to restore or drift out of sync.
 *
 * Reveal is cumulative: a fact stays visible for every later step.
 *
 * Airport and GCC Gym intentionally resolve to null — the strategy cases show no
 * brief panel.
 */

/** Step index before the interview has reached its first anchored step. */
export const BRIEF_STEP_BEFORE_START = -1;

/**
 * Clickstream reveal tiers, expressed as progress step indices from
 * lib/voice/native-progress.ts:
 *
 *   0  Clarification              problem, sources, required outputs
 *   1  High-level design          scale inputs and raw-event durability
 *   2  Ingestion & schema         (scale stays visible)
 *   3  Scale & stream design      latency and availability targets
 *   4  Reliability & edge cases   consistency and exactly-once requirements
 *   5  Final recommendation       (everything stays visible)
 */
export const CLICKSTREAM_REVEAL = {
  problem: 0,
  scale: 1,
  serviceLevels: 3,
  correctness: 4,
} as const;

/** Always-visible content (used by the round overviews, which gate nothing). */
const ALWAYS = BRIEF_STEP_BEFORE_START;

interface BriefFactSpec {
  text: string;
  /** Lowest progress step index at which this fact is shown. */
  revealAtStep: number;
}

interface BriefSectionSpec {
  heading: string;
  facts: readonly BriefFactSpec[];
}

interface BriefSpec {
  title: string;
  intro: string;
  defaultOpen: boolean;
  sections: readonly BriefSectionSpec[];
}

export interface NativeCaseBriefSection {
  heading: string;
  items: readonly string[];
}

export interface NativeCaseBrief {
  /** Panel heading. */
  title: string;
  /** One-line framing shown above the sections. */
  intro: string;
  sections: readonly NativeCaseBriefSection[];
  /** Persistent panels stay open; overview panels start collapsed. */
  defaultOpen: boolean;
}

function facts(revealAtStep: number, ...texts: string[]): BriefFactSpec[] {
  return texts.map((text) => ({ text, revealAtStep }));
}

const CLICKSTREAM_BRIEF: BriefSpec = {
  title: "Case brief",
  intro:
    "What the interviewer has told you so far. More detail appears as the interview moves on.",
  defaultOpen: true,
  sections: [
    {
      heading: "The problem",
      facts: facts(
        CLICKSTREAM_REVEAL.problem,
        "Process and aggregate user clickstream data in near real-time",
        "Events arrive from Web, iOS, and Android as semi-structured JSON",
      ),
    },
    {
      heading: "Required outputs",
      facts: facts(
        CLICKSTREAM_REVEAL.problem,
        "Sessionization",
        "Daily Active Users",
        "Top 10 trending pages",
        "Approximately one-minute refresh",
      ),
    },
    {
      heading: "Scale",
      facts: facts(
        CLICKSTREAM_REVEAL.scale,
        "100 million DAU",
        "10 billion events per day",
        "500,000 events per second peak",
        "No loss of raw events",
      ),
    },
    {
      heading: "Service levels",
      facts: facts(
        CLICKSTREAM_REVEAL.serviceLevels,
        "Under 60-second end-to-end latency",
        "99.99% availability",
      ),
    },
    {
      heading: "Correctness",
      facts: facts(
        CLICKSTREAM_REVEAL.correctness,
        "Eventual consistency for dashboards",
        "Exactly-once Gold reporting",
        "Avoid double-counting",
      ),
    },
  ],
};

function roundOverview(role: string, topics: readonly string[]): BriefSpec {
  return {
    title: "Round overview",
    intro: `A spoken ${role} round of five short scenario questions.`,
    defaultOpen: false,
    sections: [
      {
        heading: "How this round runs",
        facts: facts(
          ALWAYS,
          "Five questions, asked one at a time in a fixed order",
          "At most one short follow-up per question",
          "Think out loud — there are no trick questions",
          "No scoring or feedback during the call; your report comes afterwards",
        ),
      },
      { heading: "Topics covered", facts: facts(ALWAYS, ...topics) },
    ],
  };
}

const BRIEFS: Readonly<Record<string, BriefSpec>> = {
  data_engineer_clickstream: CLICKSTREAM_BRIEF,
  data_analyst_technical_round: roundOverview("Data Analyst", [
    "SQL analysis",
    "Metric definition",
    "Dashboards",
    "Diagnostics",
    "Experimentation",
  ]),
  data_engineer_technical_round: roundOverview("Data Engineer", [
    "Data modeling",
    "Batch pipelines",
    "Debugging",
    "Performance",
    "Schema evolution",
  ]),
};

/**
 * The brief panel for a case at a given progress step, or null when nothing is
 * visible yet (before the interview starts, the candidate sees only the
 * readiness message) or the case shows no brief at all.
 *
 * `stageIndex` is the live progress step index: -1 before the first anchored
 * step, then 0..n-1. Passing a step index is the whole reveal mechanism — there
 * is no hidden state.
 */
export function nativeCaseBrief(
  caseId: string,
  stageIndex: number = BRIEF_STEP_BEFORE_START,
): NativeCaseBrief | null {
  const spec = BRIEFS[caseId];
  if (!spec) return null;
  const sections: NativeCaseBriefSection[] = [];
  for (const section of spec.sections) {
    const items = section.facts
      .filter((fact) => stageIndex >= fact.revealAtStep)
      .map((fact) => fact.text);
    if (items.length > 0) sections.push({ heading: section.heading, items });
  }
  if (sections.length === 0) return null;
  return {
    title: spec.title,
    intro: spec.intro,
    sections,
    defaultOpen: spec.defaultOpen,
  };
}

const DEFAULT_READINESS =
  "Waiting to begin — the interviewer will start once you confirm you're ready.";

const READINESS_MESSAGE: Readonly<Record<string, string>> = {
  data_engineer_clickstream:
    "Waiting to begin — say you're ready and the interviewer will present the case.",
  data_analyst_technical_round:
    "Waiting to begin — say “ready” and the first question will start.",
  data_engineer_technical_round:
    "Waiting to begin — say “ready” and the first question will start.",
};

/** The configured readiness line shown before the first canonical question. */
export function nativeReadinessMessage(caseId: string): string {
  return READINESS_MESSAGE[caseId] ?? DEFAULT_READINESS;
}
