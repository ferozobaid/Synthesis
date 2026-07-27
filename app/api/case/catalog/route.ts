import { NextResponse } from "next/server";
import {
  DIFFICULTY_DURATION_SECONDS,
  PREVIEW_LLM_CASES,
} from "@/lib/voice/case-catalog";

/**
 * Read-only catalog of the selectable Preview LLM cases. Returns ONLY id,
 * title, description, track/role UI-classification metadata, and the authored
 * difficulty with its derived maximum duration — never prompts, facts,
 * exhibits, calculations, or hidden material. There is no legacy Case UI mode.
 */
export async function GET() {
  return NextResponse.json({
    cases: PREVIEW_LLM_CASES.map((entry) => ({
      id: entry.id,
      title: entry.title,
      description: entry.description,
      track: entry.track,
      ...(entry.role ? { role: entry.role } : {}),
      difficultyStars: entry.difficultyStars,
      maxDurationSeconds: DIFFICULTY_DURATION_SECONDS[entry.difficultyStars],
    })),
  });
}
