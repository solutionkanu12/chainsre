#!/usr/bin/env tsx
/**
 * ChainSRE Phase 6 — the real agent + demo orchestrator, runnable standalone
 * (no frontend, no Fastify route required).
 *
 * One command runs NORMAL, PROTECTED ATTACK, and CONTROL ATTACK end to end
 * against the real ChainSRE engine (Phase 2 contracts, Phase 3 KeeperHub
 * client, Phase 4 persistence, Phase 5 watcher/guardian, Phase 6 planner +
 * narrow tools):
 *
 *   pnpm --filter @chainsre/api demo:run                       # dry run (prints intent)
 *   CONFIRM_BROADCAST=yes pnpm --filter @chainsre/api demo:run # real, all three
 *   CONFIRM_BROADCAST=yes pnpm --filter @chainsre/api demo:run -- --scenario=protected_attack
 *
 * Safety model matches `watcher-run.ts`/`phase3-live-proof.ts`: nothing
 * writes anywhere unless `CONFIRM_BROADCAST=yes`. Nothing secret is ever
 * printed — only public evidence (run/execution/incident ids, tx hashes,
 * BaseScan links, on-chain read results) reaches stdout.
 *
 * With no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` configured, the planner runs
 * on the disclosed deterministic fallback (`agent/provider.ts`) — the demo
 * remains fully runnable either way, and every result reports which path
 * actually produced its intent.
 */
import { loadApiEnv } from '../src/config/env';
import { createSupabaseClients } from '../src/lib/supabase';
import { createBaseSepoliaClient, loadChainEnv } from '../src/lib/chain';
import { loadKeeperHubEnvWithGuardian } from '../src/lib/keeperhub';
import { loadAgentEnv, loadAgentProvider } from '../src/lib/agent';
import { runScenario, type ScenarioMode, type ScenarioResult } from '../src/lib/demo';

const DEFAULT_AGENT_ADDRESS: `0x${string}` = '0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB';
const ALL_SCENARIOS: readonly ScenarioMode[] = ['normal', 'protected_attack', 'control_attack'];

function confirmedBroadcast(): boolean {
  return process.env.CONFIRM_BROADCAST === 'yes';
}

function parseScenarios(): readonly ScenarioMode[] {
  const arg = process.argv.find((a) => a.startsWith('--scenario='));
  if (!arg) return ALL_SCENARIOS;
  const value = arg.slice('--scenario='.length);
  if (!ALL_SCENARIOS.includes(value as ScenarioMode)) {
    throw new Error(`--scenario must be one of ${ALL_SCENARIOS.join(', ')}, got "${value}"`);
  }
  return [value as ScenarioMode];
}

function explorerTxLink(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

function printResult(result: ScenarioResult): void {
  console.log(`[OK] ${result.mode} -> ${result.finalState}`);
  console.log(`  runId: ${result.runId}`);
  console.log(`  planner: ${result.plannerSource} (${result.plannerProviderName})`);
  console.log(
    `  declared shares=${result.declaredShares}  executed shares=${result.executedShares}`,
  );
  console.log(
    `  commit: executionId=${result.commit.executionId} tx=${result.commit.txHash ?? '(none)'} ` +
      (result.commit.txHash ? explorerTxLink(result.commit.txHash) : ''),
  );
  console.log(
    `  mint:   executionId=${result.mint.executionId} tx=${result.mint.txHash ?? '(none)'} ` +
      (result.mint.txHash ? explorerTxLink(result.mint.txHash) : ''),
  );
  if (result.incidentId) {
    console.log(
      `  incident: ${result.incidentId}  contained=${result.containmentSucceeded} ` +
        `detectionLatencyMs=${result.detectionLatencyMs ?? 'n/a'} containmentLatencyMs=${result.containmentLatencyMs ?? 'n/a'}`,
    );
  } else {
    console.log('  incident: none');
  }
  if (result.drainAttempt) {
    console.log(
      `  drain attempt: succeeded=${result.drainAttempt.succeeded} (${result.drainAttempt.reason})`,
    );
  }
}

async function main(): Promise<void> {
  console.log('=== ChainSRE Phase 6 — agent + demo orchestration ===');
  const scenarios = parseScenarios();
  console.log(
    `mode: ${confirmedBroadcast() ? 'REAL BROADCAST (CONFIRM_BROADCAST=yes)' : 'dry run'}`,
  );
  console.log(`scenarios: ${scenarios.join(', ')}`);
  console.log();

  if (!confirmedBroadcast()) {
    console.log(
      '[DRY RUN] Set CONFIRM_BROADCAST=yes to actually commit intents, execute mints, ' +
        'trigger containment, and attempt drains on Base Sepolia. No writes were made.',
    );
    return;
  }

  const apiEnv = loadApiEnv();
  const chainEnv = loadChainEnv();
  const keeperHubEnv = loadKeeperHubEnvWithGuardian();
  const agentEnv = loadAgentEnv();
  const agentProvider = loadAgentProvider(agentEnv);
  const agentAddress =
    (process.env.AGENT_ADDRESS as `0x${string}` | undefined) ?? DEFAULT_AGENT_ADDRESS;

  const supabase = createSupabaseClients(apiEnv);
  if (!supabase.service) {
    throw new Error(
      'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — the demo orchestrator writes ' +
        'demo_runs/intents/executions/incidents through the same service_role path the watcher uses.',
    );
  }
  const chainClient = createBaseSepoliaClient(chainEnv);

  console.log(`planner provider: ${agentProvider.name}`);
  console.log(`agent/receiver:   ${agentAddress}`);
  console.log(`registry:         ${chainEnv.INTENT_REGISTRY_ADDRESS}`);
  console.log(`protected vault:  ${chainEnv.PROTECTED_VAULT_ADDRESS}`);
  console.log(`control vault:    ${chainEnv.CONTROL_VAULT_ADDRESS}`);
  console.log();

  const results: ScenarioResult[] = [];
  let anyFailed = false;

  for (const mode of scenarios) {
    console.log(`--- running ${mode} ---`);
    try {
      const result = await runScenario(mode, {
        db: supabase.service,
        chainClient,
        chainEnv,
        keeperHubEnv,
        agentProvider,
        agentAddress,
        guardianWorkflowId: keeperHubEnv.KEEPERHUB_GUARDIAN_WORKFLOW_ID,
      });
      results.push(result);
      printResult(result);
    } catch (err) {
      anyFailed = true;
      console.error(`[XX] ${mode} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  console.log('=== Summary ===');
  for (const mode of scenarios) {
    const result = results.find((r) => r.mode === mode);
    console.log(`${result ? 'PASS' : 'FAIL'}  ${mode}${result ? `: ${result.finalState}` : ''}`);
  }
  if (anyFailed) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error();
  console.error('demo-run FAILED:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
