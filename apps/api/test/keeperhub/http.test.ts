import { describe, expect, it } from 'vitest';

import {
  KeeperHubAuthError,
  KeeperHubIdempotencyConflictError,
  KeeperHubIdempotencyInProgressError,
  KeeperHubMalformedResponseError,
  KeeperHubRateLimitError,
  KeeperHubTimeoutError,
  KeeperHubTransientError,
} from '../../src/lib/keeperhub/errors';
import { keeperHubRequest } from '../../src/lib/keeperhub/http';
import { mockFetchSequence, testEnv } from './_fetchStub';

describe('keeperHubRequest', () => {
  it('sends the bearer token and returns 2xx data untouched', async () => {
    const { fetchImpl, calls } = mockFetchSequence([{ status: 200, body: { ok: true } }]);
    const result = await keeperHubRequest(testEnv(), {
      method: 'GET',
      path: '/api/keys',
      fetchImpl,
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true });
    expect(calls[0]?.headers.Authorization).toBe('Bearer kh_test_00000000000000000000');
  });

  it('rejects a path that does not start with /api/', async () => {
    const { fetchImpl } = mockFetchSequence([]);
    await expect(
      keeperHubRequest(testEnv(), { method: 'GET', path: '/keys', fetchImpl }),
    ).rejects.toThrow(TypeError);
  });

  it('never puts the Authorization header value on the thrown error', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 401, body: { error: 'bad key' } }]);
    let caught: unknown;
    try {
      await keeperHubRequest(testEnv(), { method: 'GET', path: '/api/keys', fetchImpl });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KeeperHubAuthError);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught));
    expect(serialized).not.toContain('kh_test_00000000000000000000');
    expect(serialized).not.toContain('Bearer');
  });

  it('maps 429 to KeeperHubRateLimitError and reads Retry-After', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 429, body: { error: 'slow down' }, headers: { 'Retry-After': '7' } },
    ]);
    const err = await keeperHubRequest(testEnv(), {
      method: 'GET',
      path: '/api/chains',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeeperHubRateLimitError);
    expect((err as KeeperHubRateLimitError).retryAfterSeconds).toBe(7);
    expect((err as KeeperHubRateLimitError).retryable).toBe(true);
  });

  it('maps 409 idempotency_conflict with the original execution id', async () => {
    const { fetchImpl } = mockFetchSequence([
      {
        status: 409,
        body: {
          error: 'conflict',
          code: 'idempotency_conflict',
          originalExecutionId: 'direct_abc',
        },
      },
    ]);
    const err = await keeperHubRequest(testEnv(), {
      method: 'POST',
      path: '/api/execute/contract-call',
      body: {},
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeeperHubIdempotencyConflictError);
    expect((err as KeeperHubIdempotencyConflictError).originalExecutionId).toBe('direct_abc');
    expect((err as KeeperHubIdempotencyConflictError).retryable).toBe(false);
  });

  it('maps 409 idempotency_in_progress as retryable', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 409, body: { error: 'in progress', code: 'idempotency_in_progress' } },
    ]);
    const err = await keeperHubRequest(testEnv(), {
      method: 'POST',
      path: '/api/execute/contract-call',
      body: {},
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeeperHubIdempotencyInProgressError);
    expect((err as KeeperHubIdempotencyInProgressError).retryable).toBe(true);
  });

  it('maps 5xx to a retryable KeeperHubTransientError', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 503, body: { error: 'down' } }]);
    const err = await keeperHubRequest(testEnv(), {
      method: 'GET',
      path: '/api/chains',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeeperHubTransientError);
    expect((err as KeeperHubTransientError).retryable).toBe(true);
  });

  it('maps a network failure to a retryable KeeperHubTransientError', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 0, networkError: true }]);
    const err = await keeperHubRequest(testEnv(), {
      method: 'GET',
      path: '/api/chains',
      fetchImpl,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeeperHubTransientError);
    expect((err as KeeperHubTransientError).retryable).toBe(true);
  });

  it('raises KeeperHubMalformedResponseError on a non-JSON body', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 0 }]);
    // Override with a raw non-JSON body via a custom fetch (mockFetchSequence
    // always JSON-encodes `body`, so build the malformed case directly).
    const malformed: typeof fetch = async () => new Response('not json', { status: 200 });
    await expect(
      keeperHubRequest(testEnv(), { method: 'GET', path: '/api/keys', fetchImpl: malformed }),
    ).rejects.toBeInstanceOf(KeeperHubMalformedResponseError);
    void fetchImpl;
  });

  it('times out a request that never resolves', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 200, hang: true }]);
    await expect(
      keeperHubRequest(testEnv(), {
        method: 'GET',
        path: '/api/keys',
        fetchImpl,
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(KeeperHubTimeoutError);
  });

  it('sends Idempotency-Key only when provided', async () => {
    const { fetchImpl, calls } = mockFetchSequence([
      { status: 202, body: { executionId: 'direct_1', status: 'pending' } },
    ]);
    await keeperHubRequest(testEnv(), {
      method: 'POST',
      path: '/api/execute/contract-call',
      body: { a: 1 },
      idempotencyKey: 'chainsre:run1:commit',
      fetchImpl,
    });
    expect(calls[0]?.headers['Idempotency-Key']).toBe('chainsre:run1:commit');
  });
});
