/**
 * vitest `globalSetup`: brings up a real Postgres + PostgREST pair ONCE for
 * the whole watcher behavioral-test run, applies the Supabase-platform test
 * shim and the REAL migrations (`supabase/migrations/*.sql`, unmodified),
 * then grants table privileges. Mirrors
 * `packages/db/test/integration/global-setup.ts`, but against this
 * package's own `./support/env.ts` constants (different container names and
 * ports — `pnpm test` runs the `@chainsre/db` and `@chainsre/api` workspace
 * filters in parallel, so the two harnesses must never collide).
 *
 * Requires Docker. If the daemon is unreachable, setup fails fast with a
 * clear message rather than a cryptic connection-refused error deep in a
 * test file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { MIGRATIONS_DIR, listMigrationFiles } from '@chainsre/db';

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
 * See `packages/db/test/integration/global-setup.ts`'s identical helper for
 * why a fresh `Client` per attempt is required (the official `postgres`
 * image briefly listens then restarts during `initdb`; a connect landing in
 * that window gets `ECONNRESET`, and `pg`'s `Client` can't be reused after a
 * failed `connect()`).
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
      'Docker is required for apps/api watcher behavioral tests (test/watcher/*.behavior.test.ts) — ' +
        'the daemon is not reachable. Install/start Docker, or run only the pure-logic tests with: ' +
        'pnpm --filter @chainsre/api exec vitest run test/watcher/decode.test.ts test/watcher/comparator.test.ts',
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
