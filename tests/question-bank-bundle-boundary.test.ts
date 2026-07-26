import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

// Server-only modules that must never be imported by a client component: the
// question-bank loader and scorer pull in answer keys and/or the Anthropic SDK.
const SERVER_ONLY_IMPORTS = [
  "@/lib/voice/case-question-bank-scorer",
  "@/lib/voice/question-bank\"", // the server loader (exact specifier, not -catalog / -types)
  "@/lib/voice/question-bank'",
  "@/lib/claude",
  "@/context/technical/",
];

describe("client/server bundle boundary for the question-bank rounds", () => {
  for (const component of [
    "components/CaseNativeVoiceInterview.tsx",
    "components/CaseVoiceInterview.tsx",
  ]) {
    it(`${component} imports no server-only question-bank module`, () => {
      const src = read(component);
      for (const forbidden of SERVER_ONLY_IMPORTS) {
        expect(src.includes(forbidden)).toBe(false);
      }
    });
  }

  it("the client-safe catalog carries titles only — no bank JSON, no server loader", () => {
    const src = read("lib/voice/question-bank-catalog.ts");
    expect(src.includes("@/context/technical/")).toBe(false);
    expect(src.includes("@/lib/claude")).toBe(false);
    expect(src.includes("case-question-bank-scorer")).toBe(false);
    // No answer-key vocabulary should appear in the client-safe module.
    expect(src.includes("acceptable_alternatives")).toBe(false);
    expect(src.includes("red_flags")).toBe(false);
    expect(src.includes("strong_answer_outline")).toBe(false);
  });

  it("the client component uses the client-safe title module for labels", () => {
    const src = read("components/CaseNativeVoiceInterview.tsx");
    expect(src.includes("@/lib/voice/question-bank-catalog")).toBe(true);
  });

  // The unified technical-native modules are imported by client components, so
  // they must stay free of the scorers, the bank JSON, and the model SDK.
  for (const module of [
    "lib/voice/native-progress.ts",
    "lib/voice/native-current-question.ts",
    "lib/voice/native-case-brief.ts",
    "lib/voice/case-native-live.ts",
  ]) {
    it(`${module} imports no server-only module`, () => {
      const src = read(module);
      for (const forbidden of SERVER_ONLY_IMPORTS) {
        expect(src.includes(forbidden)).toBe(false);
      }
    });
  }

  it("the answer projection reaches the client as a type-only import", () => {
    const src = read("components/CaseNativeVoiceInterview.tsx");
    // Value imports of the projection module would bundle the transcript mappers.
    expect(src.includes('import type { CandidateAnswerGroup } from "@/lib/voice/case-answer-projection"')).toBe(true);
    expect(src.includes('import { candidateAnswerProjection')).toBe(false);
  });
});
