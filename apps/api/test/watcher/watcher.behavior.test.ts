/**
 * Behavioral tests for the Phase 5 watcher gate: "Starting only from
 * confirmed onchain events, one over-mint must produce exactly one verified
 * KeeperHub pause." Runs `runWatcherTick` against a real Postgres+PostgREST
 * pair (see `global-setup.ts`) through the SAME repository functions
 * production uses, a fake chain client fed byte-accurate fixtures
 * (`support/fixtures.ts`), and a mocked KeeperHub `fetch`
 * (`../keeperhub/_fetchStub.ts`) — nothing here re-implements the watcher's
 * logic, it only supplies real infrastructure at the edges.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { getChainCursor, getIncidentByIntentId, type DbClient } from '@chainsre/db';
import type { Hex } from 'viem';

import type { KeeperHubEnv } from '../../src/lib/keeperhub';
import { runWatcherTick, type WatcherConfig, type WatcherDeps } from '../../src/lib/watcher';
import { mockFetchSequence } from '../keeperhub/_fetchStub';
import { FakeChainClient } from './support/fakeChain';
import { serviceRoleClient, withAdminClient } from './support/client';
import { seedIntent } from './support/seed';
import { intentCommittedLog, sharesMintedLog, unsupportedLog } from './support/fixtures';

const CHAIN_ID = 84_532;
const REGISTRY = '0x6a78fcf6cb1bf7b45b98e262ee65965263bb23f9' as Hex;
// Protected vault: matches the ONE row 0003_seed_protected_enrollment.sql seeds.
const VAULT = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as Hex;
// Control vault: deliberately never enrolled (same asymmetry the migration documents).
const CONTROL_VAULT = '0xf0dd43fbbea515f2fa8e2c0c0a2c60f5efc6f3b5' as Hex;
const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as Hex;
const RECEIVER = '0x2222222222222222222222222222222222222222' as Hex;
const GUARDIAN_WORKFLOW_ID = 'guardian-test-workflow';

const keeperHubEnv: KeeperHubEnv = {
  KEEPERHUB_API_KEY: 'kh_test_00000000000000000000',
  KEEPERHUB_BASE_URL: 'https://kh.test',
  KEEPERHUB_GUARDIAN_WORKFLOW_ID: GUARDIAN_WORKFLOW_ID,
};

function intentId(seed: string): Hex {
  return `0x${seed.repeat(64).slice(0, 64)}` as Hex;
}

function baseConfig(overrides: Partial<WatcherConfig> = {}): WatcherConfig {
  return {
    chainId: CHAIN_ID,
    registryAddress: REGISTRY,
    vaultAddresses: [VAULT, CONTROL_VAULT],
    guardianWorkflowId: GUARDIAN_WORKFLOW_ID,
    confirmations: 1,
    maxBlockRange: 2000,
    providerRetryAttempts: 3,
    startBlock: 0n,
    ...overrides,
  };
}

function baseDeps(
  db: DbClient,
  chain: FakeChainClient,
  overrides: Partial<WatcherDeps> = {},
): WatcherDeps {
  return {
    db,
    chainClient: chain.asChainReader(),
    keeperHubEnv,
    sleep: async () => undefined,
    ...overrides,
  };
}

/** KeeperHub responses for one successful trigger-then-poll-to-completion round trip. */
function successfulGuardianFetch(txHash: Hex) {
  return mockFetchSequence([
    { status: 200, body: { executionId: 'exec-1', status: 'accepted' } },
    {
      status: 200,
      body: {
        executionId: 'exec-1',
        status: 'success',
        transactionHashes: [{ hash: txHash, nodeId: 'pause-node', verified: true }],
        gasUsedWei: '21000',
      },
    },
  ]);
}

async function resetDb(): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query('truncate table public.demo_runs restart identity cascade');
    await client.query('truncate table public.chain_cursors restart identity cascade');
  });
}

describe('watcher behavioral tests', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('a matching mint produces zero incidents', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const id = intentId('1');
    const intent = await seedIntent(db, {
      intentId: id,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });

    chain.addLog(
      sharesMintedLog(
        { intentId: id, operator: AGENT, receiver: RECEIVER, shares: 950n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);

    const result = await runWatcherTick(baseConfig(), baseDeps(db, chain), 'run-matching');

    expect(result.matchedMints).toBe(1);
    expect(result.incidentsCreated).toBe(0);
    const incident = await getIncidentByIntentId(db, intent.id);
    expect(incident).toBeNull();
  });

  it('a divergent mint (950 declared vs 80,000,000 confirmed) produces exactly one incident and one containment', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const id = intentId('2');
    const intent = await seedIntent(db, {
      intentId: id,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });

    chain.addLog(
      sharesMintedLog(
        { intentId: id, operator: AGENT, receiver: RECEIVER, shares: 80_000_000n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);
    chain.setPaused(VAULT, true);

    const pauseTxHash = `0x${'c'.repeat(64)}` as Hex;
    const { fetchImpl } = successfulGuardianFetch(pauseTxHash);

    const result = await runWatcherTick(
      baseConfig(),
      baseDeps(db, chain, { fetchImpl }),
      'run-divergence',
    );

    expect(result.incidentsCreated).toBe(1);
    expect(result.containmentsAttempted).toBe(1);
    expect(result.containmentsSucceeded).toBe(1);
    expect(result.containmentsFailed).toBe(0);

    const incident = await getIncidentByIntentId(db, intent.id);
    expect(incident).not.toBeNull();
    expect(incident?.state).toBe('contained');
    expect(incident?.mismatch_fields).toEqual(['shares']);
    expect(incident?.expected).toMatchObject({ shares: '950000000000000000000' });
    expect(incident?.actual).toMatchObject({ shares: '80000000000000000000000000' });

    const { data: executions } = await db
      .from('executions')
      .select('*')
      .eq('run_id', intent.run_id)
      .eq('kind', 'guardian');
    expect(executions).toHaveLength(1);
  });

  it('duplicate logs for the same divergence never produce a duplicate incident or containment', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const id = intentId('3');
    const intent = await seedIntent(db, {
      intentId: id,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });

    const log = sharesMintedLog(
      { intentId: id, operator: AGENT, receiver: RECEIVER, shares: 80_000_000n * 10n ** 18n },
      { address: VAULT, blockNumber: 5n },
    );
    // The same log delivered twice — a duplicate RPC response, or overlapping
    // backfill — must never yield two incidents or two containment attempts
    // that both actually run.
    chain.addLog(log);
    chain.addLog({ ...log });
    chain.setLatestBlock(10n);
    chain.setPaused(VAULT, true);

    const pauseTxHash = `0x${'d'.repeat(64)}` as Hex;
    const { fetchImpl } = successfulGuardianFetch(pauseTxHash);

    const result = await runWatcherTick(
      baseConfig(),
      baseDeps(db, chain, { fetchImpl }),
      'run-duplicate',
    );

    expect(result.incidentsCreated).toBe(1);
    expect(result.incidentsAlreadyExisted).toBe(1);
    expect(result.containmentsAttempted).toBe(2);
    expect(result.containmentsSucceeded).toBe(1);
    expect(result.containmentsFailed).toBe(0);

    const { data: incidents } = await db.from('incidents').select('*').eq('intent_id', intent.id);
    expect(incidents).toHaveLength(1);
    const { data: executions } = await db
      .from('executions')
      .select('*')
      .eq('run_id', intent.run_id)
      .eq('kind', 'guardian');
    expect(executions).toHaveLength(1);
  });

  it('backfills across ticks bounded by maxBlockRange without missing or duplicating a later divergence', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const matchingId = intentId('4');
    const divergentId = intentId('5');

    await seedIntent(db, {
      intentId: matchingId,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });
    const divergentIntent = await seedIntent(db, {
      intentId: divergentId,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });

    chain.addLog(
      sharesMintedLog(
        { intentId: matchingId, operator: AGENT, receiver: RECEIVER, shares: 950n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.addLog(
      sharesMintedLog(
        {
          intentId: divergentId,
          operator: AGENT,
          receiver: RECEIVER,
          shares: 80_000_000n * 10n ** 18n,
        },
        { address: VAULT, blockNumber: 15n },
      ),
    );
    chain.setLatestBlock(20n);
    chain.setPaused(VAULT, true);

    const config = baseConfig({ maxBlockRange: 10 });

    // Tick 1: only block 5 is within [0, 9] — the block-15 divergence isn't
    // visible yet, matching a watcher that hasn't caught up.
    const tick1 = await runWatcherTick(config, baseDeps(db, chain), 'run-backfill-1');
    expect(tick1.toBlock).toBe(9n);
    expect(tick1.matchedMints).toBe(1);
    expect(tick1.incidentsCreated).toBe(0);

    // Simulate a restart: a brand-new WatcherDeps (fresh DbClient instance)
    // resumes purely from the persisted cursor, no in-memory state carried over.
    const pauseTxHash = `0x${'e'.repeat(64)}` as Hex;
    const { fetchImpl } = successfulGuardianFetch(pauseTxHash);
    const restartedDb = serviceRoleClient();
    const tick2 = await runWatcherTick(
      config,
      baseDeps(restartedDb, chain, { fetchImpl }),
      'run-backfill-2',
    );
    expect(tick2.fromBlock).toBe(10n);
    expect(tick2.toBlock).toBe(19n);
    expect(tick2.incidentsCreated).toBe(1);
    expect(tick2.containmentsSucceeded).toBe(1);

    const incident = await getIncidentByIntentId(db, divergentIntent.id);
    expect(incident?.state).toBe('contained');

    const cursor = await getChainCursor(db, CHAIN_ID, REGISTRY, 'watcher');
    expect(cursor?.last_processed_block).toBe('19');
  });

  it('resumes from the persisted cursor on a fresh watcher instance', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    chain.setLatestBlock(5n);

    const config = baseConfig();
    const first = await runWatcherTick(config, baseDeps(db, chain), 'run-cursor-1');
    expect(first.hadWork).toBe(true);
    expect(first.toBlock).toBe(4n);

    const persisted = await getChainCursor(db, CHAIN_ID, REGISTRY, 'watcher');
    expect(persisted?.last_processed_block).toBe('4');

    // No new blocks yet: a fresh instance resuming from the same cursor does no work.
    const freshDb = serviceRoleClient();
    const second = await runWatcherTick(config, baseDeps(freshDb, chain), 'run-cursor-2');
    expect(second.hadWork).toBe(false);
    expect(second.fromBlock).toBe(5n);

    chain.setLatestBlock(8n);
    const third = await runWatcherTick(config, baseDeps(freshDb, chain), 'run-cursor-3');
    expect(third.fromBlock).toBe(5n);
    expect(third.toBlock).toBe(7n);
  });

  it('retries a transient provider failure and succeeds within the retry budget', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    chain.setLatestBlock(5n);
    chain.failNextCalls(2);

    const result = await runWatcherTick(
      baseConfig({ providerRetryAttempts: 3 }),
      baseDeps(db, chain),
      'run-retry-ok',
    );
    expect(result.hadWork).toBe(true);
  });

  it('gives up after exhausting the provider retry budget, without corrupting the cursor', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    chain.setLatestBlock(5n);
    chain.failNextCalls(10);

    await expect(
      runWatcherTick(
        baseConfig({ providerRetryAttempts: 3 }),
        baseDeps(db, chain),
        'run-retry-fail',
      ),
    ).rejects.toThrow();

    const cursor = await getChainCursor(db, CHAIN_ID, REGISTRY, 'watcher');
    expect(cursor).toBeNull();
  });

  it('handles a failed pause safely: incident marked containment_failed, tick does not throw', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const id = intentId('6');
    const intent = await seedIntent(db, {
      intentId: id,
      agent: AGENT,
      target: VAULT,
      receiver: RECEIVER,
      shares: '950000000000000000000',
    });

    chain.addLog(
      sharesMintedLog(
        { intentId: id, operator: AGENT, receiver: RECEIVER, shares: 80_000_000n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);
    // Deliberately never setPaused(VAULT, true): KeeperHub reports success,
    // but the independent on-chain read never confirms it.

    const pauseTxHash = `0x${'f'.repeat(64)}` as Hex;
    const { fetchImpl } = successfulGuardianFetch(pauseTxHash);

    const result = await runWatcherTick(
      baseConfig(),
      baseDeps(db, chain, { fetchImpl }),
      'run-pause-fail',
    );

    expect(result.incidentsCreated).toBe(1);
    expect(result.containmentsAttempted).toBe(1);
    expect(result.containmentsSucceeded).toBe(0);
    expect(result.containmentsFailed).toBe(1);

    const incident = await getIncidentByIntentId(db, intent.id);
    expect(incident?.state).toBe('containment_failed');
  });

  it('ignores an unsupported log and a mint on an unenrolled contract, safely, without creating an incident', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();

    chain.addLog(unsupportedLog({ address: VAULT, blockNumber: 5n }));
    chain.addLog(
      sharesMintedLog(
        { intentId: intentId('7'), operator: AGENT, receiver: RECEIVER, shares: 1n },
        { address: CONTROL_VAULT, blockNumber: 6n },
      ),
    );
    chain.setLatestBlock(10n);

    const result = await runWatcherTick(baseConfig(), baseDeps(db, chain), 'run-unsupported');

    expect(result.incidentsCreated).toBe(0);
    expect(result.unsupportedSkipped).toBeGreaterThanOrEqual(1);
    expect(result.unenrolledSkipped).toBeGreaterThanOrEqual(1);
    expect(result.hadWork).toBe(true);
  });

  it('safely decodes a real-shaped IntentCommitted log without acting on it', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();

    chain.addLog(
      intentCommittedLog(
        {
          intentId: intentId('8'),
          agent: AGENT,
          target: VAULT,
          selector: '0xdd10f8ca',
          paramsHash: `0x${'b'.repeat(64)}`,
          deadline: 1897430400n,
          nonce: 1n,
        },
        { address: REGISTRY, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);

    const result = await runWatcherTick(baseConfig(), baseDeps(db, chain), 'run-intent-committed');

    expect(result.incidentsCreated).toBe(0);
    expect(result.logsScanned).toBe(1);
  });
});
