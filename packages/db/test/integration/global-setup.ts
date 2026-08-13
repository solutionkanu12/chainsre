/**
 * vitest `globalSetup`: brings up a real Postgres + PostgREST pair ONCE for
 * the whole `packages/db` test run, applies the Supabase-platform test shim
 * and the REAL migrations (`supabase/migrations/*.sql`, unmodified — this
 * proves the actual migrations apply cleanly, not a paraphrase of them), then
 * grants table privileges. Every integration test file talks to the same
 * running instance via `test/integration/support/env.ts`'s fixed constants.
 *
 * Requires Docker. If the daemon is unreachable, setup fails fast with a
 * clear message rather than a cryptic connection-refused error deep in a
 * test file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { MIGRATIONS_DIR, listMigrationFiles } from '../../src/index';
import { adminConnectionString } from './support/env';
import {
  cleanupLeftovers,
  dockerAvailable,
  startPostgres,
  startPostgrest,
  teardown as dockerTeardown,
  waitForPostgres,
  waitForPostgrest,
} from './support/docker';

function readSupportSql(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./support/${name}`, import.meta.url)), 'utf8');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The official `postgres` image's entrypoint runs a short-lived Unix-socket
 * server for `initdb`, shuts it down, then starts the real TCP-listening
 * server — `pg_isready` run *inside* the container (see
 * `./support/docker.ts`'s `waitForPostgres`) can observe "ready" during that
 * first phase, right before the fast-shutdown-and-restart. An external TCP
 * connect landing in that window gets `ECONNRESET`, not a clean
 * connection-refused. Retrying the connect itself (not just the readiness
 * probe) is what actually closes that window.
 *
 * A fresh `Client` is constructed per attempt: `pg`'s `Client.connect()`
 * throws "Client has already been connected" on a second call against the
 * SAME instance even after the first attempt failed, so the instance can't
 * be reused across retries.
 */
async function connectWithRetry(attempts = 10, delayMs = 1000): Promise<Client> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    const client = new Client({ connectionString: adminConnectionString() });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => undefined);
      if (i < attempts) await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function applyBootstrapSql(): Promise<void> {
  const client = await connectWithRetry();
  try {
    await client.query(readSupportSql('shim.sql'));

    // The REAL migrations, applied one file at a time in the same order
    // `supabase db push` would use — this is the actual "migrations apply
    // cleanly" proof, not a reimplementation of them. Reading each file
    // individually (rather than `readAllMigrations()`'s concatenated blob)
    // keeps a failure's error message pointing at the exact file.
    for (const fileName of listMigrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, fileName), 'utf8');
      try {
        await client.query(sql);
      } catch (err) {
        throw new Error(
          `migration ${fileName} failed to apply: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    await client.query(readSupportSql('grants.sql'));
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  if (!dockerAvailable()) {
    throw new Error(
      'Docker is required for packages/db integration tests (test/integration/**) — ' +
        'the daemon is not reachable. Install/start Docker, or run only the structural ' +
        'tests with: pnpm --filter @chainsre/db exec vitest run test/application-migration.test.ts test/migration.test.ts',
    );
  }

  cleanupLeftovers();
  startPostgres();
  await waitForPostgres();
  await applyBootstrapSql();
  startPostgrest();
  await waitForPostgrest();

  return async function teardown(): Promise<void> {
    dockerTeardown();
  };
}
