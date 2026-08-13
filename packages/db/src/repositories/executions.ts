import {
  InvalidStateTransitionError,
  PG_ERROR,
  RepositoryError,
  pgErrorCode,
  type DbClient,
} from '../client';
import type { Execution, ExecutionKind } from '../types';

export interface CreateExecutionInput {
  run_id: string;
  intent_id?: string | null;
  kind: ExecutionKind;
  /** `chainsre:{runId}:{step}` — the sole source of duplicate protection. */
  idempotency_key: string;
  function_name: string;
  function_args?: unknown[];
}

export interface CreateExecutionResult {
  execution: Execution;
  /** True when a row for this idempotency_key already existed. */
  alreadyExisted: boolean;
}

/**
 * Create an execution row, or — if `idempotency_key` was already used —
 * return the existing row instead of creating a duplicate.
 *
 * This is enforced by the database, not by an application-level
 * check-then-insert (which would race under concurrency): `executions.
 * idempotency_key` is `UNIQUE`, so two concurrent calls with the same key can
 * never both succeed at inserting. The loser's insert fails with Postgres
 * `23505 unique_violation`, which this function catches and turns into a
 * lookup of the winner's row — the caller always gets a row back, and it is
 * always the SAME row for the SAME key, regardless of which call "won".
 */
export async function createExecution(
  db: DbClient,
  input: CreateExecutionInput,
): Promise<CreateExecutionResult> {
  const { data, error } = await db
    .from('executions')
    .insert({
      run_id: input.run_id,
      intent_id: input.intent_id ?? null,
      kind: input.kind,
      idempotency_key: input.idempotency_key,
      function_name: input.function_name,
      function_args: input.function_args ?? [],
    })
    .select('*')
    .maybeSingle();

  if (!error && data) {
    return { execution: data as Execution, alreadyExisted: false };
  }

  if (pgErrorCode(error) === PG_ERROR.UNIQUE_VIOLATION) {
    const existing = await getExecutionByIdempotencyKey(db, input.idempotency_key);
    if (existing) {
      return { execution: existing, alreadyExisted: true };
    }
  }
  throw new RepositoryError('failed to create execution', error);
}

export async function getExecution(db: DbClient, id: string): Promise<Execution | null> {
  const { data, error } = await db.from('executions').select('*').eq('id', id).maybeSingle();
  if (error) throw new RepositoryError('failed to read execution', error);
  return data as Execution | null;
}

export async function getExecutionByIdempotencyKey(
  db: DbClient,
  idempotencyKey: string,
): Promise<Execution | null> {
  const { data, error } = await db
    .from('executions')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw new RepositoryError('failed to read execution by idempotency key', error);
  return data as Execution | null;
}

export interface RecordExecutionOutcomeInput {
  provider_execution_id?: string;
  status: 'completed' | 'failed';
  tx_hash?: string | null;
  tx_link?: string | null;
  block_number?: number | null;
  gas_used_wei?: string | null;
  error?: string | null;
  raw_receipt?: Record<string, unknown> | null;
}

/**
 * Record the terminal outcome of an execution. Atomic and guarded so a
 * completed/failed execution can never be silently overwritten by a stale,
 * late-arriving poll response — only `pending`/`running` rows accept this.
 */
export async function recordExecutionOutcome(
  db: DbClient,
  id: string,
  input: RecordExecutionOutcomeInput,
): Promise<Execution> {
  const { data, error } = await db
    .from('executions')
    .update({ ...input, completed_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'running'])
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to record execution outcome', error);
  if (data) return data as Execution;

  const current = await getExecution(db, id);
  throw new InvalidStateTransitionError(id, input.status, current?.status);
}

/** Mark an execution `running` once KeeperHub assigns a provider execution id. */
export async function markExecutionRunning(
  db: DbClient,
  id: string,
  providerExecutionId: string,
): Promise<Execution> {
  const { data, error } = await db
    .from('executions')
    .update({ status: 'running', provider_execution_id: providerExecutionId })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new RepositoryError('failed to mark execution running', error);
  if (data) return data as Execution;

  const current = await getExecution(db, id);
  throw new InvalidStateTransitionError(id, 'running', current?.status);
}
