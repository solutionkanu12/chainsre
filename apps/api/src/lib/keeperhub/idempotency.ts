/**
 * Deterministic idempotency keys, sent as the `Idempotency-Key` HTTP header
 * (confirmed in `PHASE-0-RESULTS.md` §1 — it is a header, not a body field).
 *
 * One key per logical run step. Reusing a key for a run step always sends the
 * exact same request body, so a KeeperHub-side retry either replays the
 * original result or — if the body somehow drifted — surfaces as a clean
 * `idempotency_conflict` rather than a silent double broadcast.
 */

const KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeSegment(value: string, field: string): void {
  if (value.length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
  if (!KEY_PATTERN.test(value)) {
    throw new TypeError(
      `${field} must match ${KEY_PATTERN} (got "${value}") — an idempotency key must stay stable ` +
        'across retries, so it cannot contain ":" or other characters that could make two distinct ' +
        'runs collide or one run split across two keys',
    );
  }
}

/** The run steps ChainSRE ever puts through KeeperHub. Kept narrow on purpose. */
export type ChainSREStep = 'commit' | 'mint' | 'pause' | 'drain';

/**
 * Build `chainsre:{runId}:{step}` (`03-System-Architecture.md` §6). `runId` should
 * be unique per demo run (e.g. a UUID or `phase3-proof-<timestamp>`), never reused
 * across two logically different attempts.
 */
export function buildIdempotencyKey(runId: string, step: ChainSREStep): string {
  assertSafeSegment(runId, 'runId');
  return `chainsre:${runId}:${step}`;
}
