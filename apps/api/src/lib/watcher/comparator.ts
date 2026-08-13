/**
 * Deterministic code, not an LLM (`03-System-Architecture.md` §9): compares
 * the DECLARED mint (the plaintext `receiver`/`shares` the agent recorded in
 * `intents.params` before committing — see the module docstring in
 * `watcher.ts` for why the on-chain `IntentCommitted` event alone cannot
 * supply this, since it only carries the `paramsHash`, not its preimage)
 * against the CONFIRMED mint (a decoded `SharesMinted` event). `shares`
 * stays a `bigint`/decimal string throughout — never a JS `number`.
 */
import type { Hex } from 'viem';

import type { DecodedSharesMinted, MintComparison } from './types';

export interface DeclaredMintParams {
  readonly receiver: Hex;
  readonly shares: string;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function compareMint(
  declared: DeclaredMintParams,
  confirmed: DecodedSharesMinted,
): MintComparison {
  const expected = { receiver: declared.receiver, shares: declared.shares };
  const actual = { receiver: confirmed.receiver, shares: confirmed.shares.toString() };

  const mismatchFields: ('receiver' | 'shares')[] = [];
  if (normalizeAddress(expected.receiver) !== normalizeAddress(actual.receiver)) {
    mismatchFields.push('receiver');
  }
  if (expected.shares !== actual.shares) {
    mismatchFields.push('shares');
  }

  return {
    matched: mismatchFields.length === 0,
    expected,
    actual,
    mismatchFields,
  };
}
