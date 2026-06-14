import { NextRequest, NextResponse } from "next/server";
import { mockCase, MOCK_USER_ID } from "@/lib/__mocks__/fixtures";
import { getStage, initSession, step, type TurnDecision } from "@/lib/fsm/case-fsm";
import type { CaseRecord, CaseSessionState } from "@/lib/types";

// Strength heuristic for mock mode — a real judgement comes from Claude scoring (Module 3).
function judgeStrong(answer: string): boolean {
  const a = (answer ?? "").trim();
  return (
    a.length >= 60 &&
    /(because|therefore|first|second|hypothesis|estimate|%|\$|€|driver|recommend|framework)/i.test(a)
  );
}

function interviewerLine(
  c: CaseRecord,
  d: TurnDecision,
  prior: CaseSessionState,
): { text: string; exhibit?: unknown } {
  if (d.action === "reveal") {
    const ex = c.exhibits.find((e) => e.id === d.exhibitToReveal);
    return { text: `Here is some data — ${ex?.title ?? "an exhibit"}. What do you take from it?`, exhibit: ex ?? null };
  }
  if (d.action === "hint") {
    const cur = getStage(c, prior.fsm_state);
    return { text: cur?.hint_ladder?.[d.hintIndex ?? 0] ?? "Let me give you a nudge." };
  }
  if (d.action === "probe" || d.action === "redirect") {
    const cur = getStage(c, prior.fsm_state);
    const probes = cur?.probe_bank ?? [];
    const idx = (prior.stage_attempts[prior.fsm_state] ?? 0) % Math.max(1, probes.length);
    return { text: probes[idx] ?? "Can you go a level deeper?" };
  }
  // advance
  const stage = getStage(c, d.nextState);
  return { text: stage?.interviewer_prompt ?? "Let's continue." };
}

// POST /api/case
//   { action: "start", caseId }                      -> new session + opening prompt
//   { action: "respond", caseId, session, answer }   -> next interviewer move + updated session
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action: string = body.action ?? "start";
  const c = mockCase(body.caseId || "beautify");
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  if (action === "start") {
    const session = initSession(MOCK_USER_ID, c.id);
    const intro = getStage(c, "intro");
    return NextResponse.json({
      session,
      interviewer: { text: c.prompt ?? intro?.interviewer_prompt ?? "Let's begin." },
      stage: session.fsm_state,
      complete: false,
    });
  }

  // action === "respond"
  const prior: CaseSessionState = body.session ?? initSession(MOCK_USER_ID, c.id);
  const strong = judgeStrong(body.answer);
  const { decision, session } = step(c, prior, strong);
  const interviewer = interviewerLine(c, decision, prior);

  return NextResponse.json({
    session,
    decision,
    interviewer,
    stage: session.fsm_state,
    complete: session.fsm_state === "scoring",
  });
}
