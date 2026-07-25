import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getQuestionBank } from "@/lib/voice/question-bank";
import { questionAnchorManifest } from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";

const FIXTURES = {
  data_analyst_technical_round: "context/vapi/data-analyst-technical-round-assistant-v1.md",
  data_engineer_technical_round: "context/vapi/data-engineer-technical-round-assistant-v1.md",
} as const;

const CASE_TO_ROLE = {
  data_analyst_technical_round: "data_analyst",
  data_engineer_technical_round: "data_engineer",
} as const;

function readFixture(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("prompt-anchor contract (Vapi source-of-truth fixtures)", () => {
  for (const [caseId, rel] of Object.entries(FIXTURES)) {
    describe(caseId, () => {
      const text = readFixture(rel);
      const role = CASE_TO_ROLE[caseId as keyof typeof CASE_TO_ROLE];
      const bank = getQuestionBank(role);
      const manifest = questionAnchorManifest(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION)!;
      const anchors = bank.default_order.map((id) => manifest.anchors[id]);

      it("every question's anchor appears verbatim in the prompt", () => {
        for (const anchor of anchors) {
          expect(text.includes(anchor)).toBe(true);
        }
      });

      it("every bank question is represented (title + anchor)", () => {
        for (const q of bank.questions) {
          expect(text.includes(q.title)).toBe(true);
        }
      });

      it("anchors appear in default_order (first-occurrence order)", () => {
        const positions = anchors.map((a) => text.indexOf(a));
        for (let i = 1; i < positions.length; i += 1) {
          expect(positions[i]).toBeGreaterThan(positions[i - 1]);
        }
      });

      it("no two questions share the same anchor", () => {
        expect(new Set(anchors).size).toBe(anchors.length);
      });

      it("no single line is instructed to speak two question anchors", () => {
        for (const line of text.split("\n")) {
          const hits = anchors.filter((a) => line.includes(a)).length;
          expect(hits).toBeLessThanOrEqual(1);
        }
      });

      it("the first message contains readiness only, not question one or any anchor", () => {
        const start = text.indexOf("## First message");
        const end = text.indexOf("## System prompt");
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const firstMessage = text.slice(start, end);
        for (const anchor of anchors) {
          expect(firstMessage.includes(anchor)).toBe(false);
        }
        expect(/ready/i.test(firstMessage)).toBe(true);
      });
    });
  }
});
