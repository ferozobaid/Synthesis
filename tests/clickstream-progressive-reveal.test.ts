import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRIEF_STEP_BEFORE_START,
  CLICKSTREAM_REVEAL,
  nativeCaseBrief,
} from "@/lib/voice/native-case-brief";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import {
  advanceNativeCaseLiveProgress,
  initialNativeCaseLiveProgress,
  type NativeCaseLiveProgress,
} from "@/lib/voice/case-native-live";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const AIRPORT = "airport_profitability";

const STEPS = nativeProgressDefinition(CLICKSTREAM)!.steps;

/** Every fact string visible at a given progress step. */
function visibleFacts(stageIndex: number): string[] {
  const brief = nativeCaseBrief(CLICKSTREAM, stageIndex);
  return brief ? brief.sections.flatMap((section) => [...section.items]) : [];
}

const PROBLEM_FACTS = [
  "Process and aggregate user clickstream data in near real-time",
  "Events arrive from Web, iOS, and Android as semi-structured JSON",
  "Sessionization",
  "Daily Active Users",
  "Top 10 trending pages",
  "Approximately one-minute refresh",
];
const SCALE_FACTS = [
  "100 million DAU",
  "10 billion events per day",
  "500,000 events per second peak",
  "No loss of raw events",
];
const SERVICE_LEVEL_FACTS = ["Under 60-second end-to-end latency", "99.99% availability"];
const CORRECTNESS_FACTS = [
  "Eventual consistency for dashboards",
  "Exactly-once Gold reporting",
  "Avoid double-counting",
];

describe("before readiness", () => {
  it("shows no brief at all — only the readiness message is on screen", () => {
    expect(nativeCaseBrief(CLICKSTREAM, BRIEF_STEP_BEFORE_START)).toBeNull();
    expect(nativeCaseBrief(CLICKSTREAM)).toBeNull();
  });

  it("hides every constraint before the interview starts", () => {
    expect(visibleFacts(BRIEF_STEP_BEFORE_START)).toEqual([]);
  });
});

describe("stage 0 — Clarification", () => {
  const shown = visibleFacts(0);

  it("reveals the problem, the sources, and the required outputs", () => {
    for (const fact of PROBLEM_FACTS) expect(shown).toContain(fact);
  });

  it("hides scale, service levels, and correctness", () => {
    for (const fact of [...SCALE_FACTS, ...SERVICE_LEVEL_FACTS, ...CORRECTNESS_FACTS]) {
      expect(shown).not.toContain(fact);
    }
  });
});

describe("stages 1–2 — High-level design and Ingestion & schema", () => {
  it("reveals the scale inputs at High-level design", () => {
    const shown = visibleFacts(1);
    for (const fact of SCALE_FACTS) expect(shown).toContain(fact);
  });

  it("keeps the scale inputs visible through Ingestion & schema", () => {
    const shown = visibleFacts(2);
    for (const fact of SCALE_FACTS) expect(shown).toContain(fact);
  });

  it("still hides service levels and correctness at both steps", () => {
    for (const stageIndex of [1, 2]) {
      const shown = visibleFacts(stageIndex);
      for (const fact of [...SERVICE_LEVEL_FACTS, ...CORRECTNESS_FACTS]) {
        expect(shown).not.toContain(fact);
      }
    }
  });
});

describe("stage 3 — Scale & stream design", () => {
  const shown = visibleFacts(3);

  it("reveals the latency and availability targets", () => {
    for (const fact of SERVICE_LEVEL_FACTS) expect(shown).toContain(fact);
  });

  it("still hides the correctness requirements", () => {
    for (const fact of CORRECTNESS_FACTS) expect(shown).not.toContain(fact);
  });
});

describe("stage 4 — Reliability & edge cases", () => {
  const shown = visibleFacts(4);

  it("reveals eventual consistency, exactly-once Gold, and double-counting", () => {
    for (const fact of CORRECTNESS_FACTS) expect(shown).toContain(fact);
  });
});

describe("cumulative disclosure", () => {
  it("every previously revealed fact stays visible at every later step", () => {
    for (let stageIndex = 0; stageIndex < STEPS.length; stageIndex += 1) {
      const previous = visibleFacts(stageIndex - 1);
      const current = visibleFacts(stageIndex);
      for (const fact of previous) expect(current).toContain(fact);
      expect(current.length).toBeGreaterThanOrEqual(previous.length);
    }
  });

  it("the final step shows the complete set of facts exactly once each", () => {
    const shown = visibleFacts(STEPS.length - 1);
    const expected = [
      ...PROBLEM_FACTS,
      ...SCALE_FACTS,
      ...SERVICE_LEVEL_FACTS,
      ...CORRECTNESS_FACTS,
    ];
    expect([...shown].sort()).toEqual([...expected].sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("reveal thresholds match the required stage mapping", () => {
    expect(CLICKSTREAM_REVEAL).toEqual({
      problem: 0,
      scale: 1,
      serviceLevels: 3,
      correctness: 4,
    });
  });
});

describe("reconstruction after refresh or recovery", () => {
  function walkTo(stageIndex: number): NativeCaseLiveProgress {
    let progress = initialNativeCaseLiveProgress();
    for (let index = 0; index <= stageIndex; index += 1) {
      progress = advanceNativeCaseLiveProgress(
        progress,
        CLICKSTREAM,
        { role: "assistant", text: STEPS[index].anchor },
        1_000 + index,
      );
    }
    return progress;
  }

  it("is a pure function of the progress step — same step, same panel", () => {
    for (let stageIndex = -1; stageIndex < STEPS.length; stageIndex += 1) {
      expect(nativeCaseBrief(CLICKSTREAM, stageIndex)).toEqual(
        nativeCaseBrief(CLICKSTREAM, stageIndex),
      );
    }
  });

  it("a recovered progress state reproduces the same facts as a direct index", () => {
    for (let stageIndex = 0; stageIndex < STEPS.length; stageIndex += 1) {
      const recovered = walkTo(stageIndex);
      expect(recovered.stageIndex).toBe(stageIndex);
      expect(nativeCaseBrief(CLICKSTREAM, recovered.stageIndex)).toEqual(
        nativeCaseBrief(CLICKSTREAM, stageIndex),
      );
    }
  });

  it("replaying the whole transcript in one go lands on the full brief", () => {
    // Simulates recovery where all finalized assistant text arrives at once.
    let progress = initialNativeCaseLiveProgress();
    progress = advanceNativeCaseLiveProgress(
      progress,
      CLICKSTREAM,
      { role: "assistant", text: STEPS.map((step) => step.anchor).join(" ") },
      2_000,
    );
    expect(progress.stageIndex).toBe(STEPS.length - 1);
    expect(visibleFacts(progress.stageIndex)).toHaveLength(
      PROBLEM_FACTS.length + SCALE_FACTS.length + SERVICE_LEVEL_FACTS.length + CORRECTNESS_FACTS.length,
    );
  });
});

describe("other cases are unaffected", () => {
  it("the technical rounds show their overview from the start and gate nothing", () => {
    const early = nativeCaseBrief(DA_ROUND, BRIEF_STEP_BEFORE_START);
    const late = nativeCaseBrief(DA_ROUND, 4);
    expect(early).not.toBeNull();
    expect(early).toEqual(late);
  });

  it("Airport and GCC Gym still show no brief at any step", () => {
    for (let stageIndex = -1; stageIndex < 6; stageIndex += 1) {
      expect(nativeCaseBrief(AIRPORT, stageIndex)).toBeNull();
      expect(nativeCaseBrief("gcc_premium_gym_market_entry", stageIndex)).toBeNull();
    }
  });
});

describe("the prompt fixture follows the same reveal policy", () => {
  const text = readFileSync(
    join(process.cwd(), "context/vapi/data-engineer-clickstream-assistant-v1.md"),
    "utf8",
  );
  const openingBrief = text.slice(
    text.indexOf("## Candidate brief"),
    text.indexOf("### Progressive reveal policy"),
  );

  it("the opening brief states the problem and the required outputs", () => {
    expect(openingBrief).toContain("near real-time");
    expect(openingBrief).toContain("Web, iOS, and Android");
    expect(openingBrief).toContain("sessionization");
    expect(openingBrief).toContain("Daily Active Users");
    expect(openingBrief).toContain("top ten trending pages");
    expect(openingBrief).toContain("approximately every minute");
  });

  it("the opening brief withholds scale, service levels, and correctness", () => {
    for (const fact of [
      "100 million",
      "10 billion",
      "500,000",
      "60 seconds",
      "99.99%",
      "eventually consistent",
      "exactly-once",
    ]) {
      expect(openingBrief.includes(fact)).toBe(false);
    }
  });

  it("declares an explicit progressive reveal policy", () => {
    expect(text).toContain("### Progressive reveal policy");
    expect(text).toContain("Do **not** state a fact before the stage listed for it.");
  });

  it("instructs the scale inputs at High-level design", () => {
    const stage = text.slice(text.indexOf("## Stage 2"), text.indexOf("## Stage 3"));
    expect(stage).toContain("State the scale inputs at this stage");
    for (const fact of ["100 million", "10 billion", "500,000", "raw events cannot be lost"]) {
      expect(stage.includes(fact)).toBe(true);
    }
  });

  it("instructs the service levels at Scale & stream design", () => {
    const stage = text.slice(text.indexOf("## Stage 4"), text.indexOf("## Stage 5"));
    expect(stage).toContain("State the service-level targets at this stage");
    expect(stage).toContain("under 60 seconds");
    expect(stage).toContain("99.99%");
  });

  it("instructs the correctness requirements at Reliability & edge cases", () => {
    const stage = text.slice(text.indexOf("## Stage 5"), text.indexOf("## Stage 6"));
    expect(stage).toContain("State the correctness requirements at this stage");
    expect(stage).toContain("eventually consistent");
    expect(stage).toContain("exactly-once");
    expect(stage).toContain("double-counting");
  });

  it("still answers a figure asked for early rather than stonewalling", () => {
    expect(text).toContain("If the candidate asks for one of these figures **before** its stage, give it");
  });

  it("keeps facts stable once revealed", () => {
    expect(text).toContain("Never contradict or withdraw a fact you have given.");
  });
});
