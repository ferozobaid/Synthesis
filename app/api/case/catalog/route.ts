import { NextResponse } from "next/server";
import { PREVIEW_LLM_CASES } from "@/lib/voice/case-catalog";

/**
 * Read-only catalog of the two selectable Preview LLM cases. Returns ONLY id,
 * title, and description — never prompts, facts, exhibits, calculations, or
 * hidden material. The Case Voice UI always presents exactly these two cases;
 * there is no legacy Case UI mode.
 */
export async function GET() {
  return NextResponse.json({
    cases: PREVIEW_LLM_CASES.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
    })),
  });
}
