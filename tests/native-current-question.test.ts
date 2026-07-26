import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  advanceNativeCurrentQuestion,
  initialNativeCurrentQuestion,
  isAcknowledgementOnly,
  isSubstantiveProbe,
  type NativeCurrentQuestionState,
} from "@/lib/voice/native-current-question";
import { nativeProgressDefinition } from "@/lib/voice/native-progress";
import { nativeCaseBrief, nativeReadinessMessage } from "@/lib/voice/native-case-brief";

const CLICKSTREAM = "data_engineer_clickstream";
const DA_ROUND = "data_analyst_technical_round";
const DE_ROUND = "data_engineer_technical_round";
const AIRPORT = "airport_profitability";

function assistant(
  state: NativeCurrentQuestionState,
  caseId: string,
  text: string,
): NativeCurrentQuestionState {
  return advanceNativeCurrentQuestion(state, caseId, { role: "assistant", text });
}

describe("live Current question — readiness", () => {
  for (const caseId of [CLICKSTREAM, DA_ROUND, DE_ROUND]) {
    it(`${caseId} starts on the configured readiness message`, () => {
      const state = initialNativeCurrentQuestion(caseId);
      expect(state.kind).toBe("readiness");
      expect(state.text).toBe(nativeReadinessMessage(caseId));
      expect(state.stepId).toBeNull();
    });
  }

  it("pre-readiness assistant chatter does not replace the readiness message", () => {
    const initial = initialNativeCurrentQuestion(DA_ROUND);
    const next = assistant(initial, DA_ROUND, "Can you hear me clearly on your end?");
    expect(next).toEqual(initial);
    expect(next.kind).toBe("readiness");
  });
});

describe("live Current question — canonical questions", () => {
  it("Data Analyst shows the complete spoken question for each anchor", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    let state = initialNativeCurrentQuestion(DA_ROUND);
    for (const step of steps) {
      const spoken = `${step.anchor} Here is the scenario, and here is what I'd like you to do.`;
      state = assistant(state, DA_ROUND, spoken);
      expect(state.kind).toBe("question");
      expect(state.stepId).toBe(step.id);
      expect(state.title).toBe(step.label);
      expect(state.text).toBe(spoken);
    }
  });

  it("Data Engineer shows the complete spoken question for each anchor", () => {
    const steps = nativeProgressDefinition(DE_ROUND)!.steps;
    let state = initialNativeCurrentQuestion(DE_ROUND);
    for (const step of steps) {
      state = assistant(state, DE_ROUND, `${step.anchor} Scenario text follows here.`);
      expect(state.stepId).toBe(step.id);
      expect(state.title).toBe(step.label);
    }
  });

  it("Clickstream shows each stage question under its technical label", () => {
    const steps = nativeProgressDefinition(CLICKSTREAM)!.steps;
    let state = initialNativeCurrentQuestion(CLICKSTREAM);
    for (const step of steps) {
      state = assistant(state, CLICKSTREAM, step.anchor);
      expect(state.kind).toBe("question");
      expect(state.stepId).toBe(step.id);
      expect(state.title).toBe(step.label);
    }
    expect(state.title).toBe("Final recommendation");
  });

  it("never regresses to an earlier question", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    let state = assistant(initialNativeCurrentQuestion(DA_ROUND), DA_ROUND, steps[0].anchor);
    state = assistant(state, DA_ROUND, steps[2].anchor);
    expect(state.stepId).toBe(steps[2].id);
  });

  it("candidate speech is never displayed, even when it repeats an anchor", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    const initial = initialNativeCurrentQuestion(DA_ROUND);
    const next = advanceNativeCurrentQuestion(initial, DA_ROUND, {
      role: "user",
      text: `${steps[0].anchor} and here is my answer.`,
    });
    expect(next).toEqual(initial);
  });
});

describe("live Current question — probes and acknowledgements", () => {
  const steps = nativeProgressDefinition(DE_ROUND)!.steps;
  const afterQuestionOne = assistant(
    initialNativeCurrentQuestion(DE_ROUND),
    DE_ROUND,
    `${steps[0].anchor} Scenario text.`,
  );

  it("shows a substantive follow-up probe and keeps the step attribution", () => {
    const probe = assistant(
      afterQuestionOne,
      DE_ROUND,
      "What exactly does one row in the sales fact represent?",
    );
    expect(probe.kind).toBe("probe");
    expect(probe.text).toBe("What exactly does one row in the sales fact represent?");
    expect(probe.stepId).toBe(steps[0].id);
    expect(probe.title).toBe(steps[0].label);
  });

  it("recognizes an unpunctuated imperative ask as a probe", () => {
    const probe = assistant(
      afterQuestionOne,
      DE_ROUND,
      "Walk me through how last month's sales keep last month's category",
    );
    expect(probe.kind).toBe("probe");
  });

  for (const ack of [
    "Thank you.",
    "Take your time.",
    "That's okay.",
    "Okay.",
    "Got it.",
    "Great.",
    "Let's move on.",
  ]) {
    it(`the acknowledgement "${ack}" does not erase the active question`, () => {
      const next = assistant(afterQuestionOne, DE_ROUND, ack);
      expect(next).toEqual(afterQuestionOne);
      expect(next.kind).toBe("question");
      expect(isAcknowledgementOnly(ack)).toBe(true);
    });
  }

  it("an acknowledgement that also carries a real question is shown as a probe", () => {
    const text = "Thank you. How would you handle late-arriving events here?";
    expect(isSubstantiveProbe(text)).toBe(true);
    expect(assistant(afterQuestionOne, DE_ROUND, text).kind).toBe("probe");
  });

  it("a new assistant turn with no substantive question retains the last question", () => {
    const filler = assistant(afterQuestionOne, DE_ROUND, "Mm hmm.");
    expect(filler).toEqual(afterQuestionOne);
  });

  it("closing small talk does not erase the last question", () => {
    const closing = assistant(afterQuestionOne, DE_ROUND, "That concludes our interview today.");
    expect(closing).toEqual(afterQuestionOne);
  });
});

describe("live Current question — private-content exclusion", () => {
  const PRIVATE_VOCABULARY = [
    "Target elements",
    "Acceptable alternatives",
    "Red flags",
    "Private interviewer guidance",
    "strong_answer_outline",
    "rubric",
    "System prompt",
    "assistantId",
    "max_tokens",
  ];

  it("the reducer module references no private evaluation vocabulary", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/voice/native-current-question.ts"),
      "utf8",
    );
    for (const term of ["Target elements", "Acceptable alternatives", "red_flags", "strong_answer_outline"]) {
      expect(src.includes(term)).toBe(false);
    }
  });

  it("imports no server-only question-bank or model module", () => {
    for (const rel of [
      "lib/voice/native-current-question.ts",
      "lib/voice/native-progress.ts",
      "lib/voice/native-case-brief.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src.includes("@/lib/claude")).toBe(false);
      expect(src.includes("@/context/technical/")).toBe(false);
      expect(src.includes("case-question-bank-scorer")).toBe(false);
      expect(src.includes('@/lib/voice/question-bank"')).toBe(false);
      expect(src.includes("@/lib/voice/question-bank'")).toBe(false);
    }
  });

  it("the displayed body is only ever verbatim assistant speech", () => {
    const steps = nativeProgressDefinition(DA_ROUND)!.steps;
    const spoken = `${steps[0].anchor} Write a query for monthly revenue.`;
    const state = assistant(initialNativeCurrentQuestion(DA_ROUND), DA_ROUND, spoken);
    // Nothing is synthesized: the panel body equals the spoken turn exactly.
    expect(state.text).toBe(spoken);
  });

  it("no brief or readiness string leaks private vocabulary", () => {
    for (const caseId of [CLICKSTREAM, DA_ROUND, DE_ROUND]) {
      const serialized = JSON.stringify([
        nativeCaseBrief(caseId, 5),
        nativeReadinessMessage(caseId),
      ]);
      for (const term of PRIVATE_VOCABULARY) {
        expect(serialized.includes(term)).toBe(false);
      }
    }
  });
});

describe("Clickstream case brief panel", () => {
  // Progressive reveal itself is covered in tests/clickstream-progressive-reveal.test.ts.
  it("shows nothing before the interview starts", () => {
    expect(nativeCaseBrief(CLICKSTREAM)).toBeNull();
  });

  it("is persistent and shows the problem and outputs once clarification begins", () => {
    const brief = nativeCaseBrief(CLICKSTREAM, 0)!;
    expect(brief.defaultOpen).toBe(true);
    const items = brief.sections.flatMap((section) => section.items);
    expect(items).toContain("Sessionization");
    expect(items).toContain("Daily Active Users");
    expect(items).toContain("Top 10 trending pages");
    expect(items).toContain("Approximately one-minute refresh");
  });

  it("shows every stated constraint by the final stage", () => {
    const items = nativeCaseBrief(CLICKSTREAM, 5)!.sections.flatMap((s) => s.items);
    for (const fact of [
      "100 million DAU",
      "10 billion events per day",
      "500,000 events per second peak",
      "No loss of raw events",
      "Under 60-second end-to-end latency",
      "99.99% availability",
      "Eventual consistency for dashboards",
      "Exactly-once Gold reporting",
      "Avoid double-counting",
    ]) {
      expect(items).toContain(fact);
    }
  });

  it("is not shown for Airport or GCC Gym", () => {
    expect(nativeCaseBrief(AIRPORT)).toBeNull();
    expect(nativeCaseBrief("gcc_premium_gym_market_entry")).toBeNull();
  });

  it("the two rounds show a collapsed overview with no grading content", () => {
    for (const caseId of [DA_ROUND, DE_ROUND]) {
      const brief = nativeCaseBrief(caseId, 0)!;
      expect(brief.defaultOpen).toBe(false);
      expect(brief.title).toBe("Round overview");
    }
  });
});
