/**
 * Reusable Zod primitives for on-chain data. These normalize casing and shape
 * so downstream schemas (intents, executions, HTTP payloads) share one
 * definition of "what an address looks like".
 */
import { z } from 'zod';

/** Any 0x-prefixed hex string of even length. */
export const hexString = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, 'must be a 0x-prefixed hex string');

/** A 20-byte EVM address, normalized to lowercase and typed as `0x${string}`. */
export const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte 0x address')
  .transform((s) => s.toLowerCase() as `0x${string}`);

/** A 32-byte value (hash, id), normalized to lowercase. */
export const bytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte 0x value')
  .transform((s) => s.toLowerCase() as `0x${string}`);

/** A 4-byte function selector, normalized to lowercase. */
export const selector = z
  .string()
  .regex(/^0x[0-9a-fA-F]{8}$/, 'must be a 4-byte 0x selector')
  .transform((s) => s.toLowerCase() as `0x${string}`);

/**
 * A non-negative integer expressed as a base-10 string. On-chain amounts can
 * exceed Number.MAX_SAFE_INTEGER, so they are always carried as strings and
 * never parsed into a JS float.
 */
export const uintString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'must be a base-10 non-negative integer string');

export type Address = z.infer<typeof address>;
export type Bytes32 = z.infer<typeof bytes32>;
export type Selector = z.infer<typeof selector>;
