import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildMintIntent,
  computeIntentId,
  hashMintIntent,
  hashMintParams,
  isIntentIdValid,
  MINT_INTENT_SCHEMA_HASH,
  MINT_SHARES_SELECTOR,
  MINT_SHARES_SIGNATURE,
} from '../src/intent-hash';
import { mintIntentV1Schema } from '../src/schemas/intent';

/**
 * The golden vectors live with the Solidity tests and are read by both languages.
 * `IntentVectors.t.sol` asserts the same file against `IntentHashLib`, so if these two
 * suites pass, the Solidity and TypeScript canonicalizers provably agree.
 */
interface Vector {
  name: string;
  note: string;
  chainId: string;
  agent: `0x${string}`;
  target: `0x${string}`;
  selector: `0x${string}`;
  receiver: `0x${string}`;
  shares: string;
  deadline: string;
  nonce: string;
  paramsHash: `0x${string}`;
  intentId: `0x${string}`;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../contracts/test/fixtures/intent-vectors.json', import.meta.url)),
    'utf8',
  ),
) as {
  schema: string;
  schemaHash: `0x${string}`;
  mintSharesSelector: `0x${string}`;
  count: number;
  vectors: Vector[];
};

describe('golden intent vectors (shared with Solidity)', () => {
  it('fixture header matches the canonicalizer constants', () => {
    expect(fixture.schema).toBe('chainsre/mint-v1');
    expect(fixture.schemaHash).toBe(MINT_INTENT_SCHEMA_HASH);
    expect(fixture.mintSharesSelector).toBe(MINT_SHARES_SELECTOR);
  });

  it('covers the demo, control, cross-chain and boundary cases', () => {
    // Solidity cannot read a JSON array length, so the count is declared in the file.
    // Asserting it here is what stops the two from drifting apart.
    expect(fixture.count).toBe(fixture.vectors.length);
    expect(fixture.vectors.length).toBeGreaterThanOrEqual(6);
    expect(fixture.vectors.map((v) => v.name)).toContain('demo-normal-mint-950');
    expect(fixture.vectors.map((v) => v.name)).toContain('demo-overmint-80m');
  });

  for (const v of fixture.vectors) {
    it(`reproduces paramsHash and intentId for ${v.name}`, () => {
      expect(hashMintParams(v.receiver, v.shares)).toBe(v.paramsHash);
      expect(hashMintIntent(v)).toBe(v.intentId);
    });
  }

  it('is sensitive to every field in the hash domain', () => {
    const base = fixture.vectors[0]!;
    const ids = new Set<string>([hashMintIntent(base)]);
    const mutations = [
      { ...base, chainId: '1' },
      { ...base, agent: `0x${'a'.repeat(40)}` as const },
      { ...base, target: `0x${'b'.repeat(40)}` as const },
      { ...base, receiver: `0x${'c'.repeat(40)}` as const },
      { ...base, selector: '0xdeadbeef' as const },
      { ...base, shares: '951000000000000000000' },
      { ...base, deadline: '1897430401' },
      { ...base, nonce: '99' },
    ];
    for (const m of mutations) ids.add(hashMintIntent(m));
    expect(ids.size).toBe(mutations.length + 1);
  });

  it('the 950 and 80,000,000 demo intents hash differently', () => {
    const normal = fixture.vectors.find((v) => v.name === 'demo-normal-mint-950')!;
    const overmint = fixture.vectors.find((v) => v.name === 'demo-overmint-80m')!;
    expect(normal.intentId).not.toBe(overmint.intentId);
    expect(normal.paramsHash).not.toBe(overmint.paramsHash);
  });
});

describe('MINT_SHARES_SELECTOR', () => {
  it('is the selector of DemoVault.mintShares', () => {
    expect(MINT_SHARES_SIGNATURE).toBe('mintShares(bytes32,address,uint256)');
    expect(MINT_SHARES_SELECTOR).toMatch(/^0x[0-9a-f]{8}$/);
  });
});

describe('numeric safety', () => {
  const base = {
    chainId: 84532,
    agent: `0x${'1'.repeat(40)}`,
    target: `0x${'2'.repeat(40)}`,
    selector: MINT_SHARES_SELECTOR,
    receiver: `0x${'3'.repeat(40)}`,
    shares: '950000000000000000000',
    deadline: 1897430400,
    nonce: '1',
  } as const;

  it('rejects share amounts passed as JavaScript numbers', () => {
    // 950e18 is not exactly representable as a double; refusing the type is the
    // only way to guarantee the on-chain value is what the caller meant.
    expect(() => hashMintParams(base.receiver, 950e18 as unknown as string)).toThrow(TypeError);
  });

  it('rejects nonces passed as JavaScript numbers', () => {
    expect(() => hashMintIntent({ ...base, nonce: 1 as unknown as string })).toThrow(TypeError);
  });

  it('rejects non-integer and negative amount strings', () => {
    expect(() => hashMintParams(base.receiver, '1.5')).toThrow(TypeError);
    expect(() => hashMintParams(base.receiver, '-1')).toThrow(TypeError);
    expect(() => hashMintParams(base.receiver, '0x01')).toThrow(TypeError);
  });

  it('rejects values wider than their on-chain type', () => {
    expect(() => hashMintIntent({ ...base, nonce: (2n ** 64n).toString() })).toThrow(RangeError);
    expect(() => hashMintIntent({ ...base, deadline: (2n ** 64n).toString() })).toThrow(RangeError);
    expect(() => hashMintParams(base.receiver, (2n ** 256n).toString())).toThrow(RangeError);
  });

  it('treats bigint and base-10 string inputs identically', () => {
    expect(hashMintIntent({ ...base, shares: 950n * 10n ** 18n, nonce: 1n })).toBe(
      hashMintIntent(base),
    );
  });

  it('carries uint256-max share amounts without precision loss', () => {
    const max = (2n ** 256n - 1n).toString();
    expect(hashMintParams(base.receiver, max)).toBe(hashMintParams(base.receiver, 2n ** 256n - 1n));
  });
});

describe('buildMintIntent', () => {
  const input = {
    chainId: 84532,
    agent: `0x${'A'.repeat(40)}`,
    target: `0x${'B'.repeat(40)}`,
    selector: MINT_SHARES_SELECTOR,
    receiver: `0x${'C'.repeat(40)}`,
    shares: '950000000000000000000',
    deadline: 1897430400,
    nonce: '7',
  } as const;

  it('produces an intent that satisfies the shared schema', () => {
    const intent = buildMintIntent(input);
    expect(() => mintIntentV1Schema.parse(intent)).not.toThrow();
    expect(intent.schema).toBe('chainsre/mint-v1');
    expect(intent.agent).toBe(input.agent.toLowerCase());
  });

  it('derives an intentId that validates against its own body', () => {
    const intent = buildMintIntent(input);
    expect(isIntentIdValid(intent)).toBe(true);
    expect(computeIntentId(intent)).toBe(intent.intentId);
  });

  it('detects a tampered intentId', () => {
    const intent = buildMintIntent(input);
    expect(isIntentIdValid({ ...intent, shares: '80000000000000000000000000' })).toBe(false);
    expect(isIntentIdValid({ ...intent, intentId: `0x${'0'.repeat(64)}` })).toBe(false);
  });

  it('is case-insensitive on address input', () => {
    const lower = buildMintIntent({
      ...input,
      agent: input.agent.toLowerCase() as `0x${string}`,
      target: input.target.toLowerCase() as `0x${string}`,
      receiver: input.receiver.toLowerCase() as `0x${string}`,
    });
    expect(buildMintIntent(input).intentId).toBe(lower.intentId);
  });
});
