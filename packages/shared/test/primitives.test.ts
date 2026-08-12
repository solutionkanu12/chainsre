import { describe, expect, it } from 'vitest';

import { address, bytes32, selector, uintString } from '../src/schemas/primitives';

describe('primitives', () => {
  it('address normalizes to lowercase', () => {
    expect(address.parse(`0x${'A'.repeat(40)}`)).toBe(`0x${'a'.repeat(40)}`);
  });

  it('address rejects wrong length', () => {
    expect(() => address.parse('0x1234')).toThrow();
  });

  it('bytes32 requires 64 hex chars', () => {
    expect(bytes32.parse(`0x${'b'.repeat(64)}`)).toBe(`0x${'b'.repeat(64)}`);
    expect(() => bytes32.parse(`0x${'b'.repeat(63)}`)).toThrow();
  });

  it('selector requires 8 hex chars', () => {
    expect(selector.parse('0xA9059CBB')).toBe('0xa9059cbb');
    expect(() => selector.parse('0xa9059cb')).toThrow();
  });

  it('uintString accepts base-10 integers and rejects floats/negatives', () => {
    expect(uintString.parse('0')).toBe('0');
    expect(uintString.parse('123456789012345678901234567890')).toBe(
      '123456789012345678901234567890',
    );
    expect(() => uintString.parse('01')).toThrow();
    expect(() => uintString.parse('1.0')).toThrow();
    expect(() => uintString.parse('-1')).toThrow();
  });
});
