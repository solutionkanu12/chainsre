import { InvalidStateTransitionError, RepositoryError, type DbClient } from '../client';
import type { Incident, IncidentSeverity, IncidentState } from '../types';

export interface CreateIncidentInput {
  run_id: string;
  intent_id?: string | null;
  severity?: IncidentSeverity;
  expected?: Record<string, unknown> | null;
  actual?: Record<string, unknown> | null;
  mismatch_fields: string[];
  action_tx_hash?: string | null;
}

export async function createIncident(db: DbClient, input: CreateIncidentInput): Promise<Incident> {
  const { data, error } = await db
    .from('incidents')
    .insert({
      run_id: input.run_id,
      intent_id: input.intent_id ?? null,
      severity: input.severity ?? 'critical',
      expected: input.expected ?? null,
      actual: input.actual ?? null,
      mismatch_fields: input.mismatch_fields,
      action_tx_hash: input.action_tx_hash ?? null,
    })
    .select('*')
    .maybeSingle();
  if (error || !data) throw new RepositoryError('failed to create incident', error);
  return data as Incident;
}

export async function getIncident(db: DbClient, id: string): Promise<Incident | null> {
  const { data, error } = await db.from('incidents').select('*').eq('id', id).maybeSingle();
  if (error) throw new RepositoryError('failed to read incident', error);
  return data as Incident | null;
}

export interface AcquireContainmentLockResult {
  /** True only for the ONE caller that actually won the lock. */
  acquired: boolean;
  incident: Incident;
}

/**
 * Acquire the one-time containment lock for an incident.
 *
 * Implemented as a single atomic `UPDATE ... WHERE id = ? AND
 * containment_locked_at IS NULL`. Postgres takes a row lock to perform this
 * UPDATE, so under any concurrent execution — two guardian-trigger attempts
 * racing, or the same caller retrying after a timeout — at most one UPDATE
 * can ever observe `containment_locked_at IS NULL` and succeed; every other
 * attempt (before or after) sees a non-null value and updates zero rows.
 * There is no window for two callers to both "win".
 */
export async function acquireContainmentLock(
  db: DbClient,
  incidentId: string,
  lockedBy: string,
): Promise<AcquireContainmentLockResult> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('incidents')
    .update({
      containment_locked_at: now,
      containment_locked_by: lockedBy,
      containment_started_at: now,
      state: 'containment_queued',
    })
    .eq('id', incidentId)
    .is('containment_locked_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to acquire containment lock', error);
  if (data) {
    return { acquired: true, incident: data as Incident };
  }

  const current = await getIncident(db, incidentId);
  if (!current) throw new RepositoryError(`incident ${incidentId} not found`);
  return { acquired: false, incident: current };
}

const INCIDENT_TRANSITIONS: Readonly<Record<IncidentState, readonly IncidentState[]>> = {
  detected: ['containment_queued'],
  containment_queued: ['containment_running', 'containment_failed'],
  containment_running: ['containment_confirmed', 'containment_failed'],
  containment_confirmed: ['state_verified', 'containment_failed'],
  state_verified: ['contained'],
  contained: [],
  containment_failed: ['containment_queued'], // controlled operator retry (PRD §13)
};

function predecessorsOf(to: IncidentState): IncidentState[] {
  return (Object.keys(INCIDENT_TRANSITIONS) as IncidentState[]).filter((from) =>
    INCIDENT_TRANSITIONS[from].includes(to),
  );
}

export interface TransitionIncidentPatch {
  guardian_execution_id?: string | null;
  contained_at?: string | null;
  containment_latency_ms?: number | null;
}

/** Atomically move an incident's state, guarded the same way as {@link acquireContainmentLock}. */
export async function transitionIncidentState(
  db: DbClient,
  id: string,
  to: IncidentState,
  patch: TransitionIncidentPatch = {},
): Promise<Incident> {
  const validFrom = predecessorsOf(to);
  if (validFrom.length === 0) {
    throw new InvalidStateTransitionError(id, to);
  }

  const { data, error } = await db
    .from('incidents')
    .update({ state: to, ...patch })
    .eq('id', id)
    .in('state', validFrom)
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to transition incident', error);
  if (data) return data as Incident;

  const current = await getIncident(db, id);
  throw new InvalidStateTransitionError(id, to, current?.state);
}
