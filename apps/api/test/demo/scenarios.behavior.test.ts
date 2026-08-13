/**
 * Behavioral tests for the Phase 6 gate: "One command can run NORMAL,
 * PROTECTED ATTACK and CONTROL ATTACK end-to-end using the existing ChainSRE
 * engine." Runs `runScenario` against a real Postgres+PostgREST pair (same
 * harness Phase 5 built, reused verbatim — see `../watcher/global-setup.ts`),
 * a fake chain client fed byte-accurate fixtures, and a mocked KeeperHub
 * `fetch` — nothing here re-implements the orchestrator's logic, it only
 * supplies real infrastructure at the edges. The planner uses a fixed
 * test-only `AgentProvider` stub (always declares 950) so scenarios are
 * deterministic without needing a real LLM credential.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createDemoRun, getChainCursor, type DbClient } from '@chainsre/db';
import { buildMintIntent, MINT_SHARES_SELECTOR } from '@chainsre/shared/intent-hash';
import type { Hex } from 'viem';

import type { AgentProvider, PlanRequest } from '../../src/lib/agent';
import {
  commitTypedIntentTool,
  executeApprovedMintTool,
  type ToolContext,
} from '../../src/lib/agent/tools';
import { runScenario, type ScenarioDeps, type ScenarioMode } from '../../src/lib/demo';
import type { ChainEnv } from '../../src/lib/chain';
import { buildIdempotencyKey, type KeeperHubEnv } from '../../src/lib/keeperhub';
import { FakeChainClient } from '../watcher/support/fakeChain';
import { sharesMintedLog } from '../watcher/support/fixtures';
import { serviceRoleClient, withAdminClient } from '../watcher/support/client';
import { mockFetchSequenceWithEffects } from './support/chainEffects';

const CHAIN_ID = 84_532;
const REGISTRY = '0x6a78fcf6cb1bf7b45b98e262ee65965263bb23f9' as Hex;
const VAULT = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as Hex;
const CONTROL_VAULT = '0xf0dd43fbbea515f2fa8e2c0c0a2c60f5efc6f3b5' as Hex;
const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as Hex;
const GUARDIAN_WORKFLOW_ID = 'guardian-test-workflow';
const DECLARED_SHARES = '950000000000000000000';
const EXECUTED_ATTACK_SHARES = '80000000000000000000000000';

const keeperHubEnv: KeeperHubEnv = {
  KEEPERHUB_API_KEY: 'kh_test_00000000000000000000',
  KEEPERHUB_BASE_URL: 'https://kh.test',
  KEEPERHUB_GUARDIAN_WORKFLOW_ID: GUARDIAN_WORKFLOW_ID,
};

const chainEnv: ChainEnv = {
  BASE_SEPOLIA_RPC_HTTP: 'http://127.0.0.1:1/unused-in-tests',
  CHAIN_ID,
  INTENT_REGISTRY_ADDRESS: REGISTRY,
  MOCK_ASSET_ADDRESS: '0x961fa7f8cdcba67717ce92c249443f74f3d448c5' as Hex,
  PROTECTED_VAULT_ADDRESS: VAULT,
  CONTROL_VAULT_ADDRESS: CONTROL_VAULT,
};

/** Always declares the same 950 — the fixed test stand-in for a real LLM. */
class FixedPlanProvider implements AgentProvider {
  readonly name = 'test-fixed-provider';
  async plan(request: PlanRequest): Promise<string> {
    return JSON.stringify({
      receiver: request.receiver,
      shares: DECLARED_SHARES,
      rationale: 'fixed for test',
    });
  }
}

async function resetDb(): Promise<void> {
  await withAdminClient(async (client) => {
    await client.query('truncate table public.demo_runs restart identity cascade');
    await client.query('truncate table public.chain_cursors restart identity cascade');
  });
}

function baseDeps(
  db: DbClient,
  chain: FakeChainClient,
  overrides: Partial<ScenarioDeps> = {},
): ScenarioDeps {
  return {
    db,
    chainClient: chain.asChainReader(),
    chainEnv,
    keeperHubEnv,
    agentProvider: new FixedPlanProvider(),
    agentAddress: AGENT,
    guardianWorkflowId: GUARDIAN_WORKFLOW_ID,
    sleep: async () => undefined,
    ...overrides,
  };
}

function intentIdFor(mode: ScenarioMode, deadline: number, nonce: bigint): Hex {
  const target = mode === 'control_attack' ? CONTROL_VAULT : VAULT;
  return buildMintIntent({
    chainId: CHAIN_ID,
    agent: AGENT,
    target,
    selector: MINT_SHARES_SELECTOR,
    receiver: AGENT,
    shares: DECLARED_SHARES,
    deadline,
    nonce,
  }).intentId;
}

describe('demo scenario behavioral tests', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('normal: declares and executes 950, matches, produces no incident', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const deadline = 2_000_000_000;
    const nonce = 101n;
    const intentId = intentIdFor('normal', deadline, nonce);

    chain.addLog(
      sharesMintedLog(
        { intentId, operator: AGENT, receiver: AGENT, shares: 950n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);

    const { fetchImpl } = mockFetchSequenceWithEffects(
      [
        { status: 200, body: { success: true, wouldRevert: false } }, // 1: commit simulate
        { status: 200, body: { executionId: 'exec-commit', status: 'accepted' } }, // 2: commit broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-commit',
            status: 'completed',
            transactionHash: `0x${'1'.repeat(64)}`,
          },
        }, // 3: commit status
        { status: 200, body: { success: true, wouldRevert: false } }, // 4: mint simulate
        { status: 200, body: { executionId: 'exec-mint', status: 'accepted' } }, // 5: mint broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-mint',
            status: 'completed',
            transactionHash: `0x${'2'.repeat(64)}`,
          },
        }, // 6: mint status
      ],
      {
        2: () => chain.setCommitted(intentId, true),
        5: () => chain.setSharesOf(VAULT, AGENT, 950n * 10n ** 18n),
      },
    );

    const result = await runScenario('normal', baseDeps(db, chain, { fetchImpl, deadline, nonce }));

    expect(result.finalState).toBe('completed');
    expect(result.declaredShares).toBe(DECLARED_SHARES);
    expect(result.executedShares).toBe(DECLARED_SHARES);
    expect(result.incidentId).toBeNull();
    expect(result.containmentAttempted).toBe(false);
    expect(result.containmentSucceeded).toBe(false);
    expect(result.drainAttempt).toBeNull();
  });

  it('protected attack: 80,000,000 executed, exactly one incident, one verified containment, drain blocked', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const deadline = 2_000_000_000;
    const nonce = 102n;
    const intentId = intentIdFor('protected_attack', deadline, nonce);

    chain.addLog(
      sharesMintedLog(
        { intentId, operator: AGENT, receiver: AGENT, shares: 80_000_000n * 10n ** 18n },
        { address: VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);

    const { fetchImpl } = mockFetchSequenceWithEffects(
      [
        { status: 200, body: { success: true, wouldRevert: false } }, // 1: commit simulate
        { status: 200, body: { executionId: 'exec-commit', status: 'accepted' } }, // 2: commit broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-commit',
            status: 'completed',
            transactionHash: `0x${'3'.repeat(64)}`,
          },
        }, // 3: commit status
        { status: 200, body: { success: true, wouldRevert: false } }, // 4: mint simulate (no cap — technically valid)
        { status: 200, body: { executionId: 'exec-mint', status: 'accepted' } }, // 5: mint broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-mint',
            status: 'completed',
            transactionHash: `0x${'4'.repeat(64)}`,
          },
        }, // 6: mint status
        { status: 200, body: { executionId: 'exec-guardian', status: 'accepted' } }, // 7: guardian workflow execute
        {
          status: 200,
          body: {
            executionId: 'exec-guardian',
            status: 'success',
            transactionHashes: [
              { hash: `0x${'5'.repeat(64)}`, nodeId: 'pause-node', verified: true },
            ],
            gasUsedWei: '21000',
          },
        }, // 8: guardian workflow status
        { status: 400, body: { success: false, wouldRevert: true, error: 'Pausable: paused' } }, // 9: drain simulate — blocked
      ],
      {
        2: () => chain.setCommitted(intentId, true),
        5: () => chain.setSharesOf(VAULT, AGENT, 80_000_000n * 10n ** 18n),
        8: () => chain.setPaused(VAULT, true),
      },
    );

    const result = await runScenario(
      'protected_attack',
      baseDeps(db, chain, { fetchImpl, deadline, nonce }),
    );

    expect(result.finalState).toBe('completed');
    expect(result.declaredShares).toBe(DECLARED_SHARES);
    expect(result.executedShares).toBe(EXECUTED_ATTACK_SHARES);
    expect(result.incidentId).not.toBeNull();
    expect(result.containmentAttempted).toBe(true);
    expect(result.containmentSucceeded).toBe(true);
    expect(result.drainAttempt?.succeeded).toBe(false);

    const cursor = await getChainCursor(db, CHAIN_ID, REGISTRY, 'watcher');
    expect(cursor).not.toBeNull();
  });

  it('control attack: 80,000,000 executed, no containment (unenrolled), drain succeeds', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const deadline = 2_000_000_000;
    const nonce = 103n;
    const intentId = intentIdFor('control_attack', deadline, nonce);

    chain.addLog(
      sharesMintedLog(
        { intentId, operator: AGENT, receiver: AGENT, shares: 80_000_000n * 10n ** 18n },
        { address: CONTROL_VAULT, blockNumber: 5n },
      ),
    );
    chain.setLatestBlock(10n);

    const { fetchImpl } = mockFetchSequenceWithEffects(
      [
        { status: 200, body: { success: true, wouldRevert: false } }, // 1: commit simulate
        { status: 200, body: { executionId: 'exec-commit', status: 'accepted' } }, // 2: commit broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-commit',
            status: 'completed',
            transactionHash: `0x${'6'.repeat(64)}`,
          },
        }, // 3: commit status
        { status: 200, body: { success: true, wouldRevert: false } }, // 4: mint simulate
        { status: 200, body: { executionId: 'exec-mint', status: 'accepted' } }, // 5: mint broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-mint',
            status: 'completed',
            transactionHash: `0x${'7'.repeat(64)}`,
          },
        }, // 6: mint status
        // No guardian calls — the control vault is deliberately unenrolled.
        { status: 200, body: { success: true, wouldRevert: false } }, // 7: drain simulate — not blocked
        { status: 200, body: { executionId: 'exec-drain', status: 'accepted' } }, // 8: drain broadcast
        {
          status: 200,
          body: {
            executionId: 'exec-drain',
            status: 'completed',
            transactionHash: `0x${'8'.repeat(64)}`,
          },
        }, // 9: drain status
      ],
      {
        2: () => chain.setCommitted(intentId, true),
        5: () => chain.setSharesOf(CONTROL_VAULT, AGENT, 80_000_000n * 10n ** 18n),
      },
    );

    const result = await runScenario(
      'control_attack',
      baseDeps(db, chain, { fetchImpl, deadline, nonce }),
    );

    expect(result.finalState).toBe('completed');
    expect(result.executedShares).toBe(EXECUTED_ATTACK_SHARES);
    expect(result.incidentId).toBeNull();
    expect(result.containmentAttempted).toBe(false);
    expect(result.containmentSucceeded).toBe(false);
    expect(result.drainAttempt?.succeeded).toBe(true);
  });

  it('replay/idempotency: re-executing the same mint step never duplicates an execution row', async () => {
    const db = serviceRoleClient();
    const chain = new FakeChainClient();
    const deadline = 2_000_000_000;
    const nonce = 104n;
    const target = VAULT;
    const intentId = intentIdFor('normal', deadline, nonce);

    const run = await createDemoRun(db, {
      mode: 'normal',
      vault_address: target,
      started_by: AGENT,
    });
    const runId = run.id;

    const toolCtx: ToolContext = {
      db,
      chainClient: chain.asChainReader(),
      chainEnv,
      keeperHubEnv,
      fetchImpl: undefined,
    };

    const intent = {
      schema: 'chainsre/mint-v1' as const,
      intentId,
      chainId: CHAIN_ID,
      agent: AGENT,
      target,
      receiver: AGENT,
      selector: MINT_SHARES_SELECTOR,
      shares: DECLARED_SHARES,
      nonce: nonce.toString(),
      deadline,
    };

    // Commit once (its own idempotency is exercised by Phase 4's `intents`
    // unique constraints, not this test — it just gets the intent to
    // "committed" so the mint step can be replayed against it).
    const commitMocks = mockFetchSequenceWithEffects(
      [
        { status: 200, body: { success: true, wouldRevert: false } },
        { status: 200, body: { executionId: 'exec-commit', status: 'accepted' } },
        {
          status: 200,
          body: {
            executionId: 'exec-commit',
            status: 'completed',
            transactionHash: `0x${'9'.repeat(64)}`,
          },
        },
      ],
      { 2: () => chain.setCommitted(intentId, true) },
    );
    const commit = await commitTypedIntentTool(
      { ...toolCtx, fetchImpl: commitMocks.fetchImpl },
      { runId, intent },
    );

    // Replay the mint step twice with the SAME idempotency key (a caller
    // retrying after e.g. a dropped response). Only ONE queued response set
    // is provided: the first call executes for real through KeeperHub; the
    // second must recognize the already-terminal execution row
    // (`createExecution`'s unique constraint on `idempotency_key`) and
    // short-circuit WITHOUT calling KeeperHub again — if it didn't, this
    // mock would throw "no queued response for call 4".
    const mintMocks = mockFetchSequenceWithEffects(
      [
        { status: 200, body: { success: true, wouldRevert: false } },
        { status: 200, body: { executionId: 'exec-mint', status: 'accepted' } },
        {
          status: 200,
          body: {
            executionId: 'exec-mint',
            status: 'completed',
            transactionHash: `0x${'a'.repeat(64)}`,
          },
        },
      ],
      { 2: () => chain.setSharesOf(target, AGENT, 950n * 10n ** 18n) },
    );
    const first = await executeApprovedMintTool(
      { ...toolCtx, fetchImpl: mintMocks.fetchImpl },
      { runId, dbIntentId: commit.dbIntentId },
    );
    const second = await executeApprovedMintTool(
      { ...toolCtx, fetchImpl: mintMocks.fetchImpl },
      { runId, dbIntentId: commit.dbIntentId },
    );
    expect(second.dbExecutionId).toBe(first.dbExecutionId);
    expect(mintMocks.calls).toHaveLength(3);

    const { data: mintExecutions } = await db
      .from('executions')
      .select('*')
      .eq('idempotency_key', buildIdempotencyKey(runId, 'mint'));
    expect(mintExecutions).toHaveLength(1);
  });
});
