import { describe, expect, it } from 'vitest';

import {
  broadcastContractCall,
  checkAuth,
  executeContractCallSafely,
  executeWorkflowSafely,
  getExecutionStatus,
  listChains,
  pollExecutionUntilTerminal,
  requireChainEnabled,
  simulateContractCall,
} from '../../src/lib/keeperhub/client';
import {
  KeeperHubChainUnavailableError,
  KeeperHubExecutionFailedError,
  KeeperHubMalformedResponseError,
  KeeperHubSimulationRevertError,
} from '../../src/lib/keeperhub/errors';
import { mockFetchSequence, testEnv } from './_fetchStub';

const req = {
  contractAddress: '0x429F2b842e5B0BCfd5f8359736aCC444FB35fB4B' as const,
  chainId: 84532,
  functionName: 'mintShares',
  functionArgs: ['0x' + '1'.repeat(64), '0x' + '2'.repeat(40), '950000000000000000000'],
} as const;

const noSleep = async () => undefined;

describe('checkAuth', () => {
  it('returns true for a valid key', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: { keys: [] } }]);
    expect(await checkAuth(testEnv(), { fetchImpl })).toBe(true);
  });

  it('returns false (not a throw) for an invalid key', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 401, body: { error: 'bad' } }]);
    expect(await checkAuth(testEnv(), { fetchImpl })).toBe(false);
  });

  it('still throws for a non-auth failure like a 500', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 500, body: { error: 'down' } }]);
    await expect(checkAuth(testEnv(), { fetchImpl })).rejects.toThrow();
  });
});

describe('listChains / requireChainEnabled', () => {
  const chains = [
    {
      chainId: 84532,
      isEnabled: true,
      isTestnet: true,
      usePrivateMempoolRpc: false,
      name: 'Base Sepolia',
    },
    { chainId: 1, isEnabled: false, isTestnet: false, usePrivateMempoolRpc: false },
  ];

  it('normalizes the bare array response', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: chains }]);
    const result = await listChains(testEnv(), { fetchImpl });
    expect(result).toHaveLength(2);
    expect(result[0]?.chainId).toBe(84532);
    expect(result[0]?.isEnabled).toBe(true);
  });

  it('rejects a non-array response', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: { not: 'an array' } }]);
    await expect(listChains(testEnv(), { fetchImpl })).rejects.toBeInstanceOf(
      KeeperHubMalformedResponseError,
    );
  });

  it('requireChainEnabled succeeds when present and enabled', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: chains }]);
    const chain = await requireChainEnabled(testEnv(), 84532, { fetchImpl });
    expect(chain.isEnabled).toBe(true);
  });

  it('requireChainEnabled throws when present but disabled', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: chains }]);
    await expect(requireChainEnabled(testEnv(), 1, { fetchImpl })).rejects.toBeInstanceOf(
      KeeperHubChainUnavailableError,
    );
  });

  it('requireChainEnabled throws when the chain is not present at all', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, body: chains }]);
    await expect(requireChainEnabled(testEnv(), 999_999, { fetchImpl })).rejects.toBeInstanceOf(
      KeeperHubChainUnavailableError,
    );
  });
});

describe('simulateContractCall', () => {
  it('sends functionArgs/abi as JSON-encoded strings, not raw values', async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 200, body: { success: true, wouldRevert: false, gasEstimate: '65000' } },
    ]);
    await simulateContractCall(testEnv(), req, { fetchImpl });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(typeof body.functionArgs).toBe('string');
    expect(JSON.parse(body.functionArgs as string)).toEqual(req.functionArgs);
    expect(body.simulate).toBe(true);
  });

  it('returns a normal (non-throwing) result for a would-revert dry run', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 400, body: { success: false, wouldRevert: true, revertReason: 'Paused' } },
    ]);
    const result = await simulateContractCall(testEnv(), req, { fetchImpl });
    expect(result.wouldRevert).toBe(true);
    expect(result.revertReason).toBe('Paused');
  });

  it('returns success:true for a non-reverting dry run', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 200, body: { success: true, wouldRevert: false, gasEstimate: '48000' } },
    ]);
    const result = await simulateContractCall(testEnv(), req, { fetchImpl });
    expect(result.success).toBe(true);
    expect(result.wouldRevert).toBe(false);
    expect(result.gasEstimate).toBe('48000');
  });
});

describe('executeContractCallSafely', () => {
  it('blocks the broadcast when simulation would revert', async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 400, body: { success: false, wouldRevert: true, revertReason: 'EnforcedPause' } },
    ]);
    await expect(
      executeContractCallSafely(testEnv(), req, 'chainsre:run1:mint', {
        fetchImpl,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(KeeperHubSimulationRevertError);
    // Only the simulate call was made — broadcast must never fire after a revert.
    expect(calls).toHaveLength(1);
  });

  it('blocks the broadcast when simulation reports success:false without wouldRevert', async () => {
    const { fetchImpl, calls } = mockFetchSequence([{ status: 200, body: { success: false } }]);
    await expect(
      executeContractCallSafely(testEnv(), req, 'chainsre:run1:mint', {
        fetchImpl,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(KeeperHubSimulationRevertError);
    expect(calls).toHaveLength(1);
  });

  it('simulates, broadcasts, polls, and returns the completed execution', async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 200, body: { success: true, wouldRevert: false, gasEstimate: '65000' } },
      { status: 202, body: { executionId: 'direct_1', status: 'pending' } },
      {
        status: 200,
        body: { executionId: 'direct_1', status: 'running' },
        headers: { 'X-Poll-Interval-Hint': '1' },
      },
      {
        status: 200,
        body: {
          executionId: 'direct_1',
          status: 'completed',
          transactionHash: `0x${'a'.repeat(64)}`,
          transactionLink: 'https://sepolia.basescan.org/tx/0xabc',
          gasUsedWei: '1234567',
        },
        headers: { 'X-Poll-Interval-Hint': '0' },
      },
    ]);
    const final = await executeContractCallSafely(testEnv(), req, 'chainsre:run1:mint', {
      fetchImpl,
      sleep: noSleep,
    });
    expect(final.status).toBe('completed');
    expect(final.transactionHash).toBe(`0x${'a'.repeat(64)}`);
    expect(calls).toHaveLength(4);
    expect(calls[1]?.headers['Idempotency-Key']).toBe('chainsre:run1:mint');
  });

  it('throws KeeperHubExecutionFailedError when the execution terminates as failed', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 200, body: { success: true, wouldRevert: false } },
      { status: 202, body: { executionId: 'direct_2', status: 'pending' } },
      {
        status: 200,
        body: { executionId: 'direct_2', status: 'failed', error: 'reverted on-chain' },
        headers: { 'X-Poll-Interval-Hint': '0' },
      },
    ]);
    await expect(
      executeContractCallSafely(testEnv(), req, 'chainsre:run1:mint', {
        fetchImpl,
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(KeeperHubExecutionFailedError);
  });
});

describe('broadcastContractCall idempotent replay', () => {
  it('surfaces idempotentReplay:true so a retried broadcast is distinguishable from a new one', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 202, body: { executionId: 'direct_9', status: 'pending', idempotentReplay: true } },
    ]);
    const result = await broadcastContractCall(testEnv(), req, 'chainsre:run1:mint', { fetchImpl });
    expect(result.executionId).toBe('direct_9');
    expect(result.idempotentReplay).toBe(true);
  });

  it('rejects a broadcast response missing executionId/status', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 202, body: { ok: true } }]);
    await expect(
      broadcastContractCall(testEnv(), req, 'chainsre:run1:mint', { fetchImpl }),
    ).rejects.toBeInstanceOf(KeeperHubMalformedResponseError);
  });
});

describe('getExecutionStatus / pollExecutionUntilTerminal', () => {
  it('parses the X-Poll-Interval-Hint header', async () => {
    const { fetchImpl } = mockFetchSequence([
      {
        status: 200,
        body: { executionId: 'direct_3', status: 'running' },
        headers: { 'X-Poll-Interval-Hint': '4' },
      },
    ]);
    const status = await getExecutionStatus(testEnv(), 'direct_3', { fetchImpl });
    expect(status.pollIntervalHintSeconds).toBe(4);
  });

  it('bounds polling and times out rather than looping forever', async () => {
    const responses = Array.from({ length: 30 }, () => ({
      status: 200,
      body: { executionId: 'direct_4', status: 'pending' },
      headers: { 'X-Poll-Interval-Hint': '0' },
    }));
    const { fetchImpl } = mockFetchSequence(responses);
    await expect(
      pollExecutionUntilTerminal(testEnv(), 'direct_4', {
        fetchImpl,
        sleep: noSleep,
        maxAttempts: 5,
      }),
    ).rejects.toThrow(/did not reach a terminal state/);
  });
});

describe('executeWorkflowSafely', () => {
  it('triggers, polls, and returns a completed workflow execution', async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 200, body: { executionId: 'exec_1', status: 'running' } },
      {
        status: 200,
        body: {
          executionId: 'exec_1',
          status: 'success',
          transactionHashes: [
            {
              hash: `0x${'b'.repeat(64)}`,
              nodeId: 'step-1',
              receiptStatus: 'success',
              verified: true,
            },
          ],
        },
      },
    ]);
    const final = await executeWorkflowSafely(
      testEnv(),
      'wf_guardian',
      'chainsre:run1:pause',
      {},
      { fetchImpl, sleep: noSleep },
    );
    expect(final.status).toBe('completed');
    expect(final.transactionHashes[0]?.hash).toBe(`0x${'b'.repeat(64)}`);
    expect(calls[0]?.headers['Idempotency-Key']).toBe('chainsre:run1:pause');
  });

  it('throws when the workflow execution ends in error', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 200, body: { executionId: 'exec_2', status: 'running' } },
      { status: 200, body: { executionId: 'exec_2', status: 'error', error: 'pauser reverted' } },
    ]);
    await expect(
      executeWorkflowSafely(
        testEnv(),
        'wf_guardian',
        'chainsre:run1:pause',
        {},
        { fetchImpl, sleep: noSleep },
      ),
    ).rejects.toBeInstanceOf(KeeperHubExecutionFailedError);
  });

  it('treats an HTTP 2xx trigger response alone as insufficient — only a polled terminal status counts', async () => {
    // The trigger call succeeds (2xx), but the workflow never reaches a terminal
    // state within the poll budget: executeWorkflowSafely must not report success.
    const responses = Array.from({ length: 10 }, () => ({
      status: 200,
      body: { executionId: 'exec_3', status: 'running' },
    }));
    const { fetchImpl } = mockFetchSequence([
      { status: 200, body: { executionId: 'exec_3', status: 'running' } },
      ...responses,
    ]);
    await expect(
      executeWorkflowSafely(
        testEnv(),
        'wf_guardian',
        'chainsre:run1:pause',
        {},
        {
          fetchImpl,
          sleep: noSleep,
          maxAttempts: 3,
        },
      ),
    ).rejects.toThrow(/did not reach a terminal state/);
  });
});
