import { NextRequest, NextResponse } from "next/server";
import { authorizeVapi } from "@/lib/voice/vapi";

/**
 * The Case assistant now uses the deterministic custom-LLM endpoint. Keep this
 * authenticated tombstone so a stale submit_case_answer tool cannot mutate an
 * active Case session.
 */
export async function POST(req: NextRequest) {
  const unauthorized = authorizeVapi(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json(
    { error: "legacy_case_tool_disabled" },
    { status: 410 },
  );
}
