import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The public env module validates NEXT_PUBLIC_* at import time. We reset the
 * module registry between cases so each import re-reads process.env.
 */
describe('web public env', () => {
  const original = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('NEXT_PUBLIC_')) delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('falls back to demo defaults when unset', async () => {
    const { publicEnv } = await import('../src/lib/env');
    expect(publicEnv.chainId).toBe(84532);
    expect(publicEnv.apiUrl).toBe('http://localhost:8080');
    expect(publicEnv.explorerUrl).toBe('https://sepolia.basescan.org');
    expect(publicEnv.protectedVaultAddress).toBeUndefined();
  });
});
