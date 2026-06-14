/**
 * Supabase client + auth helpers. Returns an in-process mock when credentials are
 * absent so the app runs cred-free. Real SSR/cookie auth wiring lands with the auth UI.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMocks } from "@/lib/config";
import { mockSupabase } from "@/lib/__mocks__/supabase";

/** Anon client (RLS-scoped to the signed-in user). */
export function supabaseAnon(): SupabaseClient {
  if (useMocks()) return mockSupabase() as unknown as SupabaseClient;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Service-role client (bypasses RLS) — server only, e.g. seeding shared `cases`. */
export function supabaseService(): SupabaseClient {
  if (useMocks()) return mockSupabase() as unknown as SupabaseClient;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Current user id, or null. Mock mode returns a stable mock user. */
export async function getUser(): Promise<{ id: string } | null> {
  const { data } = await supabaseAnon().auth.getUser();
  return data?.user ? { id: data.user.id } : null;
}
