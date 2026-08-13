import { PG_ERROR, RepositoryError, pgErrorCode, type DbClient } from '../client';
import type { IncidentEvent } from '../types';

export interface AppendIncidentEventInput {
  type: string;
  status: string;
  message?: string | null;
  evidence?: Record<string, unknown> | null;
}

function jitterMs(attempt: number): number {
  // Small random backoff, growing gently with attempt count, so N concurrent
  // appenders that all collided on the same sequence don't immediately
  // re-collide on the retry too (a fixed/zero delay makes that likely).
  return Math.round(5 * attempt + Math.random() * 20);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Append one entry to an incident's timeline.
 *
 * `incident_events` has no UPDATE/DELETE path at all — see the
 * `forbid_incident_event_mutation` trigger in the migration, which fires for
 * every role including `service_role` — so this repository exposes no
 * update/delete function; appending is the only operation.
 *
 * `sequence` is assigned as "one more than the current max for this
 * incident". Two concurrent appends could compute the same next sequence;
 * `unique (incident_id, sequence)` makes every loser's insert fail with
 * `23505`, and this function retries — with a little jittered backoff, so a
 * pile of simultaneous appenders don't all immediately re-collide — rather
 * than losing the event. Bounded at `maxAttempts`, never unbounded.
 */
export async function appendIncidentEvent(
  db: DbClient,
  incidentId: string,
  input: AppendIncidentEventInput,
  maxAttempts = 10,
): Promise<IncidentEvent> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: last, error: readError } = await db
      .from('incident_events')
      .select('sequence')
      .eq('incident_id', incidentId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) throw new RepositoryError('failed to read incident event sequence', readError);

    const nextSequence = ((last as { sequence: number } | null)?.sequence ?? 0) + 1;

    const { data, error } = await db
      .from('incident_events')
      .insert({
        incident_id: incidentId,
        sequence: nextSequence,
        type: input.type,
        status: input.status,
        message: input.message ?? null,
        evidence: input.evidence ?? null,
      })
      .select('*')
      .maybeSingle();

    if (!error && data) return data as IncidentEvent;

    lastError = error;
    if (pgErrorCode(error) !== PG_ERROR.UNIQUE_VIOLATION) {
      throw new RepositoryError('failed to append incident event', error);
    }
    // Unique violation on (incident_id, sequence): a concurrent append won
    // this sequence number first. Back off briefly and recompute.
    if (attempt < maxAttempts) await sleep(jitterMs(attempt));
  }
  throw new RepositoryError(
    `failed to append incident event after ${maxAttempts} attempts (sequence contention)`,
    lastError,
  );
}

export async function listIncidentEvents(
  db: DbClient,
  incidentId: string,
): Promise<IncidentEvent[]> {
  const { data, error } = await db
    .from('incident_events')
    .select('*')
    .eq('incident_id', incidentId)
    .order('sequence', { ascending: true });
  if (error) throw new RepositoryError('failed to list incident events', error);
  return (data ?? []) as IncidentEvent[];
}
