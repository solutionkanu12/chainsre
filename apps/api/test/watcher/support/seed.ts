/**
 * Fixture arrangement for the watcher's behavioral tests: a `demo_runs` row
 * plus the `intents` row it declares, created through the REAL repository
 * functions (`@chainsre/db`) — not raw SQL — so a test's baseline data goes
 * through the same validation/normalization production code does. This is
 * the plaintext `intents.params` baseline `compareMint` checks a confirmed
 * `SharesMinted` event against (see `watcher.ts`'s module docstring on why
 * the chain alone cannot supply it).
 */
import { createDemoRun, createIntent, type DbClient, type Intent } from '@chainsre/db';
import type { Hex } from 'viem';

export interface SeedIntentOpts {
  readonly intentId: Hex;
  readonly agent: Hex;
  readonly target: Hex;
  readonly receiver: Hex;
  readonly shares: string;
  readonly chainId?: number;
  /** `intents` enforces `unique (agent_address, nonce)` — override if a test needs a specific value. */
  readonly nonce?: string;
}

let nonceCounter = 0;

export async function seedIntent(db: DbClient, opts: SeedIntentOpts): Promise<Intent> {
  const run = await createDemoRun(db, {
    mode: 'protected_attack',
    vault_address: opts.target,
    started_by: opts.agent,
  });
  nonceCounter += 1;
  return createIntent(db, {
    run_id: run.id,
    agent_address: opts.agent,
    chain_id: opts.chainId ?? 84_532,
    target_address: opts.target,
    selector: '0xdd10f8ca',
    params: { receiver: opts.receiver, shares: opts.shares },
    params_hash: `0x${'b'.repeat(64)}`,
    intent_hash: opts.intentId,
    nonce: opts.nonce ?? String(nonceCounter),
    deadline: Math.floor(Date.now() / 1000) + 3600,
  });
}
