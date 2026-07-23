/**
 * Server-only registry of candidate-facing worked solutions.
 *
 * SECURITY: this module holds the actual worked-solution prose and numbers. It
 * must NEVER be imported by client code, the Case catalog, Vapi prompts, the
 * interview turn loop, or the normal report polling projection. It is reachable
 * only through the protected solution endpoint after a completed report is
 * authorized. Importing it into a client component would ship every case's
 * solution into the static bundle.
 *
 * The content here is SEPARATELY AUTHORED for candidates. It is not serialized
 * from the internal CaseRecord JSON, so it can never carry `scoring_rubric`,
 * `target_solution_notes`, evaluator prompts, hidden metadata, or any other
 * protected answer-key field. The numbers are re-authored to match the public
 * case parameters.
 */
import type {
  CaseWorkedSolutionView,
} from "@/lib/voice/case-worked-solution-types";
import { WORKED_SOLUTION_DISCLAIMER } from "@/lib/voice/case-worked-solution-types";

const AIRPORT_WORKED_SOLUTION: CaseWorkedSolutionView = {
  version: "airport-worked-solution-v1",
  caseId: "airport_profitability",
  caseTitle: "Airport Profitability",
  disclaimer: WORKED_SOLUTION_DISCLAIMER,
  framework: {
    heading: "Strong framework",
    points: [
      "Revenue opportunity and category economics: size non-aeronautical revenue by category (retail, food and beverage, lounges, parking, advertising) and the gap to the 35% target.",
      "Passenger and customer needs and pain points: understand who travels through the airport, how they spend time, and what currently blocks conversion.",
      "Data and AI use cases: identify where data and AI can lift conversion, spend per passenger, and dwell-time monetisation.",
      "Feasibility and operating model: assess data availability, systems, tenant contracts, and the operating model needed to deliver.",
      "Risks, privacy, tenant participation, and implementation: address passenger data privacy, tenant buy-in, and a phased rollout plan.",
    ],
  },
  analysisApproach: {
    heading: "Analysis approach",
    points: [
      "Passenger segmentation by trip purpose, origin/destination, and dwell time.",
      "Personalization and recommendation of offers based on segment and context.",
      "Targeted offers to raise conversion among high-potential passengers.",
      "Journey and dwell-time optimization to convert waiting time into spend.",
      "Tenant and inventory analytics to align supply with demand.",
      "Loyalty and cross-category promotion to lift repeat and basket size.",
      "Measurement and experimentation to prove uplift before scaling.",
    ],
  },
  calculations: {
    heading: "Step-by-step calculations",
    steps: [
      { label: "International buyers", expression: "60,000 × 40%", result: "24,000" },
      {
        label: "International daily revenue",
        expression: "24,000 × SAR 150",
        result: "SAR 3,600,000",
      },
      { label: "Domestic buyers", expression: "40,000 × 20%", result: "8,000" },
      {
        label: "Domestic daily revenue",
        expression: "8,000 × SAR 80",
        result: "SAR 640,000",
      },
      {
        label: "Total daily retail revenue",
        expression: "SAR 3,600,000 + SAR 640,000",
        result: "SAR 4,240,000",
      },
    ],
  },
  pressureTest: {
    heading: "Pressure-test calculation",
    steps: [
      {
        label: "Additional international buyers",
        expression: "60,000 × 5 percentage points",
        result: "3,000",
      },
      {
        label: "Daily revenue uplift",
        expression: "3,000 × SAR 150",
        result: "SAR 450,000",
      },
    ],
  },
  exampleRecommendation: {
    heading: "Example recommendation",
    points: [
      "This is one possible strong recommendation, not the only correct answer.",
      "Prioritise the highest-value passenger segments and launch personalized, data-driven retail offers to grow conversion and spend per passenger.",
      "Optimise journey and dwell time so waiting converts into food, beverage, and retail spend, supported by tenant and inventory analytics.",
      "Run controlled experiments to prove uplift, protect passenger privacy with clear data governance, and secure tenant participation before scaling.",
      "Sequence the rollout in phases toward the 35% non-aeronautical revenue target within three years, expanding only where measured uplift holds.",
    ],
  },
};

const GYM_WORKED_SOLUTION: CaseWorkedSolutionView = {
  version: "gcc-premium-gym-worked-solution-v1",
  caseId: "gcc_premium_gym_market_entry",
  caseTitle: "GCC Premium Gym Market Entry",
  disclaimer: WORKED_SOLUTION_DISCLAIMER,
  framework: {
    heading: "Strong framework",
    points: [
      "Market attractiveness: size the premium fitness opportunity and growth in Saudi Arabia and the UAE.",
      "Customer segments and willingness to pay: identify premium segments and what they will pay for an integrated offer.",
      "Competition and differentiation: assess incumbents, low-cost threats, and where to differentiate.",
      "Country sequencing: decide whether to enter the UAE or Saudi Arabia first and why.",
      "Entry mode: choose between wholly owned, franchise, joint venture, or acquisition.",
      "Unit economics and rollout feasibility: test whether locations are profitable and how fast they can scale.",
      "Operating and localization risks: address regulation, talent, real estate, and cultural localization.",
    ],
  },
  analysisApproach: {
    heading: "Analysis approach",
    points: [
      "Premium customer segmentation by income, lifestyle, and location.",
      "Low-cost competitive threat and how it constrains premium pricing.",
      "Differentiation through integrated wellness (fitness, recovery, nutrition, community).",
      "Brand and location strategy targeting high-visibility premium catchments.",
      "Acquisition and retention economics for premium members.",
      "UAE versus Saudi scale and complexity in demand, regulation, and real estate.",
      "Ownership, franchise, joint venture, or acquisition trade-offs on speed, control, and capital.",
    ],
  },
  calculations: {
    heading: "Step-by-step calculations",
    steps: [
      {
        label: "Target demographic",
        expression: "3,500,000 × 30%",
        result: "1,050,000",
      },
      { label: "Gym members", expression: "1,050,000 × 15%", result: "157,500" },
      {
        label: "Premium gym members",
        expression: "157,500 × 25%",
        result: "39,375",
      },
      {
        label: "Monthly premium market",
        expression: "39,375 × USD 120",
        result: "USD 4,725,000",
      },
      {
        label: "Annual premium market",
        expression: "USD 4,725,000 × 12",
        result: "USD 56,700,000",
      },
    ],
  },
  pressureTest: {
    heading: "Pressure-test calculation",
    steps: [
      {
        label: "Year-three target revenue",
        expression: "10% × USD 56,700,000",
        result: "USD 5,670,000",
      },
      {
        label: "Annual mature-location revenue",
        expression: "USD 60,000 × 12",
        result: "USD 720,000",
      },
      {
        label: "Required locations",
        expression: "USD 5,670,000 ÷ USD 720,000",
        result: "7.875 → round up to approximately 8 locations",
      },
    ],
  },
  exampleRecommendation: {
    heading: "Example recommendation",
    points: [
      "This is one possible strong recommendation, not the only correct answer.",
      "Enter the UAE first as a lower-complexity beachhead, then extend into Saudi Arabia as the model is proven.",
      "Differentiate on integrated premium wellness to justify pricing above the low-cost threat.",
      "Choose an entry mode that balances speed and control for the chosen market (for example a joint venture or acquisition where local partners de-risk real estate and regulation).",
      "Pace the roughly eight-location rollout against feasibility: establishment cost, occupancy ramp-up, breakeven membership, execution capacity, and location rollout pace.",
    ],
  },
};

/** Closed registry of candidate-facing worked solutions, keyed by case id. */
const CASE_WORKED_SOLUTIONS: Readonly<Record<string, CaseWorkedSolutionView>> = {
  airport_profitability: AIRPORT_WORKED_SOLUTION,
  gcc_premium_gym_market_entry: GYM_WORKED_SOLUTION,
};

/**
 * Resolve the candidate-facing worked solution for a case. Unknown ids fail
 * closed (undefined) so the endpoint returns not-found rather than leaking.
 */
export function getCaseWorkedSolution(
  caseId: string,
): CaseWorkedSolutionView | undefined {
  return Object.prototype.hasOwnProperty.call(CASE_WORKED_SOLUTIONS, caseId)
    ? CASE_WORKED_SOLUTIONS[caseId]
    : undefined;
}

/**
 * Build the strict candidate-facing response projection field-by-field. Even
 * though the registry entries are already candidate-safe, we reconstruct the
 * object explicitly so the endpoint can never accidentally serialize a field
 * added elsewhere. Returns null for unknown cases.
 */
export function candidateWorkedSolutionProjection(
  caseId: string,
): CaseWorkedSolutionView | null {
  const solution = getCaseWorkedSolution(caseId);
  if (!solution) return null;
  return {
    version: solution.version,
    caseId: solution.caseId,
    caseTitle: solution.caseTitle,
    disclaimer: solution.disclaimer,
    framework: projectProse(solution.framework),
    analysisApproach: projectProse(solution.analysisApproach),
    calculations: projectCalc(solution.calculations),
    pressureTest: projectCalc(solution.pressureTest),
    exampleRecommendation: projectProse(solution.exampleRecommendation),
  };
}

function projectProse(section: CaseWorkedSolutionView["framework"]) {
  return { heading: section.heading, points: [...section.points] };
}

function projectCalc(section: CaseWorkedSolutionView["calculations"]) {
  return {
    heading: section.heading,
    steps: section.steps.map((step) => ({
      label: step.label,
      expression: step.expression,
      result: step.result,
    })),
  };
}
