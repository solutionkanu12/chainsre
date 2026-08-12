import { describe, expect, it } from 'vitest';

import { addressUrl, blockUrl, tokenUrl, txUrl } from '../src/explorer';

describe('explorer', () => {
  const tx = '0xabc';
  const addr = '0x1234567890123456789012345678901234567890';

  it('builds Base Sepolia URLs', () => {
    expect(txUrl(84532, tx)).toBe('https://sepolia.basescan.org/tx/0xabc');
    expect(addressUrl(84532, addr)).toBe(`https://sepolia.basescan.org/address/${addr}`);
    expect(blockUrl(84532, 100)).toBe('https://sepolia.basescan.org/block/100');
    expect(tokenUrl(84532, addr)).toBe(`https://sepolia.basescan.org/token/${addr}`);
  });

  it('handles bigint block numbers', () => {
    expect(blockUrl(84532, 100n)).toBe('https://sepolia.basescan.org/block/100');
  });

  it('throws on unsupported chains', () => {
    expect(() => txUrl(42, tx)).toThrow(/Unsupported chainId/);
  });
});
