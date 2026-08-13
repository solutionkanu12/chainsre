/**
 * Test-only client factories for the integration suite.
 *
 * `dbClient(jwt)` returns a `@supabase/postgrest-js` `PostgrestClient`
 * pointed directly at the local PostgREST instance's root URL (no `/rest/v1`
 * prefix — that prefix is Kong's, not PostgREST's, so a bare PostgREST
 * instance serves its API at `/`). `PostgrestClient` structurally satisfies
 * `DbClient` (`{ from }`) from `../../../src/client`, so repository
 * functions run through the SAME query-building code path
 * `@supabase/supabase-js`'s `SupabaseClient.from()` uses in production —
 * these tests exercise the real repositories, not a stand-in.
 */
import { Client as PgClient } from 'pg';
import { PostgrestClient } from '@supabase/postgrest-js';

import type { DbClient } from '../../../src/client';
import { adminConnectionString, JWT_SECRET, POSTGREST_URL } from './env';
import { anonJwt, authenticatedJwt, serviceRoleJwt } from './jwt';

export function dbClient(jwt?: string): DbClient {
  return new PostgrestClient(POSTGREST_URL, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
}

export function anonClient(): DbClient {
  return dbClient(anonJwt(JWT_SECRET));
}

export function authenticatedClient(userId: string): DbClient {
  return dbClient(authenticatedJwt(JWT_SECRET, userId));
}

export function serviceRoleClient(): DbClient {
  return dbClient(serviceRoleJwt(JWT_SECRET));
}

/**
 * A raw superuser Postgres connection, for test fixture setup/teardown only
 * (e.g. seeding `auth.users`/`organizations` rows before exercising RLS).
 * Never used by a repository function or by application code — production
 * code only ever talks to Postgres through PostgREST.
 */
export async function withAdminClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({ connectionString: adminConnectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
