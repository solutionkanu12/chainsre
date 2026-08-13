import { describe, expect, it, vi } from 'vitest';

import {
  KeeperHubAuthError,
  KeeperHubTimeoutError,
  KeeperHubTransientError,
} from '../../src/lib/keeperhub/errors';
import { exponentialBackoffMs, pollUntil } from '../../src/lib/keeperhub/polling';

function fakeSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe('pollUntil', () => {
  it('returns as soon as isTerminal is satisfied', async () => {
    let calls = 0;
    const { sleep, waits } = fakeSleep();
    const result = await pollUntil({
      label: 'test',
      sleep,
      fetchStatus: async () => {
        calls++;
        return calls >= 3 ? 'done' : 'pending';
      },
      isTerminal: (s) => s === 'done',
      nextDelayMs: () => 10,
    });
    expect(result).toBe('done');
    expect(calls).toBe(3);
    expect(waits).toEqual([10, 10]);
  });

  it('gives up after maxAttempts with a bounded KeeperHubTimeoutError', async () => {
    const { sleep } = fakeSleep();
    await expect(
      pollUntil({
        label: 'never-terminal',
        sleep,
        maxAttempts: 4,
        fetchStatus: async () => 'pending',
        isTerminal: () => false,
        nextDelayMs: () => 5,
      }),
    ).rejects.toBeInstanceOf(KeeperHubTimeoutError);
  });

  it('gives up after maxTotalWaitMs even with attempts remaining', async () => {
    let now = 0;
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sleep = async (ms: number) => {
      now += ms;
    };
    await expect(
      pollUntil({
        label: 'slow',
        sleep,
        maxAttempts: 1000,
        maxTotalWaitMs: 100,
        fetchStatus: async () => 'pending',
        isTerminal: () => false,
        nextDelayMs: () => 30,
      }),
    ).rejects.toBeInstanceOf(KeeperHubTimeoutError);
    dateSpy.mockRestore();
  });

  it('retries a retryable KeeperHubError without failing the poll', async () => {
    let calls = 0;
    const { sleep } = fakeSleep();
    const result = await pollUntil({
      label: 'flaky',
      sleep,
      fetchStatus: async () => {
        calls++;
        if (calls === 1) throw new KeeperHubTransientError('temporary blip');
        return 'done';
      },
      isTerminal: (s) => s === 'done',
      nextDelayMs: () => 10,
    });
    expect(result).toBe('done');
    expect(calls).toBe(2);
  });

  it('propagates a non-retryable KeeperHubError immediately', async () => {
    const { sleep } = fakeSleep();
    await expect(
      pollUntil({
        label: 'auth-broken',
        sleep,
        fetchStatus: async () => {
          throw new KeeperHubAuthError();
        },
        isTerminal: () => true,
        nextDelayMs: () => 10,
      }),
    ).rejects.toBeInstanceOf(KeeperHubAuthError);
  });
});

describe('exponentialBackoffMs', () => {
  it('grows with attempt number and stays capped', () => {
    const first = exponentialBackoffMs(1, { initialMs: 100, factor: 2, maxMs: 1000 });
    const tenth = exponentialBackoffMs(10, { initialMs: 100, factor: 2, maxMs: 1000 });
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1000 * 1.15);
    expect(tenth).toBeLessThanOrEqual(1000 * 1.15);
  });
});
