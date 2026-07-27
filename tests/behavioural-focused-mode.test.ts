import { describe, it, expect } from "vitest";
import {
  asBehaviouralSessionMode,
  buildSessionQuestions,
  generateQuestions,
  selectFocusedQuestions,
  FOCUS_FAMILY_ORDER,
  type BehaviouralContext,
} from "@/lib/behavioural/question-gen";
import {
  BEHAVIOURAL_QUESTION_BANK,
  FOCUSED_SESSION_QUESTION_COUNT,
  behaviouralFullSessionRange,
  behaviouralQuestionCount,
} from "@/lib/behavioural/bank";
import { startBehavioural } from "@/lib/behavioural/runner";
import { MOCK_QUESTIONS, MOCK_JD_TEXT } from "@/lib/__mocks__/fixtures";

/** Contexts spanning known role families, an unknown role, and no context at all. */
const CONTEXTS: { name: string; ctx: BehaviouralContext | null }[] = [
  { name: "data analytics", ctx: { role: "Data Analyst", company: "Tenazx Inc", industry: "banking" } },
  { name: "product management", ctx: { role: "Product Manager", company: "Figma" } },
  { name: "consulting", ctx: { role: "Management Consultant", industry: "consulting" } },
  { name: "software engineering", ctx: { role: "Backend Engineer" } },
  { name: "marketing", ctx: { role: "Marketing Manager", company: "Canva" } },
  { name: "unknown role", ctx: { role: "Chief Vibes Officer" } },
  { name: "role only", ctx: { role: "Data Engineer" } },
  { name: "empty context", ctx: {} },
  { name: "null context", ctx: null },
];

describe("behavioural session modes", () => {
  describe("focused session", () => {
    it("asks exactly five questions for every context", () => {
      for (const { name, ctx } of CONTEXTS) {
        const qs = selectFocusedQuestions(MOCK_QUESTIONS, ctx);
        expect(qs, name).toHaveLength(FOCUSED_SESSION_QUESTION_COUNT);
      }
    });

    it("covers each focus family exactly once", () => {
      for (const { name, ctx } of CONTEXTS) {
        const families = selectFocusedQuestions(MOCK_QUESTIONS, ctx).map((q) => q.focus_family);
        expect(new Set(families), name).toEqual(new Set(FOCUS_FAMILY_ORDER));
        expect(families, name).toHaveLength(new Set(families).size);
      }
    });

    it("preserves bank / interview order", () => {
      const bankOrder = MOCK_QUESTIONS.map((q) => q.id);
      for (const { name, ctx } of CONTEXTS) {
        const picked = selectFocusedQuestions(MOCK_QUESTIONS, ctx).map((q) => q.id);
        const expected = bankOrder.filter((id) => picked.includes(id));
        expect(picked, name).toEqual(expected);
      }
    });

    it("always opens on the introduction question", () => {
      for (const { name, ctx } of CONTEXTS) {
        const qs = selectFocusedQuestions(MOCK_QUESTIONS, ctx);
        expect(qs[0].id, name).toBe("tell_me_about_yourself");
      }
    });

    it("is deterministic for a given context", () => {
      const ctx = { role: "Data Analyst", company: "Tenazx Inc" };
      const first = selectFocusedQuestions(MOCK_QUESTIONS, ctx).map((q) => q.id);
      for (let i = 0; i < 5; i++) {
        expect(selectFocusedQuestions(MOCK_QUESTIONS, ctx).map((q) => q.id)).toEqual(first);
      }
    });

    it("applies role affinity to the competency slot", () => {
      const competencyFor = (ctx: BehaviouralContext) =>
        selectFocusedQuestions(MOCK_QUESTIONS, ctx).find(
          (q) => q.focus_family === "competency",
        )?.id;

      expect(competencyFor({ role: "Data Analyst" })).toBe("data_driven_decision");
      expect(competencyFor({ role: "Product Manager" })).toBe("cross_functional");
      expect(competencyFor({ role: "Management Consultant" })).toBe("ambiguity");
      // Unknown roles fall back to the documented default.
      expect(competencyFor({ role: "Chief Vibes Officer" })).toBe("data_driven_decision");
    });

    it("applies role affinity to the challenge and achievement slots", () => {
      const idFor = (ctx: BehaviouralContext, family: string) =>
        selectFocusedQuestions(MOCK_QUESTIONS, ctx).find((q) => q.focus_family === family)?.id;

      expect(idFor({ role: "Management Consultant" }, "achievement")).toBe(
        "influence_without_authority",
      );
      expect(idFor({ role: "Product Manager" }, "challenge")).toBe("conflict");
      expect(idFor({ role: "Backend Engineer" }, "challenge")).toBe("tight_deadline");
      // Defaults for an unrecognised role.
      expect(idFor({ role: "Chief Vibes Officer" }, "challenge")).toBe("time_you_failed");
      expect(idFor({ role: "Chief Vibes Officer" }, "achievement")).toBe("leadership");
    });

    it("prefers 'why this company' for the motivation slot only when a company is known", () => {
      const motivationFor = (ctx: BehaviouralContext) =>
        selectFocusedQuestions(MOCK_QUESTIONS, ctx).find(
          (q) => q.focus_family === "motivation",
        );

      const withCompany = motivationFor({ role: "Data Analyst", company: "Tenazx Inc" });
      expect(withCompany?.id).toBe("why_this_company");
      // Dynamic wording still applies to the narrowed set.
      expect(withCompany?.question).toContain("Tenazx Inc");
      expect(withCompany?.question).not.toContain("{{company}}");

      expect(motivationFor({ role: "Data Analyst" })?.id).toBe("role_motivation");
      expect(motivationFor({})?.id).toBe("role_motivation");
    });

    it("only ever returns questions the full session would also have asked", () => {
      for (const { name, ctx } of CONTEXTS) {
        const full = new Set(generateQuestions(MOCK_QUESTIONS, ctx).map((q) => q.id));
        for (const q of selectFocusedQuestions(MOCK_QUESTIONS, ctx)) {
          expect(full.has(q.id), `${name}: ${q.id}`).toBe(true);
        }
      }
    });

    it("still returns five questions for a legacy bank with no focus_family", () => {
      const legacy = MOCK_QUESTIONS.map(({ focus_family: _ignored, ...rest }) => rest);
      const qs = selectFocusedQuestions(legacy, { role: "Data Analyst" });
      expect(qs).toHaveLength(FOCUSED_SESSION_QUESTION_COUNT);
    });
  });

  describe("full session is unchanged", () => {
    it("produces byte-identical output to the existing generateQuestions path", () => {
      for (const { name, ctx } of CONTEXTS) {
        expect(buildSessionQuestions(MOCK_QUESTIONS, ctx, "full"), name).toEqual(
          generateQuestions(MOCK_QUESTIONS, ctx),
        );
      }
    });

    it("defaults to the full flow when no mode is supplied", () => {
      const ctx = { role: "Data Analyst", company: "Tenazx Inc" };
      expect(buildSessionQuestions(MOCK_QUESTIONS, ctx)).toEqual(
        generateQuestions(MOCK_QUESTIONS, ctx),
      );
      expect(startBehavioural({ questionBank: MOCK_QUESTIONS, jdText: MOCK_JD_TEXT }).sessionMode).toBe(
        "full",
      );
    });

    it("keeps the 13-14 question range for the authored bank", () => {
      const range = behaviouralFullSessionRange();
      expect(range).toEqual({ min: 13, max: 14 });

      // With a distinct industry the conditional question survives; without it, it drops.
      expect(
        behaviouralQuestionCount("full", { role: "Data Analyst", industry: "banking" }),
      ).toBe(range.max);
      expect(behaviouralQuestionCount("full", { role: "Data Analyst" })).toBe(range.min);
    });
  });

  describe("mode plumbing", () => {
    it("normalizes unknown modes to the existing full flow", () => {
      expect(asBehaviouralSessionMode("focused")).toBe("focused");
      expect(asBehaviouralSessionMode("full")).toBe("full");
      for (const value of [undefined, null, "", "FOCUSED", "brief", 5, {}]) {
        expect(asBehaviouralSessionMode(value)).toBe("full");
      }
    });

    it("startBehavioural honours the mode and reports it back", () => {
      const focused = startBehavioural({
        questionBank: MOCK_QUESTIONS,
        jdText: MOCK_JD_TEXT,
        sessionMode: "focused",
      });
      expect(focused.sessionMode).toBe("focused");
      expect(focused.questions).toHaveLength(FOCUSED_SESSION_QUESTION_COUNT);
      // The session records exactly the questions that will be asked, so scoring
      // and the report denominator both see 5 — never the full bank.
      expect(focused.session.questions_asked).toHaveLength(FOCUSED_SESSION_QUESTION_COUNT);
      expect(focused.session.questions_asked?.map((q) => q.question_id)).toEqual(
        focused.questions.map((q) => q.id),
      );
    });

    it("behaviouralQuestionCount reports exactly what each mode asks", () => {
      expect(behaviouralQuestionCount("focused", { role: "Data Analyst" })).toBe(
        FOCUSED_SESSION_QUESTION_COUNT,
      );
      expect(behaviouralQuestionCount("full", null)).toBe(
        generateQuestions(BEHAVIOURAL_QUESTION_BANK, null).length,
      );
    });
  });

  describe("authored bank metadata", () => {
    it("tags every question with a known focus family", () => {
      for (const q of BEHAVIOURAL_QUESTION_BANK) {
        expect(FOCUS_FAMILY_ORDER, q.id).toContain(q.focus_family);
      }
    });

    it("has at least one always-available question per family", () => {
      for (const family of FOCUS_FAMILY_ORDER) {
        const unconditional = BEHAVIOURAL_QUESTION_BANK.filter(
          (q) => q.focus_family === family && !q.conditional,
        );
        expect(unconditional.length, family).toBeGreaterThan(0);
      }
    });
  });
});
