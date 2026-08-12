/**
 * MintIntentV1 — the canonical typed intent an agent commits before it executes
 * a mint. ChainSRE later compares the confirmed on-chain action against this
 * committed intent and trips the guardian when they diverge.
 *
 * This is the v1 schema. Future intent kinds/versions get their own schema and
 * their own literal `schema` discriminant; nothing here is overloaded.
 */
import { z } from 'zod';

import { address, bytes32, selector, uintString } from './primitives';

export const MINT_INTENT_SCHEMA_ID = 'chainsre/mint-v1' as const;

export const mintIntentV1Schema = z
  .object({
    /** Discriminant identifying this intent kind + version. */
    schema: z.literal(MINT_INTENT_SCHEMA_ID),
    /** Unique id for this intent commitment. */
    intentId: bytes32,
    /** Chain the intent will execute on. */
    chainId: z.number().int().positive(),
    /** The agent (EOA/contract) that will submit the transaction. */
    agent: address,
    /** The contract the action targets (e.g. the vault). */
    target: address,
    /** Who receives the minted shares. */
    receiver: address,
    /** The 4-byte selector of the function the agent intends to call. */
    selector,
    /** Share amount as a base-10 string (never a JS float). */
    shares: uintString,
    /** Anti-replay nonce as a base-10 string. */
    nonce: uintString,
    /** Unix seconds after which the intent is no longer valid. */
    deadline: z.number().int().nonnegative(),
  })
  .strict();

export type MintIntentV1 = z.infer<typeof mintIntentV1Schema>;
