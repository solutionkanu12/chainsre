/**
 * A minimal, dependency-free `fetch` stub for KeeperHub client tests.
 * Not a `.test.ts` file, so vitest's `test/**\/*.test.ts` include pattern skips it.
 */

export interface StubResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** If set, the fetch call rejects instead of resolving (network failure). */
  readonly networkError?: boolean;
  /** If set, resolving hangs until the caller's AbortSignal fires. */
  readonly hang?: boolean;
}

export interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Build a `fetch`-shaped stub that returns `responses` in order (one per
 * call), and records every call for assertion. Extra calls beyond the queued
 * responses throw loudly rather than silently returning `undefined`.
 */
export function mockFetchSequence(responses: readonly StubResponse[]): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const queue = [...responses];
  const calls: RecordedCall[] = [];

  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const next = queue.shift();
    if (!next) {
      throw new Error(`mockFetchSequence: no queued response for call ${calls.length + 1}`);
    }

    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (next.hang) {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }
    if (next.networkError) {
      throw new TypeError('fetch failed');
    }

    const bodyText = next.body !== undefined ? JSON.stringify(next.body) : '';
    return new Response(bodyText, {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;

  return { fetchImpl, calls };
}

export function testEnv(overrides: Partial<Record<string, string>> = {}) {
  return {
    KEEPERHUB_API_KEY: 'kh_test_00000000000000000000',
    KEEPERHUB_BASE_URL: 'https://kh.test',
    KEEPERHUB_GUARDIAN_WORKFLOW_ID: undefined,
    ...overrides,
  };
}
