import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  acquireContainmentLock,
  createDemoRun,
  createExecution,
  createIncident,
  type DbClient,
} from '../../src/index';
import { serviceRoleClient } from './support/client';

/**
 * The Phase 4 gate, proven against a real Postgres + PostgREST instance
 * running the actual migrations: duplicate KeeperHub executions and
 * duplicate containment cannot be stored.
 */
describe('duplicate-execution and duplicate-containment guarantees', () => {
  let db: DbClient;

  beforeAll(() => {
    db = serviceRoleClient();
  });

  async function freshRun() {
    return createDemoRun(db, {
      mode: 'protected_attack',
      vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
      started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
    });
  }

  it('a second createExecution with the same idempotency_key returns the SAME row, not a new one', async () => {
    const run = await freshRun();
    const idempotencyKey = `chainsre:${randomUUID()}:commit`;

    const first = await createExecution(db, {
      run_id: run.id,
      kind: 'commit',
      idempotency_key: idempotencyKey,
      function_name: 'commitIntent',
      function_args: ['0xdead'],
    });
    expect(first.alreadyExisted).toBe(false);

    const second = await createExecution(db, {
      run_id: run.id,
      kind: 'commit',
      idempotency_key: idempotencyKey,
      function_name: 'commitIntent',
      function_args: ['0xdead'],
    });
    expect(second.alreadyExisted).toBe(true);
    expect(second.execution.id).toBe(first.execution.id);

    // Independently confirm only one row exists for this key.
    const { data, error } = await db
      .from('executions')
      .select('id')
      .eq('idempotency_key', idempotencyKey);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('ten concurrent createExecution calls with the same key produce exactly one row', async () => {
    const run = await freshRun();
    const idempotencyKey = `chainsre:${randomUUID()}:mint`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        createExecution(db, {
          run_id: run.id,
          kind: 'action',
          idempotency_key: idempotencyKey,
          function_name: 'mintShares',
          function_args: [],
        }),
      ),
    );

    const uniqueIds = new Set(results.map((r) => r.execution.id));
    expect(uniqueIds.size).toBe(1);
    expect(results.filter((r) => r.alreadyExisted).length).toBeGreaterThanOrEqual(9);

    const { data, error } = await db
      .from('executions')
      .select('id')
      .eq('idempotency_key', idempotencyKey);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('a second acquireContainmentLock on the same incident is rejected', async () => {
    const run = await freshRun();
    const incident = await createIncident(db, {
      run_id: run.id,
      mismatch_fields: ['shares'],
    });

    const first = await acquireContainmentLock(db, incident.id, 'guardian-service-1');
    expect(first.acquired).toBe(true);
    expect(first.incident.containment_locked_by).toBe('guardian-service-1');

    const second = await acquireContainmentLock(db, incident.id, 'guardian-service-2');
    expect(second.acquired).toBe(false);
    // The lock stays with whoever won it first — a second, different caller
    // does not steal or overwrite it.
    expect(second.incident.containment_locked_by).toBe('guardian-service-1');

    const { data, error } = await db
      .from('incidents')
      .select('containment_locked_by')
      .eq('id', incident.id)
      .single();
    expect(error).toBeNull();
    expect(data?.containment_locked_by).toBe('guardian-service-1');
  });

  it('ten concurrent containment-lock attempts on one incident: exactly one wins', async () => {
    const run = await freshRun();
    const incident = await createIncident(db, {
      run_id: run.id,
      mismatch_fields: ['receiver'],
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        acquireContainmentLock(db, incident.id, `guardian-${i}`),
      ),
    );

    expect(results.filter((r) => r.acquired).length).toBe(1);
  });
});
