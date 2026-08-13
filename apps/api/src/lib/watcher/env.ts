/**
 * Watcher runtime configuration. Separate from `chain/env.ts` (contract
 * addresses) and `keeperhub/env.ts` (credentials) — this is the tuning knobs
 * only the watcher cares about, matching the project's per-concern env module
 * pattern.
 */
import { parseEnv } from '@chainsre/shared/env';
import { z } from 'zod';

const watcherEnvSchema = z.object({
  /** How many blocks behind head an event must be to count as confirmed. */
  WATCHER_CONFIRMATIONS: z.coerce.number().int().min(0).default(1),
  /** Wait between polls when idle (ms). */
  WATCHER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(4000),
  /** Max blocks fetched in a single `eth_getLogs` call — bounds RPC load per tick. */
  WATCHER_MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(2000),
  /** Bounded retry budget for a single provider call within one tick. */
  WATCHER_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(1).default(5),
});

export type WatcherEnv = z.infer<typeof watcherEnvSchema>;

export function loadWatcherEnv(source?: Record<string, string | undefined>): WatcherEnv {
  return parseEnv(watcherEnvSchema, source ? { source } : {});
}
