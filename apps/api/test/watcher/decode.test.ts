import { describe, expect, it } from 'vitest';

import { decodeLog } from '../../src/lib/watcher/decode';
import {
  intentCommittedLog,
  malformedSharesMintedLog,
  pausedLog,
  sharesMintedLog,
  sharesRedeemedLog,
  unpausedLog,
  unsupportedLog,
} from './support/fixtures';

const VAULT = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as const;
const REGISTRY = '0x6a78fcf6cb1bf7b45b98e262ee65965263bb23f9' as const;
const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as const;
const RECEIVER = '0x2222222222222222222222222222222222222222' as const;
const INTENT_ID = `0x${'a'.repeat(64)}` as const;

describe('decodeLog', () => {
  it('decodes a real-shaped IntentCommitted log', () => {
    const log = intentCommittedLog(
      {
        intentId: INTENT_ID,
        agent: AGENT,
        target: VAULT,
        selector: '0xdd10f8ca',
        paramsHash: `0x${'b'.repeat(64)}`,
        deadline: 1897430400n,
        nonce: 1n,
      },
      { address: REGISTRY, blockNumber: 100n },
    );
    const decoded = decodeLog(log);
    expect(decoded.kind).toBe('IntentCommitted');
    if (decoded.kind !== 'IntentCommitted') throw new Error('unreachable');
    expect(decoded.intentId).toBe(INTENT_ID);
    // viem decodes address-typed args to EIP-55 checksum case, regardless of
    // the case supplied — compare case-insensitively, same as the watcher's
    // own DB lookups do (Phase 4 stores/normalizes addresses lowercase).
    expect(decoded.agent.toLowerCase()).toBe(AGENT.toLowerCase());
    expect(decoded.target.toLowerCase()).toBe(VAULT.toLowerCase());
    expect(decoded.nonce).toBe(1n);
  });

  it('decodes a real-shaped SharesMinted log with a uint256 shares value', () => {
    const bigShares = 80_000_000n * 10n ** 18n;
    const log = sharesMintedLog(
      { intentId: INTENT_ID, operator: AGENT, receiver: RECEIVER, shares: bigShares },
      { address: VAULT, blockNumber: 101n },
    );
    const decoded = decodeLog(log);
    expect(decoded.kind).toBe('SharesMinted');
    if (decoded.kind !== 'SharesMinted') throw new Error('unreachable');
    expect(decoded.receiver).toBe(RECEIVER);
    expect(decoded.shares).toBe(bigShares);
    expect(typeof decoded.shares).toBe('bigint');
  });

  it('decodes SharesRedeemed, Paused, and Unpaused', () => {
    const redeemed = decodeLog(
      sharesRedeemedLog(
        { operator: RECEIVER, receiver: RECEIVER, shares: 950n, assets: 950n },
        { address: VAULT, blockNumber: 102n },
      ),
    );
    expect(redeemed.kind).toBe('SharesRedeemed');

    const paused = decodeLog(pausedLog(AGENT, { address: VAULT, blockNumber: 103n }));
    expect(paused.kind).toBe('Paused');

    const unpaused = decodeLog(unpausedLog(AGENT, { address: VAULT, blockNumber: 104n }));
    expect(unpaused.kind).toBe('Unpaused');
  });

  it('safely ignores a log matching no known event, never throwing', () => {
    const decoded = decodeLog(unsupportedLog({ address: VAULT, blockNumber: 105n }));
    expect(decoded.kind).toBe('Unsupported');
  });

  it('safely ignores a log with a known topic0 but malformed data, never throwing', () => {
    const decoded = decodeLog(malformedSharesMintedLog({ address: VAULT, blockNumber: 106n }));
    expect(decoded.kind).toBe('Unsupported');
  });
});
