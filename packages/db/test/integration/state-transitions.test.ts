import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  InvalidStateTransitionError,
  acquireContainmentLock,
  createDemoRun,
  createIncident,
  createIntent,
  markIntentCommitted,
  transitionDemoRun,
  transitionIncidentState,
  type DbClient,
} from '../../src/index';
import { serviceRoleClient } from './support/client';

describe('safe state transitions', () => {
  let db: DbClient;

  beforeAll(() => {
    db = serviceRoleClient();
  });

  async function freshRun() {
    return createDemoRun(db, {
      mode: 'normal',
      vault_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
      started_by: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
    });
  }

  describe('demo_runs', () => {
    it('allows the legal path created -> planning -> committing -> committed', async () => {
      const run = await freshRun();
      expect(run.status).toBe('created');

      const a = await transitionDemoRun(db, run.id, 'planning');
      expect(a.status).toBe('planning');
      const b = await transitionDemoRun(db, run.id, 'committing');
      expect(b.status).toBe('committing');
      const c = await transitionDemoRun(db, run.id, 'committed');
      expect(c.status).toBe('committed');
    });

    it('rejects skipping a state (created -> committed directly)', async () => {
      const run = await freshRun();
      await expect(transitionDemoRun(db, run.id, 'committed')).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
      // The row must be unchanged.
      const { data } = await db.from('demo_runs').select('status').eq('id', run.id).single();
      expect(data?.status).toBe('created');
    });

    it('rejects transitioning out of a terminal state', async () => {
      const run = await freshRun();
      await transitionDemoRun(db, run.id, 'planning_failed');
      await expect(transitionDemoRun(db, run.id, 'planning')).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('rejects transitioning a non-existent run', async () => {
      await expect(transitionDemoRun(db, randomUUID(), 'planning')).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('only one of two concurrent attempts at the SAME transition wins', async () => {
      // Note: racing two DIFFERENT target states (e.g. 'planning' vs.
      // 'planning_failed') is not a valid test of mutual exclusion here —
      // 'planning_failed' is a legal predecessor-of-itself-adjacent state
      // reachable from BOTH 'created' and 'planning' by design (a run can
      // fail either before or during planning), so both could legitimately
      // succeed in sequence. Racing the identical transition twice is
      // unambiguous: a state can never be its own predecessor.
      const run = await freshRun();
      const [a, b] = await Promise.allSettled([
        transitionDemoRun(db, run.id, 'planning'),
        transitionDemoRun(db, run.id, 'planning'),
      ]);
      const succeeded = [a, b].filter((r) => r.status === 'fulfilled');
      const failed = [a, b].filter((r) => r.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
    });
  });

  describe('intents', () => {
    async function freshIntent(runId: string) {
      return createIntent(db, {
        run_id: runId,
        agent_address: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
        chain_id: 84532,
        target_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
        selector: '0xdd10f8ca',
        params: {
          receiver: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
          shares: '950000000000000000000',
        },
        params_hash: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
        intent_hash: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
        nonce: String(Date.now()) + String(Math.floor(Math.random() * 1000)),
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });
    }

    it('allows pending -> committed exactly once', async () => {
      const run = await freshRun();
      const intent = await freshIntent(run.id);
      const committed = await markIntentCommitted(db, intent.id);
      expect(committed.status).toBe('committed');

      await expect(markIntentCommitted(db, intent.id)).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('keeps large uint256/uint64 fields as strings end to end, never a JS number', async () => {
      const run = await freshRun();
      const bigShares =
        '115792089237316195423570985008687907853269984665640564039457584007913129639935';
      const intent = await createIntent(db, {
        run_id: run.id,
        agent_address: '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb',
        chain_id: 84532,
        target_address: '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b',
        selector: '0xdd10f8ca',
        params: { shares: bigShares },
        params_hash: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
        intent_hash: `0x${randomUUID().replace(/-/g, '').padEnd(64, '0')}`,
        nonce: '18446744073709551615', // uint64 max
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(typeof intent.nonce).toBe('string');
      expect(intent.nonce).toBe('18446744073709551615');
      expect((intent.params as { shares: string }).shares).toBe(bigShares);
    });
  });

  describe('incidents', () => {
    it('allows the legal containment path once locked', async () => {
      const run = await freshRun();
      const incident = await createIncident(db, { run_id: run.id, mismatch_fields: ['shares'] });

      const lock = await acquireContainmentLock(db, incident.id, 'guardian-service');
      expect(lock.acquired).toBe(true);
      expect(lock.incident.state).toBe('containment_queued');

      const running = await transitionIncidentState(db, incident.id, 'containment_running');
      expect(running.state).toBe('containment_running');
      const confirmed = await transitionIncidentState(db, incident.id, 'containment_confirmed', {
        guardian_execution_id: 'wf_exec_123',
      });
      expect(confirmed.state).toBe('containment_confirmed');
      expect(confirmed.guardian_execution_id).toBe('wf_exec_123');
      const verified = await transitionIncidentState(db, incident.id, 'state_verified');
      expect(verified.state).toBe('state_verified');
      const contained = await transitionIncidentState(db, incident.id, 'contained', {
        contained_at: new Date().toISOString(),
        containment_latency_ms: 4200,
      });
      expect(contained.state).toBe('contained');
      expect(contained.containment_latency_ms).toBe(4200);
    });

    it('rejects skipping straight to contained', async () => {
      const run = await freshRun();
      const incident = await createIncident(db, { run_id: run.id, mismatch_fields: ['shares'] });
      await expect(transitionIncidentState(db, incident.id, 'contained')).rejects.toBeInstanceOf(
        InvalidStateTransitionError,
      );
    });

    it('rejects transitioning an already-contained incident', async () => {
      const run = await freshRun();
      const incident = await createIncident(db, { run_id: run.id, mismatch_fields: ['shares'] });
      await acquireContainmentLock(db, incident.id, 'guardian-service');
      await transitionIncidentState(db, incident.id, 'containment_running');
      await transitionIncidentState(db, incident.id, 'containment_confirmed');
      await transitionIncidentState(db, incident.id, 'state_verified');
      await transitionIncidentState(db, incident.id, 'contained');

      await expect(
        transitionIncidentState(db, incident.id, 'containment_running'),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });
  });
});
