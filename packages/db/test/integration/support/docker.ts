/**
 * Minimal Docker lifecycle helpers for the integration test harness. Spins up
 * plain `postgres` and `postgrest/postgrest` containers on a dedicated
 * network — no docker-compose, no Supabase CLI — so the only external
 * dependency is a working Docker daemon.
 *
 * Every wait here is bounded (fixed attempt count and per-attempt timeout,
 * same "no unbounded retry" rule the rest of this codebase follows); a
 * daemon that never becomes ready fails the setup with a clear error rather
 * than hanging the test run.
 */
import { execFileSync } from 'node:child_process';

import {
  JWT_SECRET,
  NETWORK_NAME,
  POSTGRES_CONTAINER,
  POSTGRES_DB,
  POSTGRES_PASSWORD,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGREST_CONTAINER,
  POSTGREST_PORT,
  POSTGREST_URL,
} from './env';

function docker(
  args: string[],
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      // `docker run` needs headroom to pull an image on a cold cache; other
      // commands (rm/network) are near-instant and use the default.
      timeout: options.timeoutMs ?? 30_000,
    });
  } catch (err) {
    if (options.allowFailure) return '';
    throw new Error(
      `docker ${args.join(' ')} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Bounded pull with room for a cold cache, run before `docker run` so a slow pull surfaces its own clear error. */
function pull(image: string): void {
  docker(['pull', image], { timeoutMs: 180_000 });
}

export function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { timeout: 10_000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Remove any leftover containers/network from a previous interrupted run. */
export function cleanupLeftovers(): void {
  docker(['rm', '-f', POSTGRES_CONTAINER], { allowFailure: true });
  docker(['rm', '-f', POSTGREST_CONTAINER], { allowFailure: true });
  docker(['network', 'rm', NETWORK_NAME], { allowFailure: true });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  label: string,
  attempt: () => boolean | Promise<boolean>,
  { attempts = 30, delayMs = 1000 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    if (await attempt()) return;
    if (i < attempts) await sleep(delayMs);
  }
  throw new Error(`timed out waiting for ${label} after ${attempts} attempts`);
}

export function startPostgres(): void {
  docker(['network', 'create', NETWORK_NAME]);
  pull('postgres:16-alpine');
  docker(
    [
      'run',
      '-d',
      '--name',
      POSTGRES_CONTAINER,
      '--network',
      NETWORK_NAME,
      '--network-alias',
      'postgres',
      '-p',
      `${POSTGRES_PORT}:5432`,
      '-e',
      `POSTGRES_USER=${POSTGRES_USER}`,
      '-e',
      `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
      '-e',
      `POSTGRES_DB=${POSTGRES_DB}`,
      'postgres:16-alpine',
    ],
    { timeoutMs: 60_000 },
  );
}

export async function waitForPostgres(): Promise<void> {
  await waitUntil(
    'postgres readiness',
    () => {
      try {
        execFileSync(
          'docker',
          ['exec', POSTGRES_CONTAINER, 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
          { stdio: 'ignore', timeout: 5000 },
        );
        return true;
      } catch {
        return false;
      }
    },
    { attempts: 30, delayMs: 1000 },
  );
}

export function startPostgrest(): void {
  const dbUri = `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`;
  pull('postgrest/postgrest:latest');
  docker(
    [
      'run',
      '-d',
      '--name',
      POSTGREST_CONTAINER,
      '--network',
      NETWORK_NAME,
      '-p',
      `${POSTGREST_PORT}:3000`,
      '-e',
      `PGRST_DB_URI=${dbUri}`,
      '-e',
      'PGRST_DB_SCHEMAS=public',
      '-e',
      'PGRST_DB_ANON_ROLE=anon',
      '-e',
      `PGRST_JWT_SECRET=${JWT_SECRET}`,
      // PGRST_JWT_ROLE_CLAIM_KEY defaults to ".role" already, which is what
      // the anon/authenticated/service_role JWTs use — no need to set it.
      'postgrest/postgrest:latest',
    ],
    { timeoutMs: 60_000 },
  );
}

export async function waitForPostgrest(): Promise<void> {
  await waitUntil(
    'postgrest readiness',
    async () => {
      try {
        const res = await fetch(POSTGREST_URL, { method: 'GET' });
        return res.status < 500;
      } catch {
        return false;
      }
    },
    { attempts: 30, delayMs: 1000 },
  );
}

export function teardown(): void {
  cleanupLeftovers();
}
