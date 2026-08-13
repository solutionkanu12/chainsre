/**
 * Typed KeeperHub errors. Callers branch on `instanceof`, not on parsing
 * `.message` strings. Every error carries enough structured detail to log
 * safely and to decide whether a retry is safe — never the request's
 * Authorization header or API key, which never reach an error object here.
 */

export interface KeeperHubErrorOptions {
  httpStatus?: number;
  /** KeeperHub's machine-readable error code, e.g. "idempotency_conflict". */
  code?: string;
  /** Whether the SAME request (same idempotency key, same body) may be retried. */
  retryable?: boolean;
  cause?: unknown;
}

export class KeeperHubError extends Error {
  readonly httpStatus?: number;
  readonly code?: string;
  readonly retryable: boolean;

  constructor(message: string, options: KeeperHubErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'KeeperHubError';
    this.httpStatus = options.httpStatus;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

/** 401 — the API key is missing, invalid, revoked, or lacks the required scope. */
export class KeeperHubAuthError extends KeeperHubError {
  constructor(
    message = 'KeeperHub authentication failed (401)',
    options: KeeperHubErrorOptions = {},
  ) {
    super(message, { ...options, httpStatus: options.httpStatus ?? 401, retryable: false });
    this.name = 'KeeperHubAuthError';
  }
}

/** 429 — too many requests. Carries the server's suggested wait, when present. */
export class KeeperHubRateLimitError extends KeeperHubError {
  readonly retryAfterSeconds?: number;
  constructor(message = 'KeeperHub rate limit exceeded (429)', retryAfterSeconds?: number) {
    super(message, { httpStatus: 429, retryable: true });
    this.name = 'KeeperHubRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 5xx, network failure, or connection reset — safe to retry the same request. */
export class KeeperHubTransientError extends KeeperHubError {
  constructor(message: string, options: KeeperHubErrorOptions = {}) {
    super(message, { ...options, retryable: true });
    this.name = 'KeeperHubTransientError';
  }
}

/** A bounded wait (single request timeout or a polling budget) elapsed. */
export class KeeperHubTimeoutError extends KeeperHubError {
  constructor(message: string) {
    super(message, { retryable: false });
    this.name = 'KeeperHubTimeoutError';
  }
}

/** Simulation reported the call would revert, or did not report success. Broadcast must not proceed. */
export class KeeperHubSimulationRevertError extends KeeperHubError {
  readonly revertReason?: string;
  constructor(message: string, revertReason?: string) {
    super(message, { httpStatus: 400, retryable: false });
    this.name = 'KeeperHubSimulationRevertError';
    this.revertReason = revertReason;
  }
}

/**
 * 409 `idempotency_conflict` — this Idempotency-Key was already bound to a
 * DIFFERENT request body. Never safe to retry as-is: either the body drifted
 * (fix it and keep the key) or this is genuinely new work (use a new key).
 */
export class KeeperHubIdempotencyConflictError extends KeeperHubError {
  readonly originalExecutionId?: string;
  constructor(message: string, originalExecutionId?: string) {
    super(message, { httpStatus: 409, code: 'idempotency_conflict', retryable: false });
    this.name = 'KeeperHubIdempotencyConflictError';
    this.originalExecutionId = originalExecutionId;
  }
}

/** 409 `idempotency_in_progress` — the first request with this key is still running. Retry shortly. */
export class KeeperHubIdempotencyInProgressError extends KeeperHubError {
  constructor(message = 'A request with this Idempotency-Key is already in progress') {
    super(message, { httpStatus: 409, code: 'idempotency_in_progress', retryable: true });
    this.name = 'KeeperHubIdempotencyInProgressError';
  }
}

/** The execution (or workflow execution) reached a terminal `failed`/`error` state. */
export class KeeperHubExecutionFailedError extends KeeperHubError {
  readonly executionId: string;
  constructor(message: string, executionId: string) {
    super(message, { retryable: false });
    this.name = 'KeeperHubExecutionFailedError';
    this.executionId = executionId;
  }
}

/** The response body was not valid JSON, or did not match the expected shape. */
export class KeeperHubMalformedResponseError extends KeeperHubError {
  constructor(message: string, options: KeeperHubErrorOptions = {}) {
    super(message, options);
    this.name = 'KeeperHubMalformedResponseError';
  }
}

/** A required chain (e.g. Base Sepolia 84532) is missing or disabled for this org. */
export class KeeperHubChainUnavailableError extends KeeperHubError {
  constructor(message: string) {
    super(message, { retryable: false });
    this.name = 'KeeperHubChainUnavailableError';
  }
}
