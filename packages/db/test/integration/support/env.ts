/**
 * Fixed, shared constants for the local Postgres+PostgREST integration
 * harness. Deliberately not read from `process.env`: this is throwaway,
 * ephemeral infrastructure that the global setup starts and tears down once
 * per test run, and both the setup and the test files need to agree on the
 * same values without any inter-process handoff.
 *
 * `JWT_SECRET` is not a real credential — it signs tokens for a Postgres
 * container that exists only for the duration of one test run and is
 * destroyed afterward. It intentionally does not resemble a real KeeperHub
 * or Supabase key so nothing here could be mistaken for a leaked secret.
 */

export const CONTAINER_PREFIX = 'chainsre-db-test';
export const NETWORK_NAME = `${CONTAINER_PREFIX}-net`;
export const POSTGRES_CONTAINER = `${CONTAINER_PREFIX}-postgres`;
export const POSTGREST_CONTAINER = `${CONTAINER_PREFIX}-postgrest`;

export const POSTGRES_PORT = 55_432;
export const POSTGREST_PORT = 55_433;

export const POSTGRES_USER = 'postgres';
export const POSTGRES_PASSWORD = 'chainsre-test-only-not-a-real-credential';
export const POSTGRES_DB = 'postgres';

export const POSTGREST_URL = `http://127.0.0.1:${POSTGREST_PORT}`;
export const JWT_SECRET = 'chainsre-local-integration-test-jwt-secret-ephemeral-not-real';

export function adminConnectionString(): string {
  return `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}`;
}
