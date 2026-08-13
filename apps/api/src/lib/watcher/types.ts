/**
 * Watcher domain types. Every "confirmed on-chain" value here is a `bigint`
 * or a `0x`-prefixed hex string — never a JS `number` — matching the
 * uint256-safety rule the rest of this codebase already follows.
 */
import type { Hex, Log, PublicClient } from 'viem';

/**
 * The minimal chain-read surface the watcher needs, expressed structurally
 * (matching `packages/db`'s `DbClient` pattern) so production code passes a
 * real viem `PublicClient` and tests pass a lightweight fake without either
 * side needing an adapter.
 */
export type ChainReader = Pick<
  PublicClient,
  'getBlockNumber' | 'getLogs' | 'readContract' | 'getBlock'
>;

export type DecodedEventKind =
  'IntentCommitted' | 'SharesMinted' | 'SharesRedeemed' | 'Paused' | 'Unpaused';

interface DecodedBase {
  readonly address: Hex;
  readonly blockNumber: bigint;
  readonly transactionHash: Hex;
  readonly logIndex: number;
}

export interface DecodedIntentCommitted extends DecodedBase {
  readonly kind: 'IntentCommitted';
  readonly intentId: Hex;
  readonly agent: Hex;
  readonly target: Hex;
  readonly selector: Hex;
  readonly paramsHash: Hex;
  readonly deadline: bigint;
  readonly nonce: bigint;
}

export interface DecodedSharesMinted extends DecodedBase {
  readonly kind: 'SharesMinted';
  readonly intentId: Hex;
  readonly operator: Hex;
  readonly receiver: Hex;
  readonly shares: bigint;
}

export interface DecodedSharesRedeemed extends DecodedBase {
  readonly kind: 'SharesRedeemed';
  readonly operator: Hex;
  readonly receiver: Hex;
  readonly shares: bigint;
  readonly assets: bigint;
}

export interface DecodedPaused extends DecodedBase {
  readonly kind: 'Paused';
  readonly account: Hex;
}

export interface DecodedUnpaused extends DecodedBase {
  readonly kind: 'Unpaused';
  readonly account: Hex;
}

export type DecodedEvent =
  | DecodedIntentCommitted
  | DecodedSharesMinted
  | DecodedSharesRedeemed
  | DecodedPaused
  | DecodedUnpaused;

/** A raw log the decoder could not identify as any known event — safely skipped. */
export interface UnsupportedLog {
  readonly kind: 'Unsupported';
  readonly address: Hex;
  readonly transactionHash: Hex | null;
  readonly logIndex: number | null;
  readonly reason: string;
}

export type DecodeResult = DecodedEvent | UnsupportedLog;

export function isUnsupported(result: DecodeResult): result is UnsupportedLog {
  return result.kind === 'Unsupported';
}

/** A viem log shape broad enough to cover both real and fixture logs. */
export type RawLog = Log<bigint, number, boolean>;

/** Declared vs. confirmed mint parameters, and the field-level diff between them. */
export interface MintComparison {
  readonly matched: boolean;
  readonly expected: { readonly receiver: Hex; readonly shares: string };
  readonly actual: { readonly receiver: Hex; readonly shares: string };
  readonly mismatchFields: readonly ('receiver' | 'shares')[];
}
