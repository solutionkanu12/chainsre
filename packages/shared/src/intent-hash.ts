/**
 * Canonical hashing for `MintIntentV1`.
 *
 * This is the TypeScript half of a two-language contract. `IntentHashLib.sol` is the
 * Solidity half, and `IntentRegistry.commitIntent` recomputes the same hash on-chain and
 * rejects the commitment if it disagrees. The two implementations are pinned together by
 * a shared golden-vector fixture that both test suites read
 * (`packages/contracts/test/fixtures/intent-vectors.json`).
 *
 * Encoding rules (`03-System-Architecture.md` §8):
 *  - `paramsHash = keccak256(abi.encode(receiver, shares))`
 *  - `intentId = keccak256(abi.encode(schemaHash, chainId, agent, target, selector,
 *                                     paramsHash, deadline, nonce))`
 *  - Only `abi.encode` — never `encodePacked` — so distinct field tuples cannot collide.
 *  - The schema id is part of the hash domain, so a future v2 can never collide with v1.
 *
 * On-chain integers are `bigint` or base-10 strings here and never JavaScript `number`.
 * `shares` in particular is uint256-scale and would silently lose precision as a float.
 */
import { encodeAbiParameters, keccak256, stringToBytes, toFunctionSelector } from 'viem';
import type { Hex } from 'viem';

import { MINT_INTENT_SCHEMA_ID, type MintIntentV1 } from './schemas/intent';

/** `keccak256(bytes("chainsre/mint-v1"))` — the intent hash domain separator. */
export const MINT_INTENT_SCHEMA_HASH: Hex = keccak256(stringToBytes(MINT_INTENT_SCHEMA_ID));

/** The one action ChainSRE supervises in the MVP. */
export const MINT_SHARES_SIGNATURE = 'mintShares(bytes32,address,uint256)' as const;

/** 4-byte selector of `DemoVault.mintShares`. */
export const MINT_SHARES_SELECTOR: Hex = toFunctionSelector(`function ${MINT_SHARES_SIGNATURE}`);

const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

/**
 * A uint value accepted by the canonicalizer. `number` is deliberately excluded for
 * uint256-scale fields; base-10 strings and bigints are the only safe carriers.
 */
export type UintLike = bigint | string;

/**
 * Fields that determine an intent's identity. `intentId` is derived from these, so it is
 * not an input — passing it in could never change the result.
 */
export interface MintIntentHashInput {
  /** Chain the action executes on (84532 for the demo). */
  readonly chainId: UintLike | number;
  /** Address that commits the intent and then executes the action. */
  readonly agent: Hex;
  /** Contract the action targets (the vault). */
  readonly target: Hex;
  /** 4-byte selector the agent intends to call. */
  readonly selector: Hex;
  /** Who receives the minted shares. */
  readonly receiver: Hex;
  /** Share amount, uint256-scale. */
  readonly shares: UintLike;
  /** Unix seconds after which the intent is no longer valid, uint64. */
  readonly deadline: UintLike | number;
  /** Per-agent replay-protection nonce, uint64. */
  readonly nonce: UintLike;
}

/**
 * Convert a base-10 string or bigint to bigint, rejecting anything lossy.
 *
 * `number` is accepted only for fields explicitly documented as safe (`chainId`,
 * `deadline`) and only when it is a non-negative safe integer.
 */
function toBigInt(value: UintLike | number, field: string, allowNumber = false): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!allowNumber) {
      throw new TypeError(
        `${field} must be a bigint or base-10 string, not a number (precision loss)`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${field} must be a safe integer, got ${value}`);
    }
    return BigInt(value);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${field} must be a base-10 non-negative integer string, got "${value}"`);
  }
  return BigInt(value);
}

/**
 * Validate and lowercase a 20-byte address.
 *
 * Solidity has no notion of address casing, so the canonical preimage must not either:
 * the same address in checksum, upper, or lower case has to produce the same hash. This
 * also matches how the shared Zod schema normalizes addresses.
 */
function normalizeAddress(value: Hex, field: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError(`${field} must be a 20-byte 0x address, got "${String(value)}"`);
  }
  return value.toLowerCase() as Hex;
}

/** Validate and lowercase a 4-byte function selector. */
function normalizeSelector(value: Hex): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{8}$/.test(value)) {
    throw new TypeError(`selector must be a 4-byte 0x value, got "${String(value)}"`);
  }
  return value.toLowerCase() as Hex;
}

function assertRange(value: bigint, max: bigint, field: string): bigint {
  if (value < 0n || value > max) {
    throw new RangeError(`${field} out of range: ${value}`);
  }
  return value;
}

/** `keccak256(abi.encode(receiver, shares))`. */
export function hashMintParams(receiver: Hex, shares: UintLike): Hex {
  const sharesValue = assertRange(toBigInt(shares, 'shares'), UINT256_MAX, 'shares');
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'receiver', type: 'address' },
        { name: 'shares', type: 'uint256' },
      ],
      [normalizeAddress(receiver, 'receiver'), sharesValue],
    ),
  );
}

/** Canonical `intentId` for a v1 mint intent. Mirrors `IntentHashLib.hashIntent`. */
export function hashMintIntent(input: MintIntentHashInput): Hex {
  const chainId = assertRange(toBigInt(input.chainId, 'chainId', true), UINT256_MAX, 'chainId');
  const deadline = assertRange(toBigInt(input.deadline, 'deadline', true), UINT64_MAX, 'deadline');
  const nonce = assertRange(toBigInt(input.nonce, 'nonce'), UINT64_MAX, 'nonce');
  const paramsHash = hashMintParams(input.receiver, input.shares);

  return keccak256(
    encodeAbiParameters(
      [
        { name: 'schemaHash', type: 'bytes32' },
        { name: 'chainId', type: 'uint256' },
        { name: 'agent', type: 'address' },
        { name: 'target', type: 'address' },
        { name: 'selector', type: 'bytes4' },
        { name: 'paramsHash', type: 'bytes32' },
        { name: 'deadline', type: 'uint64' },
        { name: 'nonce', type: 'uint64' },
      ],
      [
        MINT_INTENT_SCHEMA_HASH,
        chainId,
        normalizeAddress(input.agent, 'agent'),
        normalizeAddress(input.target, 'target'),
        normalizeSelector(input.selector),
        paramsHash,
        deadline,
        nonce,
      ],
    ),
  );
}

/** Recompute the `intentId` a fully formed intent claims, ignoring its stored value. */
export function computeIntentId(intent: Omit<MintIntentV1, 'intentId'>): Hex {
  return hashMintIntent(intent);
}

/** Whether an intent's stored `intentId` is the canonical hash of its own fields. */
export function isIntentIdValid(intent: MintIntentV1): boolean {
  return computeIntentId(intent).toLowerCase() === intent.intentId.toLowerCase();
}

/**
 * Build a complete, self-consistent `MintIntentV1` with its `intentId` derived rather
 * than supplied, so callers cannot construct an intent whose id disagrees with its body.
 */
export function buildMintIntent(input: MintIntentHashInput): MintIntentV1 {
  const chainId = Number(toBigInt(input.chainId, 'chainId', true));
  const deadline = Number(toBigInt(input.deadline, 'deadline', true));
  const body = {
    schema: MINT_INTENT_SCHEMA_ID,
    chainId,
    agent: normalizeAddress(input.agent, 'agent'),
    target: normalizeAddress(input.target, 'target'),
    receiver: normalizeAddress(input.receiver, 'receiver'),
    selector: normalizeSelector(input.selector),
    shares: toBigInt(input.shares, 'shares').toString(),
    nonce: toBigInt(input.nonce, 'nonce').toString(),
    deadline,
  } satisfies Omit<MintIntentV1, 'intentId'>;

  return { ...body, intentId: hashMintIntent(input).toLowerCase() as Hex };
}
