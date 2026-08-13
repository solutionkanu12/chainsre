import { InvalidStateTransitionError, RepositoryError, type DbClient } from '../client';
import { DEMO_RUN_TRANSITIONS, type DemoRun, type DemoRunMode, type DemoRunStatus } from '../types';

export interface CreateDemoRunInput {
  mode: DemoRunMode;
  vault_address: string;
  started_by: string;
  declared_amount?: string | null;
}

export async function createDemoRun(db: DbClient, input: CreateDemoRunInput): Promise<DemoRun> {
  const { data, error } = await db
    .from('demo_runs')
    .insert({
      mode: input.mode,
      vault_address: input.vault_address.toLowerCase(),
      started_by: input.started_by.toLowerCase(),
      declared_amount: input.declared_amount ?? null,
    })
    .select('*')
    .maybeSingle();
  if (error || !data) throw new RepositoryError('failed to create demo run', error);
  return data as DemoRun;
}

export async function getDemoRun(db: DbClient, id: string): Promise<DemoRun | null> {
  const { data, error } = await db.from('demo_runs').select('*').eq('id', id).maybeSingle();
  if (error) throw new RepositoryError('failed to read demo run', error);
  return data as DemoRun | null;
}

/** Every status that legally precedes `to` in the state machine. */
function predecessorsOf(to: DemoRunStatus): DemoRunStatus[] {
  return (Object.keys(DEMO_RUN_TRANSITIONS) as DemoRunStatus[]).filter((from) =>
    DEMO_RUN_TRANSITIONS[from].includes(to),
  );
}

export interface TransitionDemoRunPatch {
  executed_amount?: string | null;
  completed_at?: string | null;
}

/**
 * Atomically move a demo run to `to`, but only if its CURRENT status is a
 * legal predecessor of `to`. Implemented as a single `UPDATE ... WHERE id = ?
 * AND status IN (predecessors)` — the row lock that statement takes is what
 * makes this race-safe: two concurrent transition attempts can never both
 * succeed, because after the first commits the second's `status IN (...)`
 * predicate no longer matches.
 *
 * Throws {@link InvalidStateTransitionError} rather than silently no-op'ing
 * when the row doesn't exist or is not in a valid predecessor state.
 */
export async function transitionDemoRun(
  db: DbClient,
  id: string,
  to: DemoRunStatus,
  patch: TransitionDemoRunPatch = {},
): Promise<DemoRun> {
  const validFrom = predecessorsOf(to);
  if (validFrom.length === 0) {
    throw new InvalidStateTransitionError(id, to);
  }

  const { data, error } = await db
    .from('demo_runs')
    .update({ status: to, ...patch })
    .eq('id', id)
    .in('status', validFrom)
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to transition demo run', error);
  if (data) return data as DemoRun;

  const current = await getDemoRun(db, id);
  throw new InvalidStateTransitionError(id, to, current?.status);
}
