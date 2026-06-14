import { NextRequest, NextResponse } from "next/server";
import { mockCase, MOCK_USER_ID } from "@/lib/__mocks__/fixtures";
import { initSession } from "@/lib/fsm/case-fsm";
import { respondToCase, startCase } from "@/lib/fsm/case-runner";
import type { CaseSessionState } from "@/lib/types";

// POST /api/case
//   { action: "start", caseId }                      -> new session + opening prompt + intro context
//   { action: "respond", caseId, session, answer }   -> evaluation + interviewer move + (final score)
//
// The case content is authored (loaded from /context via mockCase); evaluation and
// scoring run real (Haiku) when credentials are set and deterministic heuristics
// otherwise. All orchestration lives in lib/fsm/case-runner so the route stays thin.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action: string = body.action ?? "start";
  const c = mockCase(body.caseId || "beautify");
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  if (action === "start") {
    return NextResponse.json(await startCase(c, MOCK_USER_ID));
  }

  // action === "respond"
  const prior: CaseSessionState = body.session ?? initSession(MOCK_USER_ID, c.id);
  return NextResponse.json(await respondToCase(c, prior, body.answer ?? ""));
}
