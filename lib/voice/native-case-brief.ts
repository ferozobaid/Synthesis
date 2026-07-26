/**
 * Candidate-facing brief / round overview panels (client-safe).
 *
 * Everything here is material the assistant states aloud to the candidate during
 * the interview: the Clickstream required outputs and its scale and constraint
 * inputs, and a plain description of how each technical round is run. No
 * scenario private guidance, target element, rubric, acceptable alternative,
 * answer key, red flag, reference solution, or scoring material appears in this
 * module, and none is reachable from it.
 *
 * Airport and GCC Gym intentionally resolve to null — the strategy cases show no
 * brief panel.
 */

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

const CLICKSTREAM_BRIEF: NativeCaseBrief = {
  title: "Case brief",
  intro:
    "The interviewer states these upfront. They stay on screen so you can design against them.",
  defaultOpen: true,
  sections: [
    {
      heading: "Required outputs",
      items: [
        "Sessionization",
        "Daily Active Users",
        "Top 10 trending pages",
        "Approximately one-minute refresh",
      ],
    },
    {
      heading: "Scale and constraints",
      items: [
        "100 million DAU",
        "10 billion events per day",
        "500,000 events per second peak",
        "Under 60-second end-to-end latency",
        "99.99% availability",
        "No loss of raw events",
        "Eventual consistency for dashboards",
        "Exactly-once Gold reporting",
      ],
    },
  ],
};

function roundOverview(role: string, topics: readonly string[]): NativeCaseBrief {
  return {
    title: "Round overview",
    intro: `A spoken ${role} round of five short scenario questions.`,
    defaultOpen: false,
    sections: [
      {
        heading: "How this round runs",
        items: [
          "Five questions, asked one at a time in a fixed order",
          "At most one short follow-up per question",
          "Think out loud — there are no trick questions",
          "No scoring or feedback during the call; your report comes afterwards",
        ],
      },
      { heading: "Topics covered", items: topics },
    ],
  };
}

const BRIEFS: Readonly<Record<string, NativeCaseBrief>> = {
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

/** The brief panel for a case, or null when the case shows no brief. */
export function nativeCaseBrief(caseId: string): NativeCaseBrief | null {
  return BRIEFS[caseId] ?? null;
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
