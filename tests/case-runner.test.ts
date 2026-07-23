import { describe, it, expect } from "vitest";
import { respondToCase, startCase } from "@/lib/fsm/case-runner";
import { initSession } from "@/lib/fsm/case-fsm";
import beautify from "@/context/cases/beautify.json";
import diconsa from "@/context/cases/diconsa.json";
import type { CaseRecord, CaseSessionState, CaseState } from "@/lib/types";

const c = beautify as unknown as CaseRecord;
const dc = diconsa as unknown as CaseRecord;

const ANSWERS: Record<CaseState, string> = {
  intro:
    "We're being asked one core question: would retraining most of Beautify's in-store consultants into virtual social-media advisors be profitable? Two things drive it — first, shoppers are moving online and consultants sit idle; second, the retraining investment must pay back within a reasonable horizon while protecting the brand and retail relationships.",
  clarification:
    "I'd ask three clarifying questions. First, over what time horizon must this be profitable? Second, which brands and markets are in scope for the virtual rollout? Third, who bears the retraining and IT cost, Beautify or the retail partners?",
  framework:
    "I'd structure this around five factors. First, the retailer response. Second, the competitor response. Third, our consultants' current capabilities. Fourth, the brand-image risk. Fifth, the underlying economics of retraining cost versus incremental revenue. My hypothesis is the economics will dominate, so I'd size them first.",
  analysis:
    "I'd start from what the customer values in store and ask how virtual can match it. First, real-time tailored feedback through a selfie-mirror app with virtual try-on. Second, an online community led by a trusted advisor. Third, learning trends from that advisor. Fourth, private, responsive handling of specific concerns. My hypothesis is that personalization and trust are the switching triggers, so the virtual experience must replicate the relationship.",
  data_reveal:
    "Payback is the upfront investment over the annual profit it generates. Incremental revenue is €130M, minus €10M annual costs is €120M, minus €2.5M IT depreciation is €117.5M. So €150M ÷ €117.5M ≈ 1.28 years. The competitor data shows virtual try-on lifts conversion most and cuts returns, so I'd prioritize that capability.",
  pressure_test:
    "I don't dismiss the risk — therefore I'd size it and mitigate it. My hypothesis is that the upside outweighs the cannibalization risk if we phase carefully. I'd pilot in two markets to measure cannibalization before scaling, share economics with retail partners through a revenue-share, and set brand-content guidelines. The payback math and the try-on conversion data suggest the value is real, so the risk is manageable.",
  recommendation:
    "My recommendation is to proceed with a phased rollout. The payback is about 1.28 years, well within a reasonable horizon, and the exhibit shows virtual try-on drives the most conversion while cutting returns. So I'd prioritize that capability, pilot in two markets, and share economics with retail partners to manage cannibalization.",
  scoring: "",
};

describe("case runner (full mock session)", () => {
  it("starts at intro with pre-fetched context and the authored prompt", async () => {
    const res = await startCase(c);
    expect(res.stage).toBe("intro");
    expect(res.interviewer.text).toBe(c.prompt);
    expect(res.context.stage).toBe("intro");
    expect(Array.isArray(res.context.grounding)).toBe(true);
  });

  it("runs Beautify start→scoring, drips both exhibits, varies evaluations, and ends with a 5-dim score", async () => {
    let session: CaseSessionState = (await startCase(c)).session;
    const overalls: number[] = [];
    let finalScore = null;
    let guard = 0;

    while (guard++ < 25) {
      const res = await respondToCase(c, session, ANSWERS[session.fsm_state]);
      session = res.session;
      overalls.push(res.evaluation.overall);
      if (res.complete) {
        finalScore = res.score;
        break;
      }
    }

    // reached the terminal scoring stage with a final score
    expect(session.fsm_state).toBe("scoring");
    expect(session.complete).toBe(true);
    expect(finalScore).not.toBeNull();

    // exactly the two Beautify exhibits were dripped
    expect(session.exhibits_revealed).toHaveLength(2);

    // evaluations vary turn to turn (not a constant score). Ordered strong/medium/
    // weak variety is proven in case-evaluator.test.ts; here the answers are all
    // strong, so they cluster but are not identical.
    expect(new Set(overalls).size).toBeGreaterThanOrEqual(2);

    // final score is a well-formed multi-dimension CaseScore
    expect(finalScore!.dimension_scores).toHaveLength(5);
    expect(finalScore!.overall).toBeGreaterThanOrEqual(1);
    expect(finalScore!.overall).toBeLessThanOrEqual(5);
    expect(finalScore!.strengths.length).toBeGreaterThan(0);
  });

  it("probes (does not advance) on a weak response, then advances on a strong one", async () => {
    let session: CaseSessionState = (await startCase(c)).session;
    session = (await respondToCase(c, session, ANSWERS.intro)).session;
    session = (await respondToCase(c, session, ANSWERS.clarification)).session;
    expect(session.fsm_state).toBe("framework");

    const weak = await respondToCase(c, session, "Um, I'm not sure — maybe look at costs.");
    expect(weak.decision.action).toBe("probe");
    expect(weak.stage).toBe("framework"); // stayed in the same stage

    const strong = await respondToCase(c, weak.session, ANSWERS.framework);
    expect(strong.decision.action).toBe("advance");
    expect(strong.stage).toBe("analysis");
  });

  it("evaluates one compound-turn remainder at the validated next stage", async () => {
    const clarification = {
      ...initSession("user-1", c.id),
      fsm_state: "clarification" as const,
    };
    const framework =
      "I would structure external demand and channel dynamics, internal brand and technology capability, and economics through costs, margins and payback.";

    const result = await respondToCase(c, clarification, framework, {
      transitionBeforeEvaluation: "framework",
    });

    expect(result.stage).toBe("analysis");
    expect(result.decision.action).toBe("advance");
    expect(result.session.history.filter((turn) => turn.role === "candidate")).toEqual([
      { role: "candidate", stage: "framework", text: framework },
    ]);
  });

  it("rejects compound transitions that skip the immediate next FSM stage", async () => {
    const clarification = {
      ...initSession("user-1", c.id),
      fsm_state: "clarification" as const,
    };

    await expect(respondToCase(c, clarification, ANSWERS.framework, {
      transitionBeforeEvaluation: "analysis",
    })).rejects.toThrow("Invalid Case stage transition: clarification -> analysis");
  });

  it("advances a semantically complete Diconsa Framework through the same runner", async () => {
    const frameworkSession = {
      ...initSession("user-1", dc.id),
      fsm_state: "framework" as const,
    };
    const answer =
      "I would structure three branches: rural-recipient access, travel time and security; value to government, the bank and Diconsa through lower administration cost and store traffic; and operational feasibility including capacity, fraud and decentralized control.";

    const result = await respondToCase(dc, frameworkSession, answer);

    expect(result.decision.action).toBe("advance");
    expect(result.stage).toBe("analysis");
  });

  it("keeps an incomplete Diconsa Framework in-stage", async () => {
    const frameworkSession = {
      ...initSession("user-1", dc.id),
      fsm_state: "framework" as const,
    };

    const result = await respondToCase(
      dc,
      frameworkSession,
      "I would structure two branches: rural-recipient access and travel time; operational feasibility, capacity and fraud risk.",
    );

    expect(result.decision.action).toBe("probe");
    expect(result.stage).toBe("framework");
  });

  it("never skips scoring — completion only happens in the scoring state", async () => {
    let session: CaseSessionState = (await startCase(c)).session;
    let guard = 0;
    while (guard++ < 25) {
      const res = await respondToCase(c, session, ANSWERS[session.fsm_state]);
      session = res.session;
      if (res.complete) {
        expect(res.stage).toBe("scoring");
        break;
      }
      expect(res.stage).not.toBe("scoring");
    }
    expect(session.fsm_state).toBe("scoring");
  });
});
