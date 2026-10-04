/**
 * Supabase client factory.
 *
 * TWO clients, two purposes:
 *   anon     → Supabase Auth ONLY (OTP send/verify, password login, session
 *              validation). The anon key is public and safe here because the
 *              browser still never talks to Supabase directly — Express does.
 *   service  → the ONLY privileged path: DB writes (service_role bypasses
 *              RLS) and Auth admin operations (user provisioning).
 *
 * Browser-visible values (anon key) are never secrets; the service-role key
 * exists ONLY in .env / Railway dashboard — never in source, never bundled.
 */
import { createClient } from '@supabase/supabase-js';

export function createSupabaseClients(env) {
  const common = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, common);
  const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, common);
  return { anon, service };
}

/** Minimal structural guard so DI contract is obvious (tests inject fakes). */
export function isSupabaseLike(supabase) {
  return Boolean(supabase && supabase.anon && supabase.anon.auth && supabase.service && supabase.service.from);
}