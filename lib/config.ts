/**
 * Central config + mock-mode detection. The app runs fully on mocks when core
 * credentials are absent, so `npm run dev` / `npm test` work with no real keys.
 */
import { MODEL_IDS, type ModelMode } from "@/lib/types";

export function modelMode(): ModelMode {
  return process.env.SYNTHESIS_MODEL_MODE === "demo" ? "demo" : "default";
}

/** Active Claude model id (locked: Haiku default, Sonnet demo). */
export function activeModel(): string {
  return MODEL_IDS[modelMode()];
}

export function hasAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function hasSupabase(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** True when the app should use in-process mocks instead of live services. */
export function useMocks(): boolean {
  if (process.env.SYNTHESIS_USE_MOCKS === "false") return false;
  if (process.env.SYNTHESIS_USE_MOCKS === "true") return true;
  return !(hasAnthropic() && hasSupabase());
}

/** Real local embeddings on only when explicitly enabled (and the optional dep is installed). */
export function embeddingsEnabled(): boolean {
  return process.env.EMBEDDINGS_ENABLED === "true";
}

export function embeddingsModel(): string {
  return process.env.EMBEDDINGS_MODEL || "Xenova/bge-small-en-v1.5";
}
