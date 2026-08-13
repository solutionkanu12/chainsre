/**
 * The narrow client shape every repository depends on: only `.from(table)`,
 * the PostgREST query-builder entry point `@supabase/supabase-js` exposes.
 *
 * Repositories are typed against this structural interface rather than the
 * full `SupabaseClient` class so that:
 *   - production code passes the real `SupabaseClient` from
 *     `apps/api/src/lib/supabase.ts` (anon for public reads, service_role for
 *     writes) without any adapter, and
 *   - integration tests can pass a bare `@supabase/postgrest-js`
 *     `PostgrestClient` pointed directly at a local PostgREST instance —
 *     `SupabaseClient.from` is `PostgrestClient.from` under the hood, so both
 *     satisfy this type identically and the tests exercise the exact same
 *     query-building code the repositories use in production.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type DbClient = Pick<SupabaseClient, 'from'>;

/** Postgres error codes repositories branch on. */
export const PG_ERROR = {
  /** `unique_violation` — a `unique`/primary-key constraint was hit. */
  UNIQUE_VIOLATION: '23505',
} as const;

/** Narrow the `error` PostgREST/postgrest-js returns to its Postgres code, if present. */
export function pgErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export class RepositoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'RepositoryError';
  }
}

/** Thrown by a state-transition function when the current row state does not permit it. */
export class InvalidStateTransitionError extends RepositoryError {
  readonly id: string;
  readonly from: string | undefined;
  readonly to: string;
  constructor(id: string, to: string, from?: string) {
    super(`invalid state transition for ${id}: ${from ?? '(unknown current state)'} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.id = id;
    this.from = from;
    this.to = to;
  }
}
