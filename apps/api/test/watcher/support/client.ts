/**
 * Test-only client factories for the watcher's behavioral test suite.
 * Mirrors `packages/db/test/integration/support/client.ts`: `dbClient(jwt)`
 * returns a `@supabase/postgrest-js` `PostgrestClient` pointed at this
 * harness's own PostgREST instance (`./env`'s `POSTGREST_URL`), which
 * structurally satisfies `DbClient` from `@chainsre/db` — so the watcher
 * runs through the SAME repository functions (`createIncidentIfAbsent`,
 * `acquireContainmentLock`, etc.) it uses in production, against a real
 * database.
 */
import { Client as PgClient } from 'pg';
import { PostgrestClient } from '@supabase/postgrest-js';

import type { DbClient } from '@chainsre/db';

import { adminConnectionString, JWT_SECRET, POSTGREST_URL } from './env';
import { serviceRoleJwt } from './jwt';

export function dbClient(jwt?: string): DbClient {
  return new PostgrestClient(POSTGREST_URL, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
}

/**
 * The watcher's repository calls always run as the trusted backend
 * service — never end-user anon/authenticated roles — so tests exercise it
 * through the service-role client, matching how `watcher-run.ts` connects
 * in production.
 */
export function serviceRoleClient(): DbClient {
  return dbClient(serviceRoleJwt(JWT_SECRET));
}

/**
 * A raw superuser Postgres connection, for test fixture setup/teardown only
 * (e.g. seeding `enrollments`/`intents` rows before running a watcher tick).
 * Never used by watcher code itself — that only ever talks to Postgres
 * through PostgREST via `serviceRoleClient()`.
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
