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
  WorkedSolutionCalculationSection,
  WorkedSolutionProseSection,
  WorkedSolutionQuestionSection,
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

/**
 * Clickstream system-design worked architecture.
 *
 * Authored from the case's PUBLIC brief only — the outputs, scale, latency,
 * availability, durability, and consistency inputs the interviewer states aloud
 * to every candidate. No evaluator dimension, rubric anchor, reference-solution
 * note, or private interviewer guidance is reproduced or referenced here.
 */
const CLICKSTREAM_WORKED_SOLUTION: CaseWorkedSolutionView = {
  version: "data-engineer-clickstream-worked-solution-v1",
  caseId: "data_engineer_clickstream",
  caseTitle: "Clickstream Data Pipeline",
  disclaimer: WORKED_SOLUTION_DISCLAIMER,
  framework: {
    heading: "Reference architecture",
    points: [
      "Event producers: Web, iOS, and Android SDKs emit semi-structured JSON. Have each producer stamp an event id, an event timestamp, a session hint, and an SDK/schema version, and buffer locally so a network blip retries rather than drops.",
      "Ingestion: a horizontally partitioned durable log (Kafka, Kinesis, or Pub/Sub) is the single front door. Size partitions for the 500,000 events/sec peak, not the average, and set retention long enough to replay a bad processing deploy.",
      "Schema handling: treat producer JSON as untrusted. Validate against a registry with backward-compatible evolution, let unknown fields pass through into a raw payload column, and route records that fail validation to a dead-letter stream instead of dropping them.",
      "Partitioning: partition the log by a high-cardinality key such as user or device id so one user's events land in order on one partition, which is what makes sessionization tractable. Partition storage by event date (and hour for the hot path) to bound scan cost.",
      "Streaming: a stateful stream processor (Flink, Spark Structured Streaming, or Dataflow) reads the log once and drives both the near-real-time serving path and the durable Bronze landing.",
      "Storage layers: Bronze holds immutable raw events exactly as received; Silver holds validated, deduplicated, sessionized events; Gold holds the curated aggregates the business reports on.",
    ],
  },
  analysisApproach: {
    heading: "Processing, metrics, and latency",
    points: [
      "Sessionization: keyed by user/device on the partitioned stream, using a session window with an inactivity gap (30 minutes is a common default — state the number you pick). Keep session state in the processor's checkpointed store so it survives restarts.",
      "Daily Active Users: DAU is a distinct count, so exact counting at 10 billion events/day is expensive. Serve the dashboard from a sketch (HyperLogLog) for a fast approximate DAU, and compute the exact distinct count in the Gold daily rollup where correctness matters more than latency.",
      "Top ten trending pages: maintain per-page counts in short tumbling or sliding windows, keep only the top-K per window rather than every page, and emit the refreshed top ten roughly every minute.",
      "Latency budget: the sub-60-second end-to-end target is a budget to divide — producer flush, log append, stream processing and windowing, then serving-store write. Keep window sizes and trigger intervals well under a minute so the pipeline is not spending its whole budget waiting to close a window.",
      "Serving: write near-real-time aggregates to a low-latency store (a key-value store or a real-time OLAP engine such as Druid, Pinot, or ClickHouse) and let the dashboard read that, not the lake.",
    ],
  },
  additionalSections: [
    {
      heading: "Reliability, replay, and correctness",
      points: [
      "Availability: the 99.99% target means no single-node dependency. Replicate the log across availability zones, run the processor with checkpointing and automatic restart, and let the serving store degrade to slightly stale data rather than erroring.",
      "No raw-event loss: acknowledge to producers only after a durable, replicated log append, and land Bronze straight from the log. Because Bronze is immutable and the log is retained, every downstream layer can be rebuilt.",
      "Traffic spikes: absorb bursts in the log rather than in the processor. Rely on consumer-lag-based autoscaling and backpressure, and alert on lag rather than on CPU — lag is the metric that predicts a latency-target breach.",
      "Late-arriving events: use event-time processing with watermarks and a bounded allowed-lateness window so mobile events that arrive minutes late still land in the right session. Anything later than the allowance goes to a late-data side output and is folded into the next Gold rebuild.",
      "Replay: keep processing deterministic and reprocessable from the log or from Bronze. A bad deploy is recovered by resetting the consumer offset and rebuilding the affected partitions, never by hand-patching Gold.",
      "Deduplication: mobile retries mean at-least-once delivery is the realistic default. Deduplicate on the producer-assigned event id within a bounded time window in the stream, and again on the same key when writing Silver, so a retry cannot inflate counts.",
      "Dashboard eventual consistency: the near-real-time path is explicitly allowed to be approximate and slightly stale — that is what buys the sub-60-second latency. Label the dashboard with its freshness so approximate numbers are never mistaken for the reported figures.",
        "Exactly-once Gold: get exactly-once effects rather than exactly-once delivery — checkpointed processing plus idempotent writes into a table format that supports atomic commits (Delta, Iceberg, or Hudi), with MERGE keyed on the event or session id. A re-run then converges to the same Gold table instead of double-counting.",
      ],
    },
  ],
  exampleRecommendation: {
    heading: "Example recommendation",
    points: [
      "This is one possible strong recommendation, not the only correct answer.",
      "Run one durable partitioned log as the front door, with a single stateful stream processor feeding both a fast serving store and an immutable Bronze layer.",
      "Split the correctness contract deliberately: approximate, eventually consistent aggregates for the sub-60-second dashboard, and exactly-once, deduplicated Gold tables for reporting.",
      "Make every layer rebuildable from retained raw events, so incident recovery is a replay rather than a manual correction.",
      "Name the trade-off you accepted out loud — usually approximate DAU on the live dashboard in exchange for meeting the latency target — and say how you would operate it: monitor consumer lag, watermark drift, dead-letter volume, and Gold reconciliation.",
    ],
  },
};

/**
 * Per-question worked answers for the fixed-question technical rounds.
 *
 * SEPARATELY AUTHORED from the PUBLIC spoken question text (title, scenario, and
 * prompt — the wording every candidate hears). Nothing here is derived from,
 * serialized from, or keyed to context/technical/*.json grading structures:
 * no target element, rubric dimension, scoring anchor, hint ladder, acceptable
 * alternative, or red flag is reproduced.
 */
const DATA_ANALYST_ROUND_WORKED_SOLUTION: CaseWorkedSolutionView = {
  version: "data-analyst-technical-round-worked-solution-v1",
  caseId: "data_analyst_technical_round",
  caseTitle: "Data Analyst Technical Round",
  disclaimer: WORKED_SOLUTION_DISCLAIMER,
  framework: {
    heading: "How to approach this round",
    points: [
      "State the grain first — what one row means — before writing any aggregation. Most errors in these questions are grain errors.",
      "Separate the metric definition from the query that computes it; agree the definition, then implement it.",
      "Say which rows you exclude and why (cancellations, bots, test accounts) rather than filtering silently.",
      "Finish every answer with a validation step: a number you would reconcile against, or a check that would catch you being wrong.",
    ],
  },
  analysisApproach: {
    heading: "What strong answers had in common",
    points: [
      "They made assumptions explicit instead of guessing what the asker meant.",
      "They distinguished a real change in behaviour from a change in measurement.",
      "They quantified uncertainty rather than reporting a point estimate as fact.",
      "They gave a recommendation with a stated confidence level and a next step.",
    ],
  },
  questions: [
    {
      questionId: "da_monthly_revenue_sql",
      title: "Monthly Revenue Query",
      points: [
        "Grain: one row per month, per region. Aggregate orders up to that grain rather than joining first and hoping the counts survive.",
        "Filter canceled orders in the WHERE clause (or an equivalent status filter) before aggregating, so they affect neither revenue nor customer counts.",
        "Join orders to customers on customer id to get region. Because a customer can order several times a month, SUM(amount) is correct for revenue but COUNT(*) is not correct for customers — use COUNT(DISTINCT customer_id).",
        "Avoid double counting by keeping the join one-to-many in the right direction: one customer row to many order rows. If the customers table can hold duplicates, deduplicate it first or the revenue itself will be inflated by the join.",
        "Group by month (truncate order date to month) and region.",
        "Validate by reconciling total revenue against the unfiltered order total minus the canceled total, and sanity-check that distinct customers is never greater than order count in any cell.",
      ],
    },
    {
      questionId: "da_conversion_metric",
      title: "Conversion Rate Definition",
      points: [
        "Grain: one row per week — and be explicit that it is weekly, since the disagreement usually comes from two teams using different grains.",
        "Denominator: unique visitors in the week, not visits, so a user who returns several times is counted once.",
        "Numerator: unique visitors from that denominator who purchased within the attribution window. The numerator must be a subset of the denominator or the rate can exceed 100%.",
        "Attribution window: seven days from first visit. State it explicitly, and note the consequence — the most recent week is incomplete until its window closes, so it must be labelled provisional rather than compared as final.",
        "Exclusions: filter known bots and internal or test accounts in both numerator and denominator, applying the same filter to each.",
        "Validation: recompute for a past week where the window has fully closed and confirm the number is stable; separately confirm numerator ≤ denominator for every week.",
      ],
    },
    {
      questionId: "da_sales_dashboard",
      title: "Weekly Sales Dashboard",
      points: [
        "First page, top row: a small number of headline tiles — revenue to date, target, and variance to target as both an absolute number and a percentage.",
        "Below that: a time series of revenue versus target by week, so trend and gap are visible at a glance.",
        "Then: a ranked bar chart of regions (and a second by product) sorted by variance to target, so the regions that are behind sort to the top instead of having to be hunted for.",
        "Chart types: bars for comparison across categories, lines for change over time. Avoid pie charts for more than a couple of slices, and avoid dual axes, which invite false correlation.",
        "Filters for region and product applied globally to the page, with the current filter state shown in the title so a screenshot is never ambiguous.",
        "Avoiding misleading readers: start bar axes at zero, label the reporting period and refresh time, show incomplete current weeks distinctly (or exclude them), and keep one consistent definition of revenue across every tile.",
      ],
    },
    {
      questionId: "da_active_users_drop",
      title: "Regional Active-User Drop",
      points: [
        "Frame the question as measurement-versus-behaviour, and pick checks that discriminate between the two rather than checks that merely re-describe the drop.",
        "Confirm the drop is real in the raw event data, not only in the aggregated dashboard — an aggregation or join change can manufacture a drop on its own.",
        "Segment by app version and platform. If the decline sits entirely in the versions carrying the new tracking release, that points hard at measurement; if it spans versions evenly, that points at behaviour.",
        "Compare event volume per user against user counts. Users steady with events collapsing looks like broken instrumentation; both falling together looks like real usage decline.",
        "Check the tracking release itself: deployment timing against the exact hour the drop starts, and whether event names, required fields, or user identifiers changed in that version.",
        "Rule out mundane data-pipeline causes — late or partial data for that region, a time-zone or partition boundary issue, a failed job for one region only.",
        "Cross-check an independent source that does not flow through the new tracking, such as server-side logs, sessions, or revenue for that region.",
        "Report the conclusion with a confidence level and state what would confirm it, rather than declaring a cause you have not isolated.",
      ],
    },
    {
      questionId: "da_checkout_ab_test",
      title: "Checkout Experiment Result",
      points: [
        "Check statistical significance and the confidence interval, not the point estimate alone. With a small sample, a 3% lift can easily be consistent with no effect at all.",
        "Establish whether the test reached its planned sample size and duration. Stopping early at a favourable moment inflates false positives.",
        "Investigate the mobile imbalance — with randomization working, groups should be comparable. An imbalance suggests a randomization or assignment bug, or a sample-ratio mismatch, and it confounds the result because mobile users convert differently.",
        "Segment by device to see whether the lift persists within mobile and within desktop, or only appears in the pooled number because of mix.",
        "Check the checkout-error guardrail. A conversion lift alongside a worsening error rate is not a win, and the guardrail should be able to block the rollout on its own.",
        "Validate the instrumentation: confirm both groups are measured identically and that the change did not alter how conversions are logged.",
        "If the evidence is inconclusive, say so plainly: report the observed lift with its interval, state that it is not yet distinguishable from no effect, note the imbalance and guardrail status, and recommend continuing to the planned sample or re-running with fixed assignment — rather than rolling out or declaring failure.",
      ],
    },
  ],
  exampleRecommendation: {
    heading: "If you want to go deeper",
    points: [
      "Practise stating grain, filters, and validation out loud before writing SQL — interviewers score the reasoning, not the syntax.",
      "Rehearse the measurement-versus-behaviour split; it recurs across diagnostics, metric disputes, and experiment reviews.",
      "Get comfortable saying 'the evidence is not conclusive yet, and here is what would make it conclusive'. That is a stronger answer than a confident wrong call.",
    ],
  },
};

const DATA_ENGINEER_ROUND_WORKED_SOLUTION: CaseWorkedSolutionView = {
  version: "data-engineer-technical-round-worked-solution-v1",
  caseId: "data_engineer_technical_round",
  caseTitle: "Data Engineer Technical Round",
  disclaimer: WORKED_SOLUTION_DISCLAIMER,
  framework: {
    heading: "How to approach this round",
    points: [
      "State the grain of every table before naming it — what exactly one row represents.",
      "Assume jobs will be retried and sources will misbehave; design for idempotency from the start rather than adding it afterwards.",
      "Preserve raw inputs. Almost every recovery answer in this round depends on still having the original data.",
      "When something is broken in production, prefer a safe, reversible action over a fast one.",
    ],
  },
  analysisApproach: {
    heading: "What strong answers had in common",
    points: [
      "They separated what is safe to change from what is breaking for consumers.",
      "They diagnosed with evidence — profiles, counts, logs — before proposing a fix.",
      "They protected correctness while the fix was in progress, rather than after.",
      "They named the trade-off they accepted instead of implying the design was free.",
    ],
  },
  questions: [
    {
      questionId: "de_sales_dimensional_model",
      title: "Simple Sales Data Model",
      points: [
        "Grain: one row per product per order line (or per product per day if line-level drill-down is genuinely not needed — either is defensible, but say which you chose and why).",
        "Fact table: sales facts holding the foreign keys plus the additive measures, sales amount and quantity. Keep measures of different grains out of the same table.",
        "Dimensions: a product dimension and a region/store dimension, plus a date dimension so the daily report joins cleanly.",
        "Preserving category history: keep versioned product rows with a valid-from and valid-to (and a current flag), and have the fact store the product key that was current at sale time. Last month's sales then keep last month's category automatically, because they point at that version of the product row.",
        "The simpler alternative — overwriting the category on the product row — is what breaks the requirement, since it silently rewrites history for every past report.",
        "Keeping the model analyst-friendly means a narrow fact with clearly named measures and few joins, not a normalized schema that requires five joins to answer the headline question.",
      ],
    },
    {
      questionId: "de_multisource_pipeline",
      title: "Daily Multi-Source Pipeline",
      points: [
        "Shape: extract both sources to a raw landing zone partitioned by business date, transform into a conformed model, then publish the dashboard table. Daily refresh means simple batch is the right tool — do not reach for streaming.",
        "Database source: incremental extract on an updated-at watermark where possible, falling back to a full snapshot if the table is small.",
        "CSV source: land the file as-is under its business date, and validate schema and row count before it is allowed to feed anything downstream.",
        "Late file: make the run date-driven rather than clock-driven. If the partner file for a date is missing, either hold the publish for that date or publish with the source clearly marked incomplete, then re-run that date when the file lands and let it overwrite its own partition.",
        "Retry without duplication: make every write idempotent. Load into a date partition and replace that partition wholesale, or MERGE on a stable business key — never blind INSERT, which is what turns a retry into duplicate rows.",
        "Add a freshness and row-count check between load and publish so a partial file fails the run instead of quietly halving the dashboard.",
      ],
    },
    {
      questionId: "de_revenue_drop_incident",
      title: "Revenue Drop Check",
      points: [
        "First: check whether the data actually changed or the query did. Compare row counts and revenue by partition against the prior days to see whether volume dropped or values did.",
        "Second: check source completeness. A job can succeed while its input was partial — verify the upstream extract landed all expected files, partitions, and rows for the period.",
        "Third: check for recent changes to the pipeline, the model, or the dashboard definition. A deploy, a schema change, or a filter edit explains a clean 30% far more often than a real business event.",
        "'Job succeeded' proves the job ran, not that the data is right — say this explicitly, because it is the trap in the question.",
        "Safe restoration: do not rerun or overwrite blindly while executives are on the dashboard. Communicate that the figure is under investigation and mark it provisional first.",
        "Then restore deliberately: reprocess the affected partitions from retained raw data into a staging copy, reconcile it against a known-good day, and only publish once it reconciles — or roll the published table back to the last good version if the table format supports it.",
      ],
    },
    {
      questionId: "de_pipeline_runtime_regression",
      title: "Pipeline Slowdown",
      points: [
        "Start with the execution profile, not with guesses. Find which stage consumes the runtime — a 6x regression is almost always concentrated in one or two stages, not spread evenly.",
        "Look for data skew: a few tasks running far longer than the rest points at a hot key in a join or aggregation.",
        "Look for the volume of data actually scanned. If the job reads far more than it needs, the problem is scan volume rather than compute.",
        "Check whether a join changed shape as volume grew — most commonly a broadcast join that no longer fits in memory and has silently become a shuffle, or a shuffle now spilling to disk.",
        "Likely fix one, skew: salt the hot key, or repartition on a better distribution key so work spreads across tasks.",
        "Likely fix two, scan volume: partition and prune on the filter column, push filters and column pruning down so only the needed data is read, and switch to incremental processing of new partitions rather than reprocessing all history daily.",
        "Both fixes reduce runtime and compute cost together, and neither changes the output — which is the constraint the question sets. Verify by reconciling the output against the pre-fix result before shipping.",
      ],
    },
    {
      questionId: "de_schema_drift",
      title: "Unexpected Schema Change",
      points: [
        "The added nullable field is the safe, backward-compatible change: existing consumers ignore it, and nothing breaks.",
        "The customer_id type change from integer to string is the breaking change, because two downstream models still expect an integer and some new IDs contain letters.",
        "Do not cast the new IDs back to integer. That is the trap — alphanumeric IDs would fail or silently become null, which loses records.",
        "Keep ingesting: land raw source records unchanged so nothing is lost while the migration is in progress. Durability of the raw layer is what makes the rest of the plan recoverable.",
        "Migration plan: widen the identifier to string in the conformed model, add it alongside the existing column so both are available, and notify the two downstream owners with a deadline.",
        "Move consumers to the string identifier one at a time, backfill or reprocess the records that already landed during the change window, then retire the integer column once no consumer reads it.",
        "If a consumer genuinely cannot move in time, pause that consumer's publication rather than corrupting its data — but keep raw ingestion running throughout.",
      ],
    },
  ],
  exampleRecommendation: {
    heading: "If you want to go deeper",
    points: [
      "Practise saying the grain out loud first; it makes modelling and debugging answers much sharper.",
      "Rehearse idempotency — partition replacement and MERGE on a business key — until it is your default answer to any retry question.",
      "For incident questions, lead with 'what would I check' and 'what is safe to do', not with the fix. That ordering is what distinguishes a production engineer.",
    ],
  },
};

/** Closed registry of candidate-facing worked solutions, keyed by case id. */
const CASE_WORKED_SOLUTIONS: Readonly<Record<string, CaseWorkedSolutionView>> = {
  airport_profitability: AIRPORT_WORKED_SOLUTION,
  gcc_premium_gym_market_entry: GYM_WORKED_SOLUTION,
  data_engineer_clickstream: CLICKSTREAM_WORKED_SOLUTION,
  data_analyst_technical_round: DATA_ANALYST_ROUND_WORKED_SOLUTION,
  data_engineer_technical_round: DATA_ENGINEER_ROUND_WORKED_SOLUTION,
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
    // Optional sections are emitted only when the case authored them, so a case
    // with no arithmetic never ships an empty calculation block.
    ...(solution.calculations ? { calculations: projectCalc(solution.calculations) } : {}),
    ...(solution.pressureTest ? { pressureTest: projectCalc(solution.pressureTest) } : {}),
    ...(solution.additionalSections
      ? { additionalSections: solution.additionalSections.map(projectProse) }
      : {}),
    exampleRecommendation: projectProse(solution.exampleRecommendation),
    ...(solution.questions ? { questions: solution.questions.map(projectQuestion) } : {}),
  };
}

function projectQuestion(section: WorkedSolutionQuestionSection) {
  return {
    questionId: section.questionId,
    title: section.title,
    points: [...section.points],
  };
}

function projectProse(section: WorkedSolutionProseSection) {
  return { heading: section.heading, points: [...section.points] };
}

function projectCalc(section: WorkedSolutionCalculationSection) {
  return {
    heading: section.heading,
    steps: section.steps.map((step) => ({
      label: step.label,
      expression: step.expression,
      result: step.result,
    })),
  };
}
