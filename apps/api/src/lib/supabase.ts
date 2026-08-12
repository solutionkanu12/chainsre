/**
 * Supabase server-client factory. Phase 1 wires the foundation without
 * requiring it to boot: if Supabase env vars are absent, the API still runs
 * (health check, etc.) and any route that needs the DB fails explicitly.
 *
 * The service-role client bypasses RLS and must NEVER be exposed to the
 * browser — it lives only in the API process.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ApiEnv } from '../config/env';

export interface SupabaseClients {
  /** Anonymous client (RLS enforced). Present only when anon config exists. */
  anon: SupabaseClient | null;
  /** Service-role client (RLS bypassed). Present only when service config exists. */
  service: SupabaseClient | null;
}

export function createSupabaseClients(env: ApiEnv): SupabaseClients {
  const anon =
    env.SUPABASE_URL && env.SUPABASE_ANON_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  const service =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;

  return { anon, service };
}
