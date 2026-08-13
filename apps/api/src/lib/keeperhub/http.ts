/**
 * Low-level KeeperHub HTTP transport.
 *
 * This is the ONLY place an `Authorization` header is built. It is never logged,
 * never included in a thrown error, and never echoed back to a caller — errors
 * carry KeeperHub's response `error`/`code` fields (which do not contain the
 * key) and nothing else about the request.
 *
 * `fetchImpl` defaults to the platform `fetch` and is overridable purely so
 * tests can inject a stub without a mocking framework — the same pattern the
 * shared logger uses for its `sink`.
 */
import {
  KeeperHubAuthError,
  KeeperHubError,
  KeeperHubIdempotencyConflictError,
  KeeperHubIdempotencyInProgressError,
  KeeperHubMalformedResponseError,
  KeeperHubRateLimitError,
  KeeperHubTimeoutError,
  KeeperHubTransientError,
} from './errors';
import type { KeeperHubEnv } from './env';

/** Default per-request timeout. Generous, but bounded — never infinite. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

export interface KeeperHubRequestOptions {
  readonly method: 'GET' | 'POST';
  /** Must start with `/api/` — `KEEPERHUB_BASE_URL` already excludes it. */
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface KeeperHubHttpResult {
  readonly status: number;
  readonly data: unknown;
  readonly headers: Headers;
}

function safeErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}

function codeOf(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'code' in data && typeof data.code === 'string') {
    return data.code;
  }
  return undefined;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After');
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Issue one KeeperHub request. Never throws on 2xx or 400 — those are returned
 * for the caller to interpret (a 400 with `wouldRevert:true` from the simulate
 * endpoint is expected data, not a transport failure). Unambiguous protocol
 * conditions (401, 409, 429, 5xx, network failure, timeout, malformed JSON) are
 * raised as the typed errors in `./errors` so every caller handles them the
 * same way exactly once, here.
 */
export async function keeperHubRequest(
  env: KeeperHubEnv,
  options: KeeperHubRequestOptions,
): Promise<KeeperHubHttpResult> {
  if (!options.path.startsWith('/api/')) {
    throw new TypeError(`KeeperHub request path must start with "/api/", got "${options.path}"`);
  }

  const url = `${env.KEEPERHUB_BASE_URL}${options.path}`;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.KEEPERHUB_API_KEY}`,
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new KeeperHubTimeoutError(
        `KeeperHub request timed out after ${timeoutMs}ms: ${options.method} ${options.path}`,
      );
    }
    throw new KeeperHubTransientError(
      `KeeperHub request failed (network error): ${options.method} ${options.path}`,
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await response.text();
  let data: unknown = undefined;
  if (rawBody.length > 0) {
    try {
      data = JSON.parse(rawBody);
    } catch (cause) {
      throw new KeeperHubMalformedResponseError(
        `KeeperHub returned a non-JSON body (HTTP ${response.status}): ${options.method} ${options.path}`,
        { httpStatus: response.status, cause },
      );
    }
  }

  if (response.status === 401) {
    throw new KeeperHubAuthError(safeErrorMessage(data, 'KeeperHub authentication failed (401)'), {
      code: codeOf(data),
    });
  }
  if (response.status === 429) {
    throw new KeeperHubRateLimitError(
      safeErrorMessage(data, 'KeeperHub rate limit exceeded (429)'),
      parseRetryAfter(response.headers),
    );
  }
  if (response.status === 409) {
    const code = codeOf(data);
    const message = safeErrorMessage(data, 'KeeperHub request conflict (409)');
    if (code === 'idempotency_in_progress') {
      throw new KeeperHubIdempotencyInProgressError(message);
    }
    if (code === 'idempotency_conflict') {
      const originalExecutionId =
        data && typeof data === 'object' && 'originalExecutionId' in data
          ? String((data as { originalExecutionId: unknown }).originalExecutionId)
          : undefined;
      throw new KeeperHubIdempotencyConflictError(message, originalExecutionId);
    }
    throw new KeeperHubError(message, { httpStatus: 409, code, retryable: false });
  }
  if (response.status >= 500) {
    throw new KeeperHubTransientError(
      safeErrorMessage(data, `KeeperHub server error (HTTP ${response.status})`),
      { httpStatus: response.status },
    );
  }

  return { status: response.status, data, headers: response.headers };
}
