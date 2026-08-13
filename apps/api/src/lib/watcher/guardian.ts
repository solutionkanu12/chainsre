/**
 * Containment: acquire the Phase 4 one-time lock, trigger the real KeeperHub
 * guardian workflow, persist evidence, and independently verify `paused()`
 * before ever calling an incident "contained". An HTTP 2xx or a `completed`
 * KeeperHub status is not proof — only a fresh `eth_call` against the chain
 * is (`03-System-Architecture.md` §10).
 */
import type { Hex } from 'viem';

import {
  acquireContainmentLock,
  createExecution,
  recordExecutionOutcome,
  transitionIncidentState,
  type DbClient,
  type Incident,
} from '@chainsre/db';

import { readPaused } from '../chain';
import { buildIdempotencyKey, executeWorkflowSafely, type KeeperHubEnv } from '../keeperhub';
import type { ChainReader } from './types';

export interface ContainmentDeps {
  readonly db: DbClient;
  readonly keeperHubEnv: KeeperHubEnv;
  readonly chainClient: ChainReader;
  /** Overrides the `fetch` KeeperHub calls use — production omits this; tests inject a mock. */
  readonly fetchImpl?: typeof fetch;
}

export interface ContainIncidentResult {
  /** False when another caller already holds the lock — this call did nothing. */
  readonly attempted: boolean;
  /** True only once `paused()` was independently read back as `true`. */
  readonly contained: boolean;
  readonly incident: Incident;
}

/**
 * Drive one incident through containment. Idempotent to call more than once
 * for the same incident: only the FIRST caller to win {@link acquireContainmentLock}
 * does anything; every later call (a duplicate log re-triggering the same
 * incident, a retry, a second watcher instance) observes `attempted: false`
 * and returns the incident's current state untouched.
 *
 * Every failure mode short of a genuine infra fault (DB unreachable) is
 * handled by marking the incident `containment_failed` and returning
 * normally — never thrown — so one bad guardian run cannot crash a watcher
 * tick that has other events to process.
 */
export async function containIncident(
  deps: ContainmentDeps,
  incident: Incident,
  vaultAddress: Hex,
  guardianWorkflowId: string,
  runId: string,
  lockedBy = 'watcher',
): Promise<ContainIncidentResult> {
  const lock = await acquireContainmentLock(deps.db, incident.id, lockedBy);
  if (!lock.acquired) {
    return {
      attempted: false,
      contained: lock.incident.state === 'contained',
      incident: lock.incident,
    };
  }

  const idempotencyKey = buildIdempotencyKey(runId, 'pause');
  const { execution } = await createExecution(deps.db, {
    run_id: lock.incident.run_id,
    intent_id: lock.incident.intent_id,
    kind: 'guardian',
    idempotency_key: idempotencyKey,
    function_name: 'pause',
  });

  await transitionIncidentState(deps.db, incident.id, 'containment_running');

  const workflow = await executeWorkflowSafely(
    deps.keeperHubEnv,
    guardianWorkflowId,
    idempotencyKey,
    {},
    {
      fetchImpl: deps.fetchImpl,
    },
  ).catch((err: unknown) => err as Error);

  if (workflow instanceof Error) {
    await recordExecutionOutcome(deps.db, execution.id, {
      status: 'failed',
      error: workflow.message,
    }).catch(() => undefined);
    const failed = await transitionIncidentState(deps.db, incident.id, 'containment_failed');
    return { attempted: true, contained: false, incident: failed };
  }

  const nodeTx = workflow.transactionHashes[0];
  await recordExecutionOutcome(deps.db, execution.id, {
    provider_execution_id: workflow.executionId,
    status: 'completed',
    tx_hash: nodeTx?.hash ?? null,
    gas_used_wei: workflow.gasUsedWei ?? null,
  });

  await transitionIncidentState(deps.db, incident.id, 'containment_confirmed', {
    guardian_execution_id: workflow.executionId,
  });

  // The only step that can actually declare containment successful: read the
  // real chain state back, independent of anything KeeperHub reported.
  const pausedNow = await readPaused(deps.chainClient, vaultAddress).catch(() => false);
  if (!pausedNow) {
    const failed = await transitionIncidentState(deps.db, incident.id, 'containment_failed');
    return { attempted: true, contained: false, incident: failed };
  }

  const verified = await transitionIncidentState(deps.db, incident.id, 'state_verified');
  const containedAt = new Date();
  const containmentStart = new Date(verified.containment_started_at ?? verified.detected_at);
  const containmentLatencyMs = Math.max(0, containedAt.getTime() - containmentStart.getTime());

  const final = await transitionIncidentState(deps.db, incident.id, 'contained', {
    contained_at: containedAt.toISOString(),
    containment_latency_ms: containmentLatencyMs,
  });

  return { attempted: true, contained: true, incident: final };
}
