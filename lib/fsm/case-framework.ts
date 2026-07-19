import type { CaseRecord, CaseSessionState } from "@/lib/types";

interface FrameworkConcept {
  id: string;
  patterns: RegExp[];
}

interface FrameworkGroupConfig {
  id: string;
  label: string;
  concepts: FrameworkConcept[];
  probe: string;
}

interface FrameworkCaseConfig {
  groups: FrameworkGroupConfig[];
  separationPatterns: RegExp[];
  organizationProbe: string;
  organizationAcknowledgement: string;
  depthProbe: string;
  depthAcknowledgement: string;
}

export interface FrameworkProbeObjective {
  id: string;
  stage: "framework";
  prompt: string;
  acknowledgement: string;
  requiredGroupId: string | null;
  coveredConcepts: string[];
}

export interface CaseFrameworkAssessment {
  configured: boolean;
  accepted: boolean;
  organized: boolean;
  substantive: boolean;
  refinementNeeded: boolean;
  coveredGroupIds: string[];
  coveredGroups: string[];
  coveredConcepts: string[];
  missingGroups: string[];
  nextProbeObjective: FrameworkProbeObjective | null;
}

const CASE_FRAMEWORK_CONFIG: Record<string, FrameworkCaseConfig> = {
  beautify: {
    groups: [
      {
        id: "external",
        label: "external demand, competition, and channel dynamics",
        concepts: [
          { id: "demand", patterns: [/\b(?:customers?|consumers?|shoppers?|demand|adoption|market attractiveness|digital shift|online shift)\b/i] },
          { id: "competition", patterns: [/\b(?:competitors?|competition|competitive|rivals?|alternatives?)\b/i] },
          { id: "channel", patterns: [/\b(?:retailers?|retail partners?|channels?|department stores?|sephora|harrods|direct sales?)\b/i] },
        ],
        probe: "Add a coherent external branch covering demand, competition, or retailer and channel dynamics.",
      },
      {
        id: "internal",
        label: "internal capabilities, customer experience, and brand fit",
        concepts: [
          { id: "brand", patterns: [/\b(?:brand|positioning|reputation|image|prestige)\b/i] },
          { id: "experience", patterns: [/\b(?:customer experience|personalization|trust|service experience|quality of service)\b/i] },
          { id: "technology-data", patterns: [/\b(?:technology|technical|data|digital capability|platform|it capability)\b/i] },
          { id: "people-training", patterns: [/\b(?:consultant|employee|people|talent|training|retrain|skill|capabilit(?:y|ies))\b/i] },
          { id: "operating-model", patterns: [/\b(?:operating model|operations?|implementation|execution|rollout|governance)\b/i] },
        ],
        probe: "Add Beautify's internal feasibility, including brand, customer experience, technology, people, or operating-model considerations.",
      },
      {
        id: "economics",
        label: "financial viability and downside risk",
        concepts: [
          { id: "investment-cost", patterns: [/\b(?:economics?|financial|investment|upfront|costs?|expenses?|spend|recurring)\b/i] },
          { id: "returns", patterns: [/\b(?:revenue|sales|margin|profit|profitability|productivity|return|roi|payback)\b/i] },
          { id: "downside", patterns: [/\b(?:downside|financial risk|cannibali[sz]|sensitivity|scenario)\b/i] },
        ],
        probe: "Add the financial-viability branch: investment, recurring costs, revenue or productivity upside, margins, payback, and downside risk.",
      },
    ],
    separationPatterns: [/\bexternal(?:ly)?\b/i, /\binternal(?:ly)?\b/i],
    organizationProbe: "Separate the external market and channel questions from Beautify's internal feasibility and economics.",
    organizationAcknowledgement: "you already separated the external and internal branches",
    depthProbe: "Develop those branches beyond labels: explain the main external, internal, and financial drivers you would test.",
    depthAcknowledgement: "you already developed the required branches with concrete drivers",
  },
  diconsa: {
    groups: [
      {
        id: "population",
        label: "benefits to the rural population",
        concepts: [
          { id: "access", patterns: [/\b(?:rural|population|recipient|beneficiar|financial inclusion|access|travel|distance|time saved)\b/i] },
          { id: "population-security", patterns: [/\b(?:recipient security|safer access|security for money|cash safety)\b/i] },
        ],
        probe: "Add the value to rural recipients, such as access, time, cost, or security.",
      },
      {
        id: "institutions",
        label: "benefits to government, the bank, and Diconsa",
        concepts: [
          { id: "government-bank", patterns: [/\b(?:government|state|bank|institution|compliance|administrative cost|branch pressure)\b/i] },
          { id: "diconsa", patterns: [/\b(?:diconsa|store traffic|warehouse|outlet|network utilization)\b/i] },
        ],
        probe: "Add the institutional value to government, the bank, or Diconsa.",
      },
      {
        id: "feasibility",
        label: "operational feasibility and risk",
        concepts: [
          { id: "capacity", patterns: [/\b(?:capacity|capabilit(?:y|ies)|feasibility|operations?|staff|training|systems?)\b/i] },
          { id: "risk", patterns: [/\b(?:risk|fraud|theft|crime|security|control|decentrali[sz])\b/i] },
        ],
        probe: "Add operational feasibility and the main capacity, fraud, theft, or control risks.",
      },
    ],
    separationPatterns: [
      /\b(?:population|recipients?|beneficiar(?:y|ies))\b/i,
      /\b(?:government|bank|diconsa|institutions?)\b/i,
      /\b(?:risk|feasibility)\b/i,
    ],
    organizationProbe: "Organize the framework by population benefits, institutional benefits, and feasibility risks.",
    organizationAcknowledgement: "you already organized the stakeholder benefits and feasibility risks",
    depthProbe: "Develop those branches beyond labels: explain the main recipient, institutional, and feasibility drivers you would test.",
    depthAcknowledgement: "you already developed the required stakeholder and feasibility branches",
  },
};

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function organizationScore(text: string, config: FrameworkCaseConfig): number {
  let score = 0;
  if (/\b(?:framework|structure|organize|group|branches?|buckets?|areas?|parts?|pillars?|dimensions?|categories?)\b/i.test(text)) {
    score += 1;
  }
  if (/\b(?:two|three|four|five|\d+)(?:\s+[a-z-]+){0,2}\s+(?:factors?|branches?|buckets?|areas?|parts?|pillars?|dimensions?|categories?)\b/i.test(text)) {
    score += 1;
  }
  const signposts = text.match(/\b(?:first|second|third|fourth|fifth|one|two|three)\b/gi)?.length ?? 0;
  if (signposts >= 2) score += 1;
  const separated = config.separationPatterns.filter((pattern) => pattern.test(text)).length;
  if (separated >= Math.min(2, config.separationPatterns.length)) score += 2;
  const headings = text.match(/(?:^|[\n.;])\s*[a-z][a-z /&-]{1,40}\s*:/gi)?.length ?? 0;
  if (headings >= 2) score += 2;
  const branchSeparators = text.match(/[;\n]/g)?.length ?? 0;
  if (branchSeparators >= 2) score += 1;
  return score;
}

export function assessCaseFramework(
  c: CaseRecord,
  evidence: string,
): CaseFrameworkAssessment {
  const config = CASE_FRAMEWORK_CONFIG[c.id];
  if (!config) {
    return {
      configured: false,
      accepted: false,
      organized: false,
      substantive: false,
      refinementNeeded: false,
      coveredGroupIds: [],
      coveredGroups: [],
      coveredConcepts: [],
      missingGroups: [],
      nextProbeObjective: null,
    };
  }

  const text = evidence.trim();
  const coveredConcepts = config.groups.flatMap((group) =>
    group.concepts
      .filter((concept) => matchesAny(text, concept.patterns))
      .map((concept) => concept.id),
  );
  const covered = config.groups.filter((group) =>
    group.concepts.some((concept) => coveredConcepts.includes(concept.id)),
  );
  const missing = config.groups.filter((group) => !covered.includes(group));
  const organization = organizationScore(text, config);
  const organized = organization >= 2;
  const substantive = coveredConcepts.length >= config.groups.length + 1;
  const accepted = missing.length === 0 && organized && substantive;
  const nextMissing = missing[0];
  const nextProbeObjective = nextMissing
    ? {
        id: `framework:group:${nextMissing.id}`,
        stage: "framework" as const,
        prompt: nextMissing.probe,
        acknowledgement: `you already addressed ${nextMissing.label}`,
        requiredGroupId: nextMissing.id,
        coveredConcepts,
      }
    : !organized
      ? {
          id: "framework:organization",
          stage: "framework" as const,
          prompt: config.organizationProbe,
          acknowledgement: config.organizationAcknowledgement,
          requiredGroupId: null,
          coveredConcepts,
        }
      : !substantive
        ? {
            id: "framework:depth",
            stage: "framework" as const,
            prompt: config.depthProbe,
            acknowledgement: config.depthAcknowledgement,
            requiredGroupId: null,
            coveredConcepts,
          }
        : null;

  return {
    configured: true,
    accepted,
    organized,
    substantive,
    refinementNeeded: accepted && organization < 3,
    coveredGroupIds: covered.map((group) => group.id),
    coveredGroups: covered.map((group) => group.label),
    coveredConcepts,
    missingGroups: missing.map((group) => group.label),
    nextProbeObjective,
  };
}

export function frameworkProbeObjectiveAnswered(
  objective: FrameworkProbeObjective,
  response: CaseFrameworkAssessment,
): boolean {
  if (objective.stage !== "framework" || !response.configured) return false;
  if (objective.requiredGroupId) {
    return response.coveredGroupIds.includes(objective.requiredGroupId);
  }
  if (objective.id === "framework:depth") return response.substantive;
  return response.organized;
}

export function collectCaseFrameworkEvidence(
  session: CaseSessionState,
  answer = "",
): string {
  return [
    ...session.history
      .filter((turn) => turn.role === "candidate" && turn.stage === "framework")
      .map((turn) => turn.text),
    answer,
  ]
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}
