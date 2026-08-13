#!/usr/bin/env tsx
/**
 * ChainSRE Phase 5 — the real watcher, runnable standalone (no frontend, no
 * Fastify route required).
 *
 * Polls confirmed Base Sepolia blocks for `IntentCommitted` and DemoVault
 * `SharesMinted`/`SharesRedeemed`/`Paused`/`Unpaused` events, persists a
 * resumable cursor, correlates a confirmed mint against its declared intent,
 * and — on divergence — creates exactly one incident and drives it through
 * containment via the real KeeperHub guardian workflow, independently
 * verifying `paused()` before ever calling it contained.
 *
 * Safety model matches `phase3-live-proof.ts`: detection is safe, reversible
 * DB state and always runs; the real guardian trigger (an irreversible
 * on-chain write) requires `CONFIRM_BROADCAST=yes`. Without it, the watcher
 * still detects and persists incidents, but logs what containment step it
 * would have taken instead of taking it.
 *
 * Usage:
 *   pnpm --filter @chainsre/api watcher:run                    # detect-only
 *   CONFIRM_BROADCAST=yes pnpm --filter @chainsre/api watcher:run
 *
 * Stops cleanly on SIGINT/SIGTERM. Optional WATCHER_MAX_TICKS bounds the run
 * (e.g. for a scripted demo) — unset means run until stopped.
 */
import { loadApiEnv } from '../src/config/env';
import { createSupabaseClients } from '../src/lib/supabase';
import { createBaseSepoliaClient, loadChainEnv } from '../src/lib/chain';
import { loadKeeperHubEnvWithGuardian } from '../src/lib/keeperhub';
import { loadWatcherEnv, runWatcherTick, type WatcherConfig } from '../src/lib/watcher';

function confirmedBroadcast(): boolean {
  return process.env.CONFIRM_BROADCAST === 'yes';
}

async function main(): Promise<void> {
  console.log('=== ChainSRE Phase 5 — watcher ===');
  console.log(
    `containment: ${confirmedBroadcast() ? 'ENABLED (CONFIRM_BROADCAST=yes)' : 'detect-only (dry run)'}`,
  );
  console.log();

  const apiEnv = loadApiEnv();
  const chainEnv = loadChainEnv();
  const keeperHubEnv = loadKeeperHubEnvWithGuardian();
  const watcherEnv = loadWatcherEnv();

  const supabase = createSupabaseClients(apiEnv);
  if (!supabase.service) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — the watcher writes intents/incidents/' +
        'executions/chain_cursors, all service_role-only tables (see 0002_application_data.sql).',
    );
  }

  const chainClient = createBaseSepoliaClient(chainEnv);
  const runId = process.env.CHAINSRE_RUN_ID ?? `watcher-${Date.now()}`;
  console.log(`runId: ${runId}`);
  console.log(`registry: ${chainEnv.INTENT_REGISTRY_ADDRESS}`);
  console.log(`vaults:   ${chainEnv.PROTECTED_VAULT_ADDRESS}, ${chainEnv.CONTROL_VAULT_ADDRESS}`);
  console.log();

  const config: WatcherConfig = {
    chainId: chainEnv.CHAIN_ID,
    registryAddress: chainEnv.INTENT_REGISTRY_ADDRESS as `0x${string}`,
    vaultAddresses: [
      chainEnv.PROTECTED_VAULT_ADDRESS as `0x${string}`,
      chainEnv.CONTROL_VAULT_ADDRESS as `0x${string}`,
    ],
    guardianWorkflowId: keeperHubEnv.KEEPERHUB_GUARDIAN_WORKFLOW_ID,
    confirmations: watcherEnv.WATCHER_CONFIRMATIONS,
    maxBlockRange: watcherEnv.WATCHER_MAX_BLOCK_RANGE,
    providerRetryAttempts: watcherEnv.WATCHER_PROVIDER_RETRY_ATTEMPTS,
  };

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`\nreceived ${signal}, stopping after the current tick...`);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const maxTicks = process.env.WATCHER_MAX_TICKS
    ? Number(process.env.WATCHER_MAX_TICKS)
    : undefined;
  let tick = 0;

  while (!stopping) {
    tick++;
    try {
      const result = await runWatcherTick(
        config,
        {
          db: supabase.service,
          chainClient,
          keeperHubEnv,
          containmentEnabled: confirmedBroadcast(),
        },
        runId,
      );

      if (result.hadWork) {
        console.log(
          `[tick ${tick}] blocks ${result.fromBlock}-${result.toBlock} | ` +
            `logs=${result.logsScanned} matched=${result.matchedMints} ` +
            `incidents=${result.incidentsCreated}(+${result.incidentsAlreadyExisted} dup) ` +
            `contained=${result.containmentsSucceeded} failed=${result.containmentsFailed} ` +
            `unenrolled=${result.unenrolledSkipped} uncorrelated=${result.uncorrelatedSkipped} ` +
            `unsupported=${result.unsupportedSkipped}`,
        );
      }
    } catch (err) {
      // A provider/DB fault on one tick must not kill the process — the
      // cursor only advances on success, so the next tick safely re-scans.
      console.error(`[tick ${tick}] failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (maxTicks && tick >= maxTicks) break;
    if (stopping) break;
    await new Promise((resolve) => setTimeout(resolve, watcherEnv.WATCHER_POLL_INTERVAL_MS));
  }

  console.log('watcher stopped.');
}

void main();
