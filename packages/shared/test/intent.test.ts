import { describe, expect, it } from 'vitest';

import {
  MINT_INTENT_SCHEMA_ID,
  mintIntentV1Schema,
  type MintIntentV1,
} from '../src/schemas/intent';

const valid: MintIntentV1 = {
  schema: MINT_INTENT_SCHEMA_ID,
  intentId: `0x${'a'.repeat(64)}`,
  chainId: 84532,
  agent: `0x${'1'.repeat(40)}`,
  target: `0x${'2'.repeat(40)}`,
  receiver: `0x${'3'.repeat(40)}`,
  selector: '0xa9059cbb',
  shares: '1000000000000000000',
  nonce: '0',
  deadline: 1893456000,
};

describe('mintIntentV1Schema', () => {
  it('accepts a well-formed intent and lowercases hex', () => {
    const parsed = mintIntentV1Schema.parse({
      ...valid,
      agent: `0x${'A'.repeat(40)}`,
    });
    expect(parsed.agent).toBe(`0x${'a'.repeat(40)}`);
    expect(parsed.schema).toBe('chainsre/mint-v1');
  });

  it('keeps large share amounts as strings (no float coercion)', () => {
    const big = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const parsed = mintIntentV1Schema.parse({ ...valid, shares: big });
    expect(parsed.shares).toBe(big);
    expect(typeof parsed.shares).toBe('string');
  });

  it('rejects an unknown schema discriminant', () => {
    expect(() => mintIntentV1Schema.parse({ ...valid, schema: 'chainsre/burn-v1' })).toThrow();
  });

  it('rejects malformed addresses', () => {
    expect(() => mintIntentV1Schema.parse({ ...valid, agent: '0x123' })).toThrow();
  });

  it('rejects non-integer share strings', () => {
    expect(() => mintIntentV1Schema.parse({ ...valid, shares: '1.5' })).toThrow();
    expect(() => mintIntentV1Schema.parse({ ...valid, shares: '-1' })).toThrow();
  });

  it('is strict: rejects unknown keys', () => {
    expect(() => mintIntentV1Schema.parse({ ...valid, extra: true })).toThrow();
  });
});
