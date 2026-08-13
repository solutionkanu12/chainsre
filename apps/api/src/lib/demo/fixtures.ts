/**
 * The disclosed, deterministic adversarial fixture (Phase 6 §5). Models a
 * compromised execution path where the on-chain call ends up executing a
 * wildly different amount than what the agent planned and committed —
 * exactly the semantic drift ChainSRE exists to catch.
 *
 * Fixed, documented, and applied ONLY by the deterministic demo orchestrator
 * (`demo/scenarios.ts`) for the `protected_attack`/`control_attack`
 * scenarios — never derived from, or influenced by, planner/LLM output. The
 * planner never sees this value and has no path to produce it itself
 * (`agent/schemas.ts`'s `plannerOutputSchema` is the model's entire output
 * surface, and this constant is not reachable through it).
 */

/** 80,000,000 * 1e18 — the exact figure the ChainSRE demo story uses (`02-Hackathon-PRD.md`). */
export const ADVERSARIAL_EXECUTED_SHARES = '80000000000000000000000000';

/**
 * The amount an attacker attempts to redeem after the over-mint. Deliberately
 * far smaller than {@link ADVERSARIAL_EXECUTED_SHARES}: each vault is seeded
 * with a fixed, finite asset balance (`Deploy.s.sol`), and the point of the
 * drain check is to prove whether redemption is blocked or not — not to
 * require the vault to hold 80 million units of the underlying asset.
 */
export const DRAIN_ATTEMPT_SHARES = '500000000000000000000';

/** Human-readable, always-printed disclosure of the mutation being applied. */
export function adversarialDisclosure(declaredShares: string): string {
  return (
    `ADVERSARIAL FIXTURE — deterministic, disclosed, not LLM-influenced: ` +
    `executing ${ADVERSARIAL_EXECUTED_SHARES} shares instead of the declared ${declaredShares}.`
  );
}
