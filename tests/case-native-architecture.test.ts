import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CASE_VOICE_STAGE_ANCHOR_VERSION,
  resolveCaseVoiceArchitecture,
  resolveNativeCaseAssistant,
  storedCaseVoiceArchitecture,
} from "@/lib/voice/case-native-config";
import {
  CASE_REPORT_STAGES,
  caseStageAnchorManifest,
  isSubstantiveCaseCandidateResponse,
  mapCaseTranscript,
  normalizeCaseStageAnchor,
} from "@/lib/voice/case-transcript";
import { issueReportCapability, verifyReportCapability } from "@/lib/voice/report-capability";
import {
  normalizeVoiceTranscript,
  VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS,
} from "@/lib/voice/transcript";
import { scoreCasePostCall } from "@/lib/voice/case-post-call-scorer";
import { getVoiceLlmCaseRecord } from "@/lib/voice/voice-case-records";
import {
  clearPendingNativeCaseReport,
  fullAuthoritativeCaseScore,
  readPendingNativeCaseReport,
  writePendingNativeCaseReport,
} from "@/components/CaseNativeVoiceInterview";

const AIRPORT = "airport_profitability";
const GYM = "gcc_premium_gym_market_entry";
const airportManifest = readFileSync("context/vapi/airport-profitability-assistant-v1.md", "utf8");
const gymManifest = readFileSync("context/vapi/gcc-premium-gym-assistant-v1.md", "utf8");
const airportNativeTranscript = JSON.parse(
  readFileSync("tests/fixtures/airport-native-redacted-transcript.json", "utf8"),
) as Array<{ role: string; message: string }>;

function occurrenceCount(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function transitionSection(manifest: string): string {
  return manifest
    .split("## Neutral transition patterns")[1]
    ?.split("Use only candidate-safe case facts")[0] ?? "";
}

function neutralNextPhaseSentences(manifest: string): string[] {
  const section = transitionSection(manifest);
  return [...section.matchAll(/neutral next-phase sentence:\s+“([\s\S]*?)”/g)].map((match) =>
    match[1].replace(/\s+/g, " ").trim()
  );
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function fullTranscript(caseId = AIRPORT) {
  const manifest = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
  return normalizeVoiceTranscript(CASE_REPORT_STAGES.flatMap((stage) => [
    { role: "assistant", message: manifest.anchors[stage] },
    { role: "user", message: `My ${stage} answer has a clear hypothesis, because evidence supports it, and I would test the result.` },
  ])).turns;
}

beforeEach(() => {
  process.env.SYNTHESIS_USE_MOCKS = "true";
});

describe("native Case architecture and closed configuration", () => {
  it("resolves missing stored architecture to custom_llm", () => {
    expect(storedCaseVoiceArchitecture({})).toBe("custom_llm");
  });

  it("uses the environment only when resolving a new bootstrap", () => {
    expect(resolveCaseVoiceArchitecture({ CASE_VOICE_ARCHITECTURE: "vapi_native" })).toBe("vapi_native");
    expect(storedCaseVoiceArchitecture({ architecture: "custom_llm" })).toBe("custom_llm");
  });

  it("defaults invalid architecture values to custom_llm", () => {
    expect(resolveCaseVoiceArchitecture({ CASE_VOICE_ARCHITECTURE: "native-ish" })).toBe("custom_llm");
  });

  it("maps Airport only to the server-owned Airport assistant", () => {
    expect(resolveNativeCaseAssistant(AIRPORT, { VAPI_AIRPORT_ASSISTANT_ID: "asst-airport" }))
      .toMatchObject({ assistantId: "asst-airport", assistantConfigVersion: "airport-profitability-assistant-v1" });
  });

  it("maps Gym only to the server-owned Gym assistant", () => {
    expect(resolveNativeCaseAssistant(GYM, { VAPI_GCC_GYM_ASSISTANT_ID: "asst-gym" }))
      .toMatchObject({ assistantId: "asst-gym", assistantConfigVersion: "gcc-premium-gym-assistant-v1" });
  });

  it("rejects unknown cases and unconfigured assistants", () => {
    expect(resolveNativeCaseAssistant("beautify", { VAPI_AIRPORT_ASSISTANT_ID: "x" })).toBeNull();
    expect(resolveNativeCaseAssistant(AIRPORT, {})).toBeNull();
  });
});

describe("module-neutral report capability", () => {
  it("stores a hash distinct from the plaintext token", () => {
    const capability = issueReportCapability();
    expect(capability.token).toHaveLength(64);
    expect(capability.tokenHash).toHaveLength(64);
    expect(capability.tokenHash).not.toBe(capability.token);
  });

  it("verifies with a constant-length digest and rejects the wrong token", () => {
    const capability = issueReportCapability();
    expect(verifyReportCapability(capability.token, capability.tokenHash)).toBe(true);
    expect(verifyReportCapability("wrong", capability.tokenHash)).toBe(false);
  });
});

describe("generic transcript normalization", () => {
  it("retains only assistant and candidate text with stable ordinals", () => {
    const result = normalizeVoiceTranscript([
      { role: "system", message: "secret prompt" },
      { role: "assistant", message: "  Hello   there " },
      { role: "tool", message: "raw payload" },
      { role: "user", transcript: " My answer " },
      { role: "assistant", message: "" },
    ]);
    expect(result.turns).toEqual([
      { role: "assistant", text: "Hello there", ordinal: 0 },
      { role: "candidate", text: "My answer", ordinal: 1 },
    ]);
  });

  it("does not accept summaries or raw webhook fields as a transcript source", () => {
    expect(normalizeVoiceTranscript({ summary: "candidate secret", transcript: "raw" }).turns).toEqual([]);
  });

  it("bounds individual transcript entries", () => {
    const result = normalizeVoiceTranscript([{ role: "user", message: "x".repeat(VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS + 10) }]);
    expect(result.truncated).toBe(true);
    expect(result.turns[0].text).toHaveLength(VOICE_TRANSCRIPT_MAX_MESSAGE_CHARS);
  });
});

describe("canonical stage mapping", () => {
  it("loads a versioned manifest for both assistants", () => {
    expect(caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)?.caseId).toBe(AIRPORT);
    expect(caseStageAnchorManifest(GYM, CASE_VOICE_STAGE_ANCHOR_VERSION)?.caseId).toBe(GYM);
    expect(caseStageAnchorManifest(AIRPORT, "wrong-version")).toBeNull();
  });

  it("maps exact assistant anchors in order", () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, fullTranscript())!;
    expect(mapped.observedStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.partial).toBe(false);
  });

  it("maps the redacted Airport transcript as full despite punctuation and number drift", () => {
    const normalized = normalizeVoiceTranscript(airportNativeTranscript);
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalized.turns,
      { truncated: normalized.truncated },
    )!;
    expect(mapped.observedStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.answeredStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.missingStages).toEqual([]);
    expect(mapped.partialReasons).toEqual([]);
    expect(mapped.partial).toBe(false);
  });

  it("normalizes punctuation drift for Framework and Analysis anchors", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    expect(normalizeCaseStageAnchor("How would you structure your approach to this. Problem?"))
      .toBe(normalizeCaseStageAnchor(manifest.anchors.framework));
    expect(normalizeCaseStageAnchor("Brainstorm. Ways. Data. And AI could increase retail revenue per passenger."))
      .toBe(normalizeCaseStageAnchor("Brainstorm ways data and AI could increase retail revenue per passenger."));
  });

  it("normalizes five/5 and ten/10 percentage anchors deterministically", () => {
    const airport = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const gym = caseStageAnchorManifest(GYM, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    expect(normalizeCaseStageAnchor(airport.anchors.pressure_test.replace("five", "5")))
      .toBe(normalizeCaseStageAnchor(airport.anchors.pressure_test));
    expect(normalizeCaseStageAnchor(gym.anchors.pressure_test.replace("ten", "10")))
      .toBe(normalizeCaseStageAnchor(gym.anchors.pressure_test));
  });

  it("never lets candidate speech advance a stage", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const transcript = normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.clarification },
      { role: "user", message: manifest.anchors.framework },
    ]).turns;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, transcript)!;
    expect(mapped.observedStages).toEqual(["clarification"]);
    expect(mapped.turns.at(-1)?.stage).toBe("clarification");
  });

  it("keeps assistant probes and candidate corrections in the current stage", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const transcript = normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "First answer" },
      { role: "assistant", message: "What else would you include?" },
      { role: "user", message: "I would add economics." },
    ]).turns;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, transcript)!;
    expect(mapped.turns.every((turn) => turn.stage === "framework")).toBe(true);
  });

  it("marks missing stages as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "A structured answer." },
    ]).turns)!;
    expect(mapped.partial).toBe(true);
    expect(mapped.missingStages).toContain("recommendation");
  });

  it("marks a Recommendation anchor followed by immediate hangup as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const messages = CASE_REPORT_STAGES.flatMap((stage) => stage === "recommendation"
      ? [{ role: "assistant", message: manifest.anchors[stage] }]
      : [
          { role: "assistant", message: manifest.anchors[stage] },
          { role: "user", message: `Candidate response for ${stage}.` },
        ]);
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalizeVoiceTranscript(messages).turns,
    )!;
    expect(mapped.observedStages).toContain("recommendation");
    expect(mapped.missingStages).toContain("recommendation");
    expect(mapped.partialReasons).toContain("missing_candidate_response");
    expect(mapped.partial).toBe(true);
  });

  it("marks a required middle stage with no subsequent candidate response as partial", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const messages = CASE_REPORT_STAGES.flatMap((stage) => stage === "analysis"
      ? [{ role: "assistant", message: manifest.anchors[stage] }]
      : [
          { role: "assistant", message: manifest.anchors[stage] },
          { role: "user", message: `Candidate response for ${stage}.` },
        ]);
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalizeVoiceTranscript(messages).turns,
    )!;
    expect(mapped.observedStages).toContain("analysis");
    expect(mapped.missingStages).toContain("analysis");
    expect(mapped.partial).toBe(true);
  });

  it("does not count pauses, readiness, or closing phrases as substantive answers", () => {
    for (const phrase of [
      "Can I have a minute?",
      "Give me one minute.",
      "I'm ready.",
      "I'm ready, but give me another minute.",
      "I'm done.",
      "Thank you.",
      "Okay.",
    ]) {
      expect(isSubstantiveCaseCandidateResponse(phrase)).toBe(false);
    }
  });

  it("counts a substantive answer after a pause without crediting the pause", () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "Can I have a minute?" },
      { role: "assistant", message: "Of course." },
      { role: "user", message: "I would structure the problem around commercial value, feasibility, and risk." },
    ]).turns)!;
    const candidateTurns = mapped.turns.filter((turn) => turn.role === "candidate");
    expect(candidateTurns.map((turn) => turn.substantiveCandidateResponse)).toEqual([false, true]);
    expect(mapped.answeredStages).toContain("framework");
  });

  it("marks an otherwise complete truncated normalization as partial", () => {
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      fullTranscript(),
      { truncated: true },
    )!;
    expect(mapped.observedStages).toEqual(CASE_REPORT_STAGES);
    expect(mapped.partialReasons).toContain("transcript_truncated");
    expect(mapped.partial).toBe(true);
  });

  it("marks all required anchors and subsequent answers as full when not truncated", () => {
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      fullTranscript(),
      { truncated: false },
    )!;
    expect(mapped.partial).toBe(false);
  });

  it("records an unusable transcript reason without inventing observed stages", () => {
    const mapped = mapCaseTranscript(
      AIRPORT,
      CASE_VOICE_STAGE_ANCHOR_VERSION,
      normalizeVoiceTranscript([
        { role: "assistant", message: "Are you ready?" },
        { role: "user", message: "I'm ready." },
      ]).turns,
    )!;
    expect(mapped.observedStages).toEqual([]);
    expect(mapped.partialReasons).toContain("missing_anchor");
    expect(mapped.partialReasons).toContain("unusable_transcript");
    expect(mapped.partial).toBe(true);
  });

  it("assistant manifests contain anchors but no scoring or answer material", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("Canonical stage openings");
      expect(manifest).not.toMatch(/scoring rubric|target_solution|answer key|preferred recommendation|protected calculation/i);
    }
  });

  it("requires explicit readiness and reconfirms ambiguous speech in both assistant prompts", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("Do not present the case statement or begin Clarification");
      expect(manifest).toContain("“I'm ready”, “Yes, I'm ready”, “Ready”,");
      expect(manifest).toContain("“Give me a minute”, “I'm writing”, “Sure”, and “Okay”");
      expect(manifest).toContain("“Just to confirm, are you ready to begin the case?”");
      expect(manifest).toContain("Never infer readiness from candidate silence");
    }
  });

  it("uses the report-generation closing without claiming that scoring is complete", () => {
    const closing =
      "Your personalized report is\nnow being generated in Synthesis and will appear shortly.";
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(closing);
      expect(manifest).toContain("Do not say or imply that the report or score is already complete.");
      expect(manifest).not.toContain("A score is not available yet.");
    }
  });

  it("makes probes explicitly optional and conditional for both assistants", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "Ask a stage-specific probe only when the candidate’s answer is materially\n" +
        "incomplete, unclear, or too brief to establish a usable response.",
      );
      expect(manifest).toContain("Do not ask a\nprobe merely because one is available.");
      expect(manifest).toContain("A probe is optional, not mandatory.");
      expect(manifest).toContain("Ask no more than one probe per stage.");
      expect(manifest).toContain("the answer already contains several relevant and distinct points");
      expect(manifest).toContain("the candidate has clearly completed the requested calculation");
      expect(manifest).toContain("the candidate has already answered the probe’s substance");
      expect(manifest).toContain("repeat the same response");
    }
  });

  it("advances on usable or explicitly completed answers instead of automatically probing", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "“that is my answer”, “that is everything”, “I’m done”, or\n" +
        "  an equivalent completion phrase",
      );
      expect(manifest).toContain(
        "When\nthe response is usable, acknowledge it and advance without probing.",
      );
      expect(manifest).toContain("If the candidate confirms, advance immediately without another probe.");
      expect(manifest).toContain("at least three relevant and\n  distinct areas");
      expect(manifest).toContain("a numerical result or a substantive attempt");
      expect(manifest).toContain("Do not require the exact authored framework.");
    }
  });

  it("keeps each canonical anchor verbatim, complete, separate, and spoken once", () => {
    const prompts = [
      { caseId: AIRPORT, prompt: airportManifest },
      { caseId: GYM, prompt: gymManifest },
    ];
    for (const { caseId, prompt } of prompts) {
      const anchors = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
      const normalizedPrompt = prompt.replace(/\s+/g, " ");
      for (const stage of CASE_REPORT_STAGES) {
        expect(occurrenceCount(prompt, anchors.anchors[stage])).toBe(1);
      }
      expect(occurrenceCount(
        normalizedPrompt,
        "opening above verbatim as a separate sentence",
      )).toBe(5);
      expect(occurrenceCount(prompt, "Speak it once.")).toBe(5);
    }
  });

  it("contains five neutral, case-specific next-phase sentences per assistant", () => {
    const airportPhases = neutralNextPhaseSentences(airportManifest);
    const gymPhases = neutralNextPhaseSentences(gymManifest);
    expect(airportPhases).toHaveLength(5);
    expect(gymPhases).toHaveLength(5);
    expect(occurrenceCount(transitionSection(airportManifest), 'Begin with “Thank you.”')).toBe(5);
    expect(occurrenceCount(transitionSection(gymManifest), 'Begin with “Thank you.”')).toBe(5);
    expect(airportPhases.join(" ")).toMatch(/retail opportunity|conversion improvement/);
    expect(gymPhases.join(" ")).toMatch(/market-entry decision|Dubai opportunity|scale and feasibility/);
  });

  it("keeps transition speech neutral and free of evaluation or hidden answers", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      const spokenTransitions = neutralNextPhaseSentences(manifest).join(" ");
      expect(spokenTransitions).not.toMatch(
        /\b(?:score|scoring|grade|grading|correct|incorrect|passed|failed|answer key)\b/i,
      );
      expect(spokenTransitions).not.toMatch(
        /(?:4[,.]?240[,.]?000|56[.]?7 million|eight locations|8 locations)/i,
      );
    }
  });

  it("removes hardcoded Framework and Analysis theme acknowledgements from transitions", () => {
    const airportTransitions = transitionSection(airportManifest);
    const gymTransitions = transitionSection(gymManifest);
    expect(airportTransitions).not.toMatch(/revenue opportunity, data and AI use\s+cases, implementation feasibility, and risks/);
    expect(airportTransitions).not.toMatch(/customer, commercial, and operational levers/);
    expect(gymTransitions).not.toMatch(/market attractiveness, competition,\s+entry options, economics, and execution risks/);
    expect(gymTransitions).not.toMatch(/customer segmentation, premium differentiation, and\s+competitive positioning/);
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("Grounded acknowledgements");
      expect(manifest).toContain("Mention only themes clearly present in that response.");
      expect(manifest).toContain(
        "Never fill in missing themes from the authored solution, the case's\n  preferred framework, or a prior stage.",
      );
    }
  });

  it("requires a neutral fallback acknowledgement when grounding is uncertain", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "When grounding is uncertain, say only: “Thank you. I've captured your\n  response.”",
      );
      expect(occurrenceCount(manifest, "“I've captured your response.”")).toBeGreaterThanOrEqual(2);
    }
  });

  it("triggers exactly one targeted probe for a weak Framework answer", () => {
    expect(airportManifest).toContain("## Framework probe");
    expect(airportManifest).toContain(
      "You mentioned revenue categories and potential AI tools. What other areas\nwould you assess before deciding which initiatives to pursue?",
    );
    expect(gymManifest).toContain("## Framework probe");
    expect(gymManifest).toContain(
      "You mentioned the market and possible entry options. What other areas would\nyou assess before recommending whether and how to enter?",
    );
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "After this one probe, advance to the Analysis stage even if the answer\nremains weak.",
      );
    }
  });

  it("triggers exactly one targeted probe for a list-only Analysis answer", () => {
    expect(airportManifest).toContain("## Analysis probe");
    expect(airportManifest).toContain(
      "You mentioned chatbots, digital advertising, automation, and robotics. How\nwould those ideas increase conversion, average spending, or passenger\nengagement?",
    );
    expect(gymManifest).toContain("## Analysis probe");
    expect(gymManifest).toContain(
      "You mentioned pricing and competitors. How would you assess whether the\npremium proposition remains attractive to the target customer?",
    );
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "After this one probe, advance to the Data reveal stage even if the answer\nremains weak.",
      );
    }
  });

  it("requires a calculation walkthrough instead of accepting a bare number", () => {
    expect(airportManifest).toContain(
      "“Please walk me through the calculation, including international buyers and\nrevenue, domestic buyers and revenue, and how you combined the two\nsegments.”",
    );
    expect(airportManifest).toContain(
      "“Please walk me through how you calculated the additional buyers and then\nthe revenue uplift.”",
    );
    expect(gymManifest).toContain(
      "“Please walk me through the calculation, including the target demographic,\ngym and premium members, and how you built the monthly and annual premium\nmarket.”",
    );
    expect(gymManifest).toContain(
      "“Please walk me through how you calculated the required number of locations\nand whether you think that's feasible.”",
    );
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "A final numerical answer alone is never a usable quantitative response",
      );
      expect(manifest).toContain(
        "After the one\npermitted calculation probe, advance even if the answer remains incorrect or\nincomplete.",
      );
      expect(manifest).toContain("Do not confirm correctness,\nreject the answer as wrong, reveal the expected answer, supply intermediate\nresults, or complete the calculation for the candidate.");
    }
  });

  it("triggers the Recommendation probe for a bare decision and closes without grading afterward", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Recommendation probe");
      expect(manifest).toContain(
        "“What's the reasoning behind that, and what's one risk or next step you'd\nflag before the CEO moves forward?”",
      );
      expect(manifest).toContain(
        "After the candidate answers the probe, close the case without grading, per\nthe Closing section below.",
      );
    }
  });

  it("allows only one probe per stage across Framework, Analysis, calculation, and Recommendation probes", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(occurrenceCount(manifest, "Ask at most one calculation probe per stage.")).toBe(1);
      expect(manifest).toContain("must trigger exactly one probe:");
    }
  });

  it("does not add any protected answer or scoring artifact to either Vapi prompt", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).not.toMatch(/3\.24 million|180,000 per day/);
      expect(manifest).not.toMatch(/scoring rubric|target_solution|answer key|preferred recommendation|protected calculation/i);
    }
  });
});

describe("candidate-experience improvements", () => {
  const penAndPaperLine =
    "“Before I share the case, please have a pen and a piece of paper ready to jot\ndown the key facts, your framework, analysis, and calculations.”";

  it("places the pen-and-paper instruction after explicit readiness and before the case statement", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      const readinessIndex = manifest.indexOf("Never infer readiness from candidate silence");
      const penPaperIndex = manifest.indexOf(penAndPaperLine);
      const caseStatementIndex = manifest.indexOf("Present exactly:");
      expect(readinessIndex).toBeGreaterThan(-1);
      expect(penPaperIndex).toBeGreaterThan(readinessIndex);
      expect(caseStatementIndex).toBeGreaterThan(penPaperIndex);
    }
  });

  it("speaks the pen-and-paper instruction exactly once per assistant", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(occurrenceCount(manifest, penAndPaperLine)).toBe(1);
    }
  });

  it("does not introduce a second automatic readiness gate", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(occurrenceCount(manifest, "“Just to confirm, are you ready to begin the case?”")).toBe(1);
      expect(manifest).toContain(
        "Then continue directly into the case statement below. Do not create a second\nreadiness gate and do not wait for another confirmation before presenting the\ncase, unless the candidate asks for a moment to get a pen or paper.",
      );
      expect(manifest).toContain("This does not change the configured Vapi first message.");
    }
  });

  it("allows candidate case summaries to be confirmed and factually corrected", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Candidate case-summary confirmation");
      expect(manifest).toContain("1. Listen to the candidate's summary.");
      expect(manifest).toContain("2. Confirm only the points they stated accurately.");
      expect(manifest).toContain(
        "3. Correct any factual misunderstanding using only candidate-safe information\n   already contained in the opening case statement above.",
      );
      expect(manifest).toContain(
        "4. Briefly mention any important opening-case fact they omitted when it is\n   necessary to understand the objective.",
      );
    }
  });

  it("grounds summary confirmation in only opening-case and candidate-safe facts", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "This is an example, not a mandatory script. Ground the response in the\ncandidate's actual summary and the case statement above.",
      );
    }
  });

  it("prevents summary confirmation from revealing future-stage inputs or protected answers", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "5. Do not supply framework categories, analysis ideas, calculations, preferred\n   recommendations, or future-stage information.",
      );
      expect(manifest).toContain("6. Do not disclose Data reveal or Pressure test inputs early.");
    }
  });

  it("follows the summary interaction with the exact canonical Clarification anchor", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "7. After confirming or correcting the summary, continue with the canonical\n   Clarification opening.",
      );
      expect(manifest).toContain(
        "If the candidate offers a summary of the case back instead of moving straight\nto clarification questions, follow the Candidate case-summary confirmation\nsection below, then ask the canonical Clarification opening.",
      );
      const manifestFn = caseStageAnchorManifest(
        manifest === airportManifest ? AIRPORT : GYM,
        CASE_VOICE_STAGE_ANCHOR_VERSION,
      )!;
      expect(occurrenceCount(manifest, manifestFn.anchors.clarification)).toBe(1);
    }
  });

  it("instructs the candidate to write down numbers before the Data reveal calculation", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "Immediately after speaking the canonical Data reveal opening above as its own\nsentence, say:\n\n“Please write these numbers down to help you with your calculation.”",
      );
    }
  });

  it("instructs the candidate to write down relevant inputs before the Pressure test calculation", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain(
        "Immediately after speaking the canonical Pressure test opening above as its\nown sentence, say:\n\n“Please write down the relevant inputs before you calculate.”",
      );
    }
  });

  it("groups quantitative values and allows them to be repeated on request", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Quantitative input presentation");
      expect(manifest).toContain("### Speaking behavior");
      expect(manifest).toContain("- group related inputs together;");
      expect(manifest).toContain("- pause briefly between input groups;");
      expect(manifest).toContain("- allow the candidate to ask for the inputs to be repeated;");
      expect(manifest).toContain("- when asked, repeat only the authored inputs above;");
      expect(manifest).toContain("- never reveal intermediate or final answers.");
    }
  });

  it("does not add any expected calculation or answer alongside the note-taking inputs", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).not.toMatch(
        /(?:4[,.]?240[,.]?000|56[.]?7 million|eight locations|8 locations|720,000|5,700,000)/i,
      );
      expect(manifest).toContain("Do not change these values.");
    }
    expect(airportManifest).toContain("Do not calculate the result.");
    expect(gymManifest).toContain(
      "Do not calculate target revenue, annual location revenue, required\nlocations, total capital, or final feasibility.",
    );
  });

  it("provides the Gym Pressure test per-location unit-economics inputs without calculating locations", () => {
    expect(gymManifest).toContain(
      "- target: ten percent of the Dubai premium gym market by year three;\n- establishment cost: approximately USD 2 million to USD 3 million per\n  location;\n- mature members per location: approximately 500;\n- average membership: USD 120 per month;\n- mature monthly revenue per location: approximately USD 60,000;\n- breakeven: approximately 300 members;\n- estimated payback: three to four years at approximately 70 percent\n  occupancy.",
    );
    expect(gymManifest).not.toMatch(/\b8\b locations|eight locations|56\.7 million|\$56,700,000|5,700,000|720,000/i);
  });

  it("keeps every canonical anchor unchanged and occurring exactly once alongside the new instructions", () => {
    for (const { caseId, manifest } of [
      { caseId: AIRPORT, manifest: airportManifest },
      { caseId: GYM, manifest: gymManifest },
    ]) {
      const anchors = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
      for (const stage of CASE_REPORT_STAGES) {
        expect(occurrenceCount(manifest, anchors.anchors[stage])).toBe(1);
      }
    }
  });

  it("does not merge the pen-and-paper or note-taking instructions into a canonical question", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      const anchors = caseStageAnchorManifest(
        manifest === airportManifest ? AIRPORT : GYM,
        CASE_VOICE_STAGE_ANCHOR_VERSION,
      )!;
      for (const stage of CASE_REPORT_STAGES) {
        const anchorIndex = manifest.indexOf(anchors.anchors[stage]);
        const anchorLine = manifest.slice(
          manifest.lastIndexOf("\n", anchorIndex) + 1,
          manifest.indexOf("\n", anchorIndex),
        );
        expect(anchorLine).not.toMatch(/pen and a piece of paper|write these numbers down|write down the relevant inputs/);
      }
    }
  });

  it("keeps grounded acknowledgement, targeted-probe, calculation-walkthrough, and Recommendation-probe rules present", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Grounded acknowledgements");
      expect(manifest).toContain("## Framework probe");
      expect(manifest).toContain("## Analysis probe");
      expect(manifest).toContain("## Calculation walkthrough");
      expect(manifest).toContain("## Recommendation probe");
    }
  });
});

describe("Vapi First Message and candidate-safe disclosure regressions", () => {
  it("acknowledges the configured Vapi First Message instead of re-authoring a Start line", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("The configured Vapi First Message already says exactly:");
      expect(manifest).not.toContain("Start with exactly:");
      expect(manifest).toContain("Do not repeat this greeting after the candidate responds.");
      expect(manifest).toContain(
        "This System Prompt's\nbehavior begins only after the candidate's response to that greeting.",
      );
    }
  });

  it("keeps the greeting text itself unchanged so the configured First Message field still matches", () => {
    expect(airportManifest).toContain(
      "“Hello, I'll be your case interviewer today. We'll be working through the Airport\nProfitability case. Are you ready to begin?”",
    );
    expect(gymManifest).toContain(
      "“Hello, I'll be your case interviewer today. We'll be working through the GCC\nPremium Gym Market Entry case. Are you ready to begin?”",
    );
  });

  it("preserves all candidate-safe clarification and disclosure sections as a merged superset", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Candidate-safe case facts");
      expect(manifest).toContain("### Source gaps");
      expect(manifest).toContain(
        "“That information is not specified. Please state a reasonable assumption and\nexplain how you would validate it.”",
      );
      expect(manifest).toContain("Use this same response at any stage, not only Clarification.");
      expect(manifest).toContain("### Clarification facts");
      expect(manifest).toContain("### Analysis-stage candidate-safe facts");
      expect(manifest).toContain("### Data reveal disclosure rules");
      expect(manifest).toContain("### Pressure test facts and calculation-method help");
      expect(manifest).toContain("### Recommendation requirements");
      expect(manifest).toContain("### Future-stage disclosure rules");
      expect(manifest).toContain(
        "Never reveal a later stage's question, exhibit, or inputs before that stage\nis reached. Never reveal scoring, rubric weights, or the protected solution\nat any point in the call.",
      );
      expect(manifest).toContain(
        "Do not invent a\nfact, number, or detail that is not listed in this prompt.",
      );
    }
  });

  it("says Saudi Arabian Riyal in full in the Airport prompt and never uses the SAR abbreviation", () => {
    expect(airportManifest).not.toMatch(/\bSAR\b/);
    expect(occurrenceCount(airportManifest, "Saudi Arabian Riyal")).toBeGreaterThanOrEqual(3);
    expect(airportManifest).toContain("Saudi Arabian Riyal\n150 average spend.");
    expect(airportManifest).toContain("Saudi Arabian Riyal 80\naverage spend.");
    expect(airportManifest).toContain("international average spend: Saudi Arabian Riyal 150;");
  });

  it("keeps all previously added grounded-acknowledgement, probe, note-taking, and summary behavior", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).toContain("## Grounded acknowledgements");
      expect(manifest).toContain("## Framework probe");
      expect(manifest).toContain("## Analysis probe");
      expect(manifest).toContain("## Calculation walkthrough");
      expect(manifest).toContain("## Recommendation probe");
      expect(manifest).toContain("## Candidate case-summary confirmation");
      expect(manifest).toContain("## Quantitative input presentation");
      expect(manifest).toContain(
        "“Before I share the case, please have a pen and a piece of paper ready to jot\ndown the key facts, your framework, analysis, and calculations.”",
      );
      expect(manifest).toContain("“Please write these numbers down to help you with your calculation.”");
      expect(manifest).toContain("“Please write down the relevant inputs before you calculate.”");
    }
  });

  it("keeps every canonical anchor unchanged and occurring exactly once after the merge", () => {
    for (const { caseId, manifest } of [
      { caseId: AIRPORT, manifest: airportManifest },
      { caseId: GYM, manifest: gymManifest },
    ]) {
      const anchors = caseStageAnchorManifest(caseId, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
      for (const stage of CASE_REPORT_STAGES) {
        expect(occurrenceCount(manifest, anchors.anchors[stage])).toBe(1);
      }
    }
  });

  it("does not add scoring rubrics, preferred recommendations, or protected solution content", () => {
    for (const manifest of [airportManifest, gymManifest]) {
      expect(manifest).not.toMatch(/scoring rubric|target_solution|answer key|protected calculation/i);
      expect(manifest).not.toMatch(
        /(?:4[,.]?240[,.]?000|56[.]?7 million|eight locations|8 locations|720,000|5,700,000|164,000,000)/i,
      );
    }
  });
});

describe("dedicated post-call scoring", () => {
  it("produces a full five-dimension report without FSM inventions", async () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, fullTranscript())!;
    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.partial).toBe(false);
    expect(result.report.score.dimension_scores).toHaveLength(5);
    expect(JSON.stringify(result.report)).not.toMatch(/hints_used|stage_attempts|exhibits_revealed|evaluations/);
  });

  it("does not fabricate an overall score for a partial transcript", async () => {
    const manifest = caseStageAnchorManifest(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION)!;
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, normalizeVoiceTranscript([
      { role: "assistant", message: manifest.anchors.framework },
      { role: "user", message: "I would use customer, economics, and execution buckets." },
    ]).turns)!;
    const result = await scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped);
    expect(result.ok && result.report.score.overall).toBeNull();
  });

  it("fails an empty or unusable transcript instead of creating a fake score", async () => {
    const mapped = mapCaseTranscript(AIRPORT, CASE_VOICE_STAGE_ANCHOR_VERSION, [])!;
    await expect(scoreCasePostCall(getVoiceLlmCaseRecord(AIRPORT)!, mapped))
      .resolves.toEqual({ ok: false, failureCode: "empty_transcript" });
  });
});

describe("native client capability recovery", () => {
  it("persists and recovers the capability for 115 minutes", () => {
    const target = memoryStorage();
    const pending = { sessionId: "s", reportToken: "t", caseId: AIRPORT, caseTitle: "Airport", assistantId: "a", createdAt: 100 };
    writePendingNativeCaseReport(pending, target);
    expect(readPendingNativeCaseReport(101, target)).toEqual(pending);
    clearPendingNativeCaseReport(target);
    expect(readPendingNativeCaseReport(101, target)).toBeNull();
  });

  it("expires old recovery capabilities", () => {
    const target = memoryStorage();
    writePendingNativeCaseReport({ sessionId: "s", reportToken: "t", caseId: AIRPORT, caseTitle: "Airport", assistantId: "a", createdAt: 0 }, target);
    expect(readPendingNativeCaseReport(116 * 60 * 1_000, target)).toBeNull();
  });

  it("updates readiness only for a full authoritative report", () => {
    const base = {
      caseId: AIRPORT,
      caseTitle: "Airport",
      observedStages: [...CASE_REPORT_STAGES],
      missingStages: [],
      failureCode: null,
      score: {
        overall: 4,
        dimension_scores: ["structure", "hypothesis_driven_thinking", "quantitative_reasoning", "synthesis", "communication"].map((dimension) => ({ dimension, score: 4, justification: "Observed.", evidence: "Evidence." })),
        summary: "Complete report.",
        strengths: [], improvements: [], next_focus: [],
        stage_feedback: [],
        improved_framework_outline: [],
        improved_recommendation_outline: [],
        quantitative_assessment: "Observed quantitative reasoning.",
      },
    } as any;
    expect(fullAuthoritativeCaseScore({ ...base, status: "done", partial: false })).not.toBeNull();
    expect(fullAuthoritativeCaseScore({ ...base, status: "done", partial: true })).toBeNull();
    expect(fullAuthoritativeCaseScore({ ...base, status: "failed", partial: false })).toBeNull();
  });
});
