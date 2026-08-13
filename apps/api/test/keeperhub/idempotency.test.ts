import { describe, expect, it } from 'vitest';

import { buildIdempotencyKey } from '../../src/lib/keeperhub/idempotency';

describe('buildIdempotencyKey', () => {
  it('follows the chainsre:{runId}:{step} convention', () => {
    expect(buildIdempotencyKey('run-123', 'commit')).toBe('chainsre:run-123:commit');
    expect(buildIdempotencyKey('run-123', 'mint')).toBe('chainsre:run-123:mint');
    expect(buildIdempotencyKey('run-123', 'pause')).toBe('chainsre:run-123:pause');
  });

  it('is deterministic: the same run+step always produces the same key', () => {
    const a = buildIdempotencyKey('run-abc', 'drain');
    const b = buildIdempotencyKey('run-abc', 'drain');
    expect(a).toBe(b);
  });

  it('produces distinct keys for distinct steps of the same run', () => {
    const commit = buildIdempotencyKey('run-abc', 'commit');
    const mint = buildIdempotencyKey('run-abc', 'mint');
    expect(commit).not.toBe(mint);
  });

  it('rejects a runId containing a colon (would make two runs collide)', () => {
    expect(() => buildIdempotencyKey('run:with:colons', 'commit')).toThrow(TypeError);
  });

  it('rejects an empty runId', () => {
    expect(() => buildIdempotencyKey('', 'commit')).toThrow(TypeError);
  });
});
