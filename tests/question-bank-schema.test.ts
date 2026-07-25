import { describe, expect, it } from "vitest";
import {
  getQuestionBank,
  orderedQuestions,
  questionBankRoles,
  validateQuestionBank,
} from "@/lib/voice/question-bank";
import { QUESTION_BANK_CATALOG } from "@/lib/voice/question-bank-catalog";
import { questionAnchorManifest } from "@/lib/voice/question-bank-transcript";
import { CASE_VOICE_QUESTION_ANCHOR_VERSION } from "@/lib/voice/case-native-config";

const CASE_TO_ROLE = {
  data_analyst_technical_round: "data_analyst",
  data_engineer_technical_round: "data_engineer",
} as const;

describe("technical question banks — structural validation", () => {
  for (const role of ["data_analyst", "data_engineer"] as const) {
    describe(role, () => {
      const bank = getQuestionBank(role);

      it("passes full structural validation with zero issues", () => {
        expect(validateQuestionBank(bank)).toEqual([]);
      });

      it("question_count equals actual question count", () => {
        expect(bank.question_count).toBe(bank.questions.length);
        expect(bank.questions.length).toBe(5);
      });

      it("question ids are unique", () => {
        const ids = bank.questions.map((q) => q.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("default_order contains every question exactly once", () => {
        const ids = bank.questions.map((q) => q.id);
        expect([...bank.default_order].sort()).toEqual([...ids].sort());
        expect(bank.default_order.length).toBe(ids.length);
      });

      it("every rubric's dimension weights sum to 1", () => {
        for (const q of bank.questions) {
          const sum = q.rubric.dimensions.reduce((acc, d) => acc + d.weight, 0);
          expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
        }
      });

      it("scoring uses equal weighting summing to 1", () => {
        expect(bank.scoring.question_weighting).toBe("equal");
        expect(bank.scoring.per_question_weight * bank.questions.length).toBeCloseTo(1, 6);
      });

      it("every adaptive probe references an existing target element", () => {
        for (const q of bank.questions) {
          const teIds = new Set(q.target_elements.map((t) => t.id));
          for (const probe of q.adaptive.probes) {
            for (const ref of probe.target_element_ids) {
              expect(teIds.has(ref)).toBe(true);
            }
          }
        }
      });

      it("every question has an answer key and role/track consistency", () => {
        expect(bank.track).toBe("technical");
        for (const q of bank.questions) {
          expect(q.role).toBe(bank.role);
          expect(q.answer_key.strong_answer_outline.length).toBeGreaterThan(0);
          expect(Array.isArray(q.answer_key.acceptable_alternatives)).toBe(true);
          expect(Array.isArray(q.answer_key.red_flags)).toBe(true);
        }
      });
    });
  }

  it("exposes exactly the two roles", () => {
    expect(questionBankRoles().sort()).toEqual(["data_analyst", "data_engineer"]);
  });
});

describe("client-safe catalog stays in sync with the banks", () => {
  for (const [caseId, role] of Object.entries(CASE_TO_ROLE)) {
    it(`${caseId}: catalog ids/titles/order match the bank default_order`, () => {
      const bank = getQuestionBank(role);
      const ordered = orderedQuestions(bank);
      const catalog = QUESTION_BANK_CATALOG[caseId];
      expect(catalog.map((e) => e.id)).toEqual(bank.default_order);
      expect(catalog.map((e) => e.order)).toEqual(ordered.map((_, i) => i + 1));
      for (const entry of catalog) {
        const q = bank.questions.find((question) => question.id === entry.id);
        expect(entry.title).toBe(q?.title);
      }
    });
  }
});

describe("question anchor manifest stays in sync with the banks", () => {
  for (const [caseId, role] of Object.entries(CASE_TO_ROLE)) {
    it(`${caseId}: manifest order equals default_order and every anchor is present`, () => {
      const bank = getQuestionBank(role);
      const manifest = questionAnchorManifest(caseId, CASE_VOICE_QUESTION_ANCHOR_VERSION);
      expect(manifest).not.toBeNull();
      expect(manifest!.order).toEqual(bank.default_order);
      for (const id of bank.default_order) {
        expect(manifest!.anchors[id]?.length ?? 0).toBeGreaterThan(0);
      }
      // Anchors are mutually unique.
      const anchors = bank.default_order.map((id) => manifest!.anchors[id]);
      expect(new Set(anchors).size).toBe(anchors.length);
    });
  }

  it("returns null for an unknown manifest version", () => {
    expect(questionAnchorManifest("data_analyst_technical_round", "nope")).toBeNull();
  });
});
