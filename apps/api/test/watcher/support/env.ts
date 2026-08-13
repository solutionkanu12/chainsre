/**
 * Fixed, shared constants for the local Postgres+PostgREST integration
 * harness used by the watcher's behavioral tests. Mirrors
 * `packages/db/test/integration/support/env.ts` — intentionally NOT shared
 * between the two packages, to avoid coupling two independently-gated test
 * suites — but with a different container prefix and different ports: root
 * `pnpm test` runs workspace filters (including `@chainsre/db` and
 * `@chainsre/api`) IN PARALLEL, so identical container names or host ports
 * would collide when both suites' Docker harnesses come up at once.
 *
 * `JWT_SECRET` is not a real credential — it signs tokens for a Postgres
 * container that exists only for the duration of one test run and is
 * destroyed afterward.
 */

export const CONTAINER_PREFIX = 'chainsre-api-test';
export const NETWORK_NAME = `${CONTAINER_PREFIX}-net`;
export const POSTGRES_CONTAINER = `${CONTAINER_PREFIX}-postgres`;
export const POSTGREST_CONTAINER = `${CONTAINER_PREFIX}-postgrest`;

export const POSTGRES_PORT = 55_434;
export const POSTGREST_PORT = 55_435;

export const POSTGRES_USER = 'postgres';
export const POSTGRES_PASSWORD = 'chainsre-test-only-not-a-real-credential';
export const POSTGRES_DB = 'postgres';

export const POSTGREST_URL = `http://127.0.0.1:${POSTGREST_PORT}`;
export const JWT_SECRET = 'chainsre-watcher-local-integration-test-jwt-secret-ephemeral-not-real';

export function adminConnectionString(): string {
  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`;
}
