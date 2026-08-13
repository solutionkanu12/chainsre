import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';

import { compareMint } from '../../src/lib/watcher/comparator';
import { decodeLog } from '../../src/lib/watcher/decode';
import { sharesMintedLog } from './support/fixtures';

const VAULT = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as const;
const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as const;
const RECEIVER = '0x2222222222222222222222222222222222222222' as const;
const INTENT_ID = `0x${'a'.repeat(64)}` as const;

function mintedEvent(shares: bigint, receiver: Hex = RECEIVER) {
  const decoded = decodeLog(
    sharesMintedLog(
      { intentId: INTENT_ID, operator: AGENT, receiver, shares },
      { address: VAULT, blockNumber: 1n },
    ),
  );
  if (decoded.kind !== 'SharesMinted') throw new Error('unreachable');
  return decoded;
}

describe('compareMint', () => {
  it('matches when the declared and confirmed shares/receiver are identical', () => {
    const declared = { receiver: RECEIVER, shares: '950000000000000000000' };
    const result = compareMint(declared, mintedEvent(950n * 10n ** 18n));
    expect(result.matched).toBe(true);
    expect(result.mismatchFields).toEqual([]);
  });

  it('the exact ChainSRE demo scenario: 950 declared vs 80,000,000 confirmed diverges on shares', () => {
    const declared = { receiver: RECEIVER, shares: '950000000000000000000' };
    const result = compareMint(declared, mintedEvent(80_000_000n * 10n ** 18n));
    expect(result.matched).toBe(false);
    expect(result.mismatchFields).toEqual(['shares']);
    expect(result.expected.shares).toBe('950000000000000000000');
    expect(result.actual.shares).toBe('80000000000000000000000000');
  });

  it('diverges on receiver alone when shares match but the recipient differs', () => {
    const declared = { receiver: RECEIVER, shares: '950000000000000000000' };
    const attacker = '0x9999999999999999999999999999999999999999'.slice(0, 42) as `0x${string}`;
    const result = compareMint(declared, mintedEvent(950n * 10n ** 18n, attacker));
    expect(result.matched).toBe(false);
    expect(result.mismatchFields).toEqual(['receiver']);
  });

  it('is case-insensitive on the receiver address', () => {
    const declared = {
      receiver: RECEIVER.toUpperCase().replace('0X', '0x') as `0x${string}`,
      shares: '1',
    };
    const result = compareMint(declared, mintedEvent(1n, RECEIVER));
    expect(result.mismatchFields).not.toContain('receiver');
  });

  it('never compares shares as a JS number — a value beyond 2^53 stays exact', () => {
    const huge = (2n ** 200n).toString();
    const declared = { receiver: RECEIVER, shares: huge };
    const result = compareMint(declared, mintedEvent(2n ** 200n));
    expect(result.matched).toBe(true);
  });
});
