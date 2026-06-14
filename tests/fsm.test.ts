import { describe, it, expect } from "vitest";
import {
  decide,
  applyDecision,
  nextState,
  initSession,
  step,
  pendingExhibits,
} from "@/lib/fsm/case-fsm";
import beautify from "@/context/cases/beautify.json";
import type { CaseRecord } from "@/lib/types";

const c = beautify as unknown as CaseRecord;

describe("case FSM", () => {
  it("advances on a strong response", () => {
    const d = decide("framework", { attempts: 0, strong: true, hintsUsed: 0, pendingExhibits: [] });
    expect(d.action).toBe("advance");
    expect(d.nextState).toBe("analysis");
  });

  it("probes then redirects on weak responses (max 2 per state)", () => {
    expect(decide("framework", { attempts: 0, strong: false, hintsUsed: 0, pendingExhibits: [] }).action).toBe("probe");
    expect(decide("framework", { attempts: 1, strong: false, hintsUsed: 0, pendingExhibits: [] }).action).toBe("redirect");
  });

  it("gives graduated hints after 2 failed attempts, then advances when the ladder is exhausted", () => {
    expect(decide("framework", { attempts: 2, strong: false, hintsUsed: 0, pendingExhibits: [] })).toMatchObject({ action: "hint", hintIndex: 0 });
    expect(decide("framework", { attempts: 2, strong: false, hintsUsed: 1, pendingExhibits: [] })).toMatchObject({ action: "hint", hintIndex: 1 });
    expect(decide("framework", { attempts: 2, strong: false, hintsUsed: 2, pendingExhibits: [] })).toMatchObject({ action: "hint", hintIndex: 2 });
    expect(decide("framework", { attempts: 2, strong: false, hintsUsed: 3, pendingExhibits: [] }).action).toBe("advance");
  });

  it("drips one exhibit per data_reveal entry", () => {
    const d = decide("data_reveal", { attempts: 0, strong: true, hintsUsed: 0, pendingExhibits: ["a", "b"] });
    expect(d.action).toBe("reveal");
    expect(d.exhibitToReveal).toBe("a");
  });

  it("never skips scoring", () => {
    expect(nextState("recommendation")).toBe("scoring");
    expect(nextState("scoring")).toBeNull();
    const d = decide("scoring", { attempts: 0, strong: true, hintsUsed: 0, pendingExhibits: [] });
    expect(d.nextState).toBe("scoring");
  });

  it("applyDecision increments counters and advances state", () => {
    let s = initSession("u", "beautify");
    s = applyDecision(s, { action: "probe", nextState: "intro" });
    expect(s.stage_attempts.intro).toBe(1);
    s = applyDecision(s, { action: "hint", nextState: "intro", hintIndex: 0 });
    expect(s.hints_used.intro).toBe(1);
    s = applyDecision(s, { action: "advance", nextState: "clarification" });
    expect(s.fsm_state).toBe("clarification");
  });

  it("step() reveals both beautify exhibits across two data_reveal turns", () => {
    const s = { ...initSession("u", "beautify"), fsm_state: "data_reveal" as const };
    expect(pendingExhibits(c, "data_reveal", []).length).toBe(2);
    const r1 = step(c, s, true);
    expect(r1.decision.action).toBe("reveal");
    expect(r1.session.exhibits_revealed.length).toBe(1);
    const r2 = step(c, r1.session, true);
    expect(r2.decision.action).toBe("reveal");
    expect(r2.session.exhibits_revealed.length).toBe(2);
    // Once exhibits are exhausted, a strong response advances out of data_reveal.
    const r3 = step(c, r2.session, true);
    expect(r3.decision.action).toBe("advance");
    expect(r3.session.fsm_state).toBe("pressure_test");
  });
});
