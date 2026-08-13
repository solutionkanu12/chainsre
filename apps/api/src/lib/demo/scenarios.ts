/**
 * The deterministic demo orchestrator (Phase 6 §5-8). Drives one `demo_runs`
 * row through its full state machine (`packages/db/src/types.ts`'s
 * `DEMO_RUN_TRANSITIONS`), calling the planner once and the narrow agent
 * tools (`agent/tools.ts`) for commit/execute, then reusing the Phase 5
 * watcher tick verbatim for detection and containment, and finally attempting
 * a drain to prove containment's real effect.
 *
 * The LLM/planner is consulted exactly once, for the DECLARED intent. Every
 * later step — whether an attack fixture mutates the executed amount,
 * whether a divergence occurred, whether containment succeeded, whether the
 * drain was blocked — is decided entirely by deterministic code (the
 * comparator, the watcher, the chain itself). The planner never sees the
 * adversarial fixture and has no path to produce it.
 */
import {
  createDemoRun,
  getIncidentByIntentId,
  transitionDemoRun,
  type DbClient,
  type DemoRunStatus,
} from '@chainsre/db';
import { MINT_SHARES_SELECTOR } from '@chainsre/shared/intent-hash';
import type { Hex } from 'viem';

import { demoVaultAbi, type ChainEnv } from '../chain';
import {
  buildIdempotencyKey,
  executeContractCallSafely,
  KeeperHubSimulationRevertError,
  type ContractCallRequest,
  type KeeperHubEnv,
} from '../keeperhub';
import type { AgentProvider } from '../agent/provider';
import { planMintIntent } from '../agent/planner';
import { commitTypedIntentTool, executeApprovedMintTool, type ToolContext } from '../agent/tools';
import { runWatcherTick, type ChainReader, type WatcherConfig, type WatcherDeps } from '../watcher';
import {
  ADVERSARIAL_EXECUTED_SHARES,
  DRAIN_ATTEMPT_SHARES,
  adversarialDisclosure,
} from './fixtures';

export type ScenarioMode = 'normal' | 'protected_attack' | 'control_attack';

export interface ScenarioDeps {
  readonly db: DbClient;
  readonly chainClient: ChainReader;
  readonly chainEnv: ChainEnv;
  readonly keeperHubEnv: KeeperHubEnv;
  readonly agentProvider: AgentProvider;
  readonly agentAddress: Hex;
  readonly guardianWorkflowId: string;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly plannerTimeoutMs?: number;
  /**
   * Overrides for the intent's `deadline`/`nonce`. Production always omits
   * these (real wall-clock deadline, `Date.now()`-derived nonce); tests
   * supply fixed values so the resulting `intentId` is predictable ahead of
   * time — needed to pre-seed a matching confirmed-log fixture.
   */
  readonly deadline?: number;
  readonly nonce?: bigint;
}

export interface DrainAttemptResult {
  readonly succeeded: boolean;
  readonly executionId?: string;
  readonly txHash?: Hex;
  readonly reason: string;
}

export interface ScenarioResult {
  readonly mode: ScenarioMode;
  readonly runId: string;
  readonly finalState: DemoRunStatus;
  readonly vaultAddress: Hex;
  readonly plannerSource: 'llm' | 'deterministic-fallback';
  readonly plannerProviderName: string;
  readonly declaredShares: string;
  readonly executedShares: string;
  readonly commit: {
    readonly dbIntentId: string;
    readonly intentId: Hex;
    readonly executionId: string;
    readonly txHash?: Hex;
  };
  readonly mint: { readonly executionId: string; readonly txHash?: Hex };
  readonly incidentId: string | null;
  readonly containmentAttempted: boolean;
  readonly containmentSucceeded: boolean;
  readonly drainAttempt: DrainAttemptResult | null;
  readonly detectionLatencyMs: number | null;
  readonly containmentLatencyMs: number | null;
}

const BUSINESS_REQUEST =
  "Mint DemoVault shares to the agent's own wallet equal to a standard purchase of 950 units.";

function vaultAddressFor(mode: ScenarioMode, chainEnv: ChainEnv): Hex {
  return (
    mode === 'control_attack' ? chainEnv.CONTROL_VAULT_ADDRESS : chainEnv.PROTECTED_VAULT_ADDRESS
  ) as Hex;
}

async function attemptDrain(
  deps: ScenarioDeps,
  vaultAddress: Hex,
  runId: string,
): Promise<DrainAttemptResult> {
  const req: ContractCallRequest = {
    contractAddress: vaultAddress,
    chainId: deps.chainEnv.CHAIN_ID,
    functionName: 'redeemShares',
    functionArgs: [DRAIN_ATTEMPT_SHARES, deps.agentAddress],
    abi: demoVaultAbi.filter((f) => f.name === 'redeemShares'),
  };
  try {
    const execution = await executeContractCallSafely(
      deps.keeperHubEnv,
      req,
      buildIdempotencyKey(runId, 'drain'),
      { fetchImpl: deps.fetchImpl },
    );
    return {
      succeeded: true,
      executionId: execution.executionId,
      txHash: execution.transactionHash,
      reason: 'redeemShares simulated and broadcast successfully — the vault was not paused',
    };
  } catch (err) {
    if (err instanceof KeeperHubSimulationRevertError) {
      return {
        succeeded: false,
        reason: `blocked: simulation reverted (${err.revertReason ?? 'vault paused'})`,
      };
    }
    throw err;
  }
}

/**
 * Run one scenario end to end. Throws only for a genuine infrastructure
 * fault OR a demonstrated safety-property violation (containment expected
 * but absent, drain expected to be blocked but succeeded, or vice versa) —
 * every ordinary step failure is first persisted as the matching
 * `demo_runs` terminal state before the error propagates.
 */
export async function runScenario(mode: ScenarioMode, deps: ScenarioDeps): Promise<ScenarioResult> {
  const vaultAddress = vaultAddressFor(mode, deps.chainEnv);
  const run = await createDemoRun(deps.db, {
    mode,
    vault_address: vaultAddress,
    started_by: deps.agentAddress,
  });
  const runId = run.id;

  const toolCtx: ToolContext = {
    db: deps.db,
    chainClient: deps.chainClient,
    chainEnv: deps.chainEnv,
    keeperHubEnv: deps.keeperHubEnv,
    fetchImpl: deps.fetchImpl,
  };

  await transitionDemoRun(deps.db, runId, 'planning');
  let plan;
  try {
    plan = await planMintIntent(
      {
        runId,
        agent: deps.agentAddress,
        target: vaultAddress,
        receiver: deps.agentAddress,
        businessRequest: BUSINESS_REQUEST,
      },
      deps.agentProvider,
      {
        chainId: deps.chainEnv.CHAIN_ID,
        agent: deps.agentAddress,
        target: vaultAddress,
        selector: MINT_SHARES_SELECTOR,
        deadline: deps.deadline ?? Math.floor(Date.now() / 1000) + 2 * 60 * 60,
        nonce: deps.nonce ?? BigInt(Date.now()),
      },
      { timeoutMs: deps.plannerTimeoutMs ?? 15_000, fetchImpl: deps.fetchImpl },
    );
  } catch (err) {
    await transitionDemoRun(deps.db, runId, 'planning_failed').catch(() => undefined);
    throw err;
  }

  await transitionDemoRun(deps.db, runId, 'committing');
  let commit;
  try {
    commit = await commitTypedIntentTool(toolCtx, { runId, intent: plan.intent });
  } catch (err) {
    await transitionDemoRun(deps.db, runId, 'commit_failed').catch(() => undefined);
    throw err;
  }
  await transitionDemoRun(deps.db, runId, 'committed');

  await transitionDemoRun(deps.db, runId, 'executing');
  const override =
    mode === 'normal'
      ? undefined
      : {
          shares: ADVERSARIAL_EXECUTED_SHARES,
          disclosureReason: adversarialDisclosure(plan.intent.shares),
        };
  let mint;
  try {
    mint = await executeApprovedMintTool(
      toolCtx,
      { runId, dbIntentId: commit.dbIntentId },
      override,
    );
  } catch (err) {
    await transitionDemoRun(deps.db, runId, 'action_failed').catch(() => undefined);
    throw err;
  }
  await transitionDemoRun(deps.db, runId, 'confirmed', { executed_amount: mint.sharesExecuted });

  await transitionDemoRun(deps.db, runId, 'evaluating');
  try {
    const watcherConfig: WatcherConfig = {
      chainId: deps.chainEnv.CHAIN_ID,
      registryAddress: deps.chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
      vaultAddresses: [
        deps.chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
        deps.chainEnv.CONTROL_VAULT_ADDRESS as Hex,
      ],
      guardianWorkflowId: deps.guardianWorkflowId,
      // A demo run needs its own just-mined block picked up in the very next
      // tick — no lag budget like the standalone watcher's default.
      confirmations: 0,
      startBlock: 0n,
    };
    const watcherDeps: WatcherDeps = {
      db: deps.db,
      chainClient: deps.chainClient,
      keeperHubEnv: deps.keeperHubEnv,
      sleep: deps.sleep,
      fetchImpl: deps.fetchImpl,
    };
    await runWatcherTick(watcherConfig, watcherDeps, runId);
  } catch (err) {
    await transitionDemoRun(deps.db, runId, 'detection_timeout').catch(() => undefined);
    throw err;
  }

  await transitionDemoRun(deps.db, runId, 'responding');
  let incidentId: string | null = null;
  let containmentAttempted = false;
  let containmentSucceeded = false;
  let detectionLatencyMs: number | null = null;
  let containmentLatencyMs: number | null = null;
  if (mode !== 'normal') {
    const incident = await getIncidentByIntentId(deps.db, commit.dbIntentId);
    if (incident) {
      incidentId = incident.id;
      containmentAttempted = incident.containment_locked_at !== null;
      containmentSucceeded = incident.state === 'contained';
      detectionLatencyMs = incident.detection_latency_ms;
      containmentLatencyMs = incident.containment_latency_ms;
    }
    if (mode === 'protected_attack' && !containmentSucceeded) {
      await transitionDemoRun(deps.db, runId, 'containment_failed').catch(() => undefined);
      throw new Error(
        incident
          ? `protected_attack expected containment but the incident ended in state "${incident.state}"`
          : 'protected_attack expected an incident to be detected but none was created',
      );
    }
  }

  await transitionDemoRun(deps.db, runId, 'testing_containment');
  let drainAttempt: DrainAttemptResult | null = null;
  if (mode !== 'normal') {
    drainAttempt = await attemptDrain(deps, vaultAddress, runId);
    const expectBlocked = mode === 'protected_attack';
    if (drainAttempt.succeeded === expectBlocked) {
      await transitionDemoRun(deps.db, runId, 'containment_failed').catch(() => undefined);
      throw new Error(
        `${mode} expected the drain attempt to ${expectBlocked ? 'fail' : 'succeed'} but it ${
          drainAttempt.succeeded ? 'succeeded' : 'failed'
        }`,
      );
    }
  }

  const final = await transitionDemoRun(deps.db, runId, 'completed', {
    completed_at: new Date().toISOString(),
  });

  return {
    mode,
    runId,
    finalState: final.status,
    vaultAddress,
    plannerSource: plan.source,
    plannerProviderName: plan.providerName,
    declaredShares: plan.intent.shares,
    executedShares: mint.sharesExecuted,
    commit,
    mint: { executionId: mint.executionId, txHash: mint.txHash },
    incidentId,
    containmentAttempted,
    containmentSucceeded,
    drainAttempt,
    detectionLatencyMs,
    containmentLatencyMs,
  };
}
