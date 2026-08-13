/**
 * Bounded polling. Every loop here has a hard cap on both attempt count and
 * total elapsed time — there is no such thing as an unbounded `while(true)` in
 * this module. Transient failures (rate limit, 5xx, network blip) encountered
 * *while polling* are retried with backoff rather than aborting the whole
 * wait; anything else (auth failure, a genuinely malformed response) propagates
 * immediately, since retrying it can never succeed.
 */
import { KeeperHubError, KeeperHubRateLimitError, KeeperHubTimeoutError } from './errors';

export interface PollOptions<T> {
  /** Fetch the current status. May throw a retryable KeeperHubError. */
  readonly fetchStatus: () => Promise<T>;
  readonly isTerminal: (result: T) => boolean;
  /**
   * Delay before the next poll, in ms. Receives the just-fetched result so a
   * server-provided poll-interval hint can override the default backoff.
   */
  readonly nextDelayMs: (result: T | undefined, attempt: number, previousDelayMs: number) => number;
  readonly maxAttempts?: number;
  readonly maxTotalWaitMs?: number;
  readonly label: string;
  /** Injectable so tests never actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MAX_TOTAL_WAIT_MS = 5 * 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `fetchStatus` until `isTerminal` is satisfied, or a hard bound is hit.
 * Retryable errors surfaced by `fetchStatus` (rate limit, transient 5xx,
 * network blips — anything with `.retryable === true`) are swallowed and
 * counted as a poll attempt with backoff; everything else propagates.
 */
export async function pollUntil<T>(options: PollOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxTotalWaitMs = options.maxTotalWaitMs ?? DEFAULT_MAX_TOTAL_WAIT_MS;
  const sleep = options.sleep ?? defaultSleep;

  const start = Date.now();
  let previousDelayMs = 0;
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() - start > maxTotalWaitMs) {
      break;
    }

    try {
      const result = await options.fetchStatus();
      lastResult = result;
      if (options.isTerminal(result)) {
        return result;
      }
    } catch (err) {
      if (err instanceof KeeperHubError && err.retryable) {
        // Honor a rate limiter's explicit backoff request over our own.
        if (err instanceof KeeperHubRateLimitError && err.retryAfterSeconds !== undefined) {
          previousDelayMs = err.retryAfterSeconds * 1000;
        }
        // fall through to the shared delay-and-retry path below
      } else {
        throw err;
      }
    }

    const elapsed = Date.now() - start;
    if (elapsed >= maxTotalWaitMs || attempt >= maxAttempts) {
      break;
    }
    const delay = Math.max(options.nextDelayMs(lastResult, attempt, previousDelayMs), 0);
    const bounded = Math.min(delay, maxTotalWaitMs - elapsed);
    previousDelayMs = delay;
    if (bounded > 0) {
      await sleep(bounded);
    }
  }

  throw new KeeperHubTimeoutError(
    `Polling "${options.label}" did not reach a terminal state within ` +
      `${maxAttempts} attempts / ${maxTotalWaitMs}ms` +
      (lastResult !== undefined ? ` (last status: ${JSON.stringify(lastResult)})` : ''),
  );
}

/**
 * Exponential backoff with jitter, capped. Used when the server gives no
 * poll-interval hint (workflow status has none; direct-execution status does).
 */
export function exponentialBackoffMs(
  attempt: number,
  { initialMs = 1000, factor = 1.8, maxMs = 15_000 } = {},
): number {
  const raw = initialMs * Math.pow(factor, Math.max(0, attempt - 1));
  const capped = Math.min(raw, maxMs);
  // +/-15% jitter so many parallel pollers don't thunder in lockstep.
  const jitter = capped * (0.85 + Math.random() * 0.3);
  return Math.round(jitter);
}
