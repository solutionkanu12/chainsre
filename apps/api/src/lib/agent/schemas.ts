/**
 * The ONLY fields a planner (real or fallback) is ever allowed to decide:
 * `receiver` and `shares`. Everything else in the eventual `MintIntentV1`
 * (schema, intentId, chainId, agent, target, selector, deadline, nonce) is
 * supplied deterministically by the orchestrator — never derived from model
 * output — so a compromised or merely wrong model response can redirect
 * neither the target contract nor the acting agent, only (within this
 * narrow shape) who receives shares and how many.
 *
 * `.strict()` rejects any unexpected extra key outright — untrusted model
 * output does not get to smuggle additional fields through.
 */
import { z } from 'zod';

import { address, uintString } from '@chainsre/shared/schemas';

export const plannerOutputSchema = z
  .object({
    receiver: address,
    shares: uintString,
    /** Free-text explanation for the demo narrative — never parsed as instructions. */
    rationale: z.string().max(2000).optional(),
  })
  .strict();

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;
