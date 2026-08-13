/**
 * The narrow, agent-callable tool surface (Phase 6 §4). Exactly three tools
 * exist and every one of them takes a small, `.strict()` Zod-validated input
 * — never a raw contract address, ABI, function name, RPC client, DB client,
 * or KeeperHub credential. An LLM (or anything else) driving these tools can
 * never do more than: declare a mint intent for one of the two known vaults,
 * execute an already-committed intent by reference, or read back structured
 * run state. There is no fourth tool and no escape hatch to arbitrary
 * calldata.
 *
 * `executeApprovedMintTool`'s `internalOverride` parameter is deliberately
 * NOT part of any Zod schema and cannot be supplied through the tool's JSON
 * input — it is a plain TypeScript argument only the orchestrator
 * (`demo/scenarios.ts`, itself deterministic, non-LLM code) can pass. This is
 * the actual security boundary behind "never let the LLM decide whether
 * divergence occurred": the LLM's own input surface has no field that could
 * ever reach it.
 */
import { z } from 'zod';

import {
  createExecution,
  createIntent,
  getDemoRun,
  getIntent,
  listIncidentsByRunId,
  listIntentsByRunId,
  markIntentCommitFailed,
  markIntentCommitted,
  recordExecutionOutcome,
  type DbClient,
  type DemoRun,
  type Execution,
  type Incident,
  type Intent,
} from '@chainsre/db';
import {
  hashMintParams,
  isIntentIdValid,
  MINT_SHARES_SELECTOR,
} from '@chainsre/shared/intent-hash';
import { mintIntentV1Schema, type MintIntentV1 } from '@chainsre/shared/schemas';
import type { Hex } from 'viem';

import {
  demoVaultAbi,
  intentRegistryAbi,
  readIsCommitted,
  readSharesOf,
  type ChainEnv,
} from '../chain';
import type { ChainReader } from '../watcher/types';
import {
  buildIdempotencyKey,
  executeContractCallSafely,
  type ContractCallRequest,
  type KeeperHubEnv,
} from '../keeperhub';
import { UnsafeToolRequestError } from './errors';

export interface ToolContext {
  readonly db: DbClient;
  readonly chainClient: ChainReader;
  readonly chainEnv: ChainEnv;
  readonly keeperHubEnv: KeeperHubEnv;
  readonly fetchImpl?: typeof fetch;
}

function allowedVaults(chainEnv: ChainEnv): Set<string> {
  return new Set(
    [chainEnv.PROTECTED_VAULT_ADDRESS, chainEnv.CONTROL_VAULT_ADDRESS].map((a) => a.toLowerCase()),
  );
}

// ---------------------------------------------------------------------------
// Tool 1: commit a typed intent
// ---------------------------------------------------------------------------

export const commitTypedIntentInputSchema = z
  .object({
    runId: z.string().uuid(),
    intent: mintIntentV1Schema,
  })
  .strict();

export type CommitTypedIntentInput = z.infer<typeof commitTypedIntentInputSchema>;

export interface CommitTypedIntentResult {
  readonly dbIntentId: string;
  readonly intentId: Hex;
  readonly executionId: string;
  readonly txHash: Hex | undefined;
}

/** Commit an already-planned, self-consistent `MintIntentV1` on-chain via `IntentRegistry.commitIntent`. */
export async function commitTypedIntentTool(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<CommitTypedIntentResult> {
  const parsed = commitTypedIntentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new UnsafeToolRequestError('commitTypedIntent', parsed.error.message);
  }
  const { runId, intent } = parsed.data;

  if (intent.chainId !== ctx.chainEnv.CHAIN_ID) {
    throw new UnsafeToolRequestError(
      'commitTypedIntent',
      `chainId ${intent.chainId} is not the configured chain`,
    );
  }
  if (!allowedVaults(ctx.chainEnv).has(intent.target.toLowerCase())) {
    throw new UnsafeToolRequestError(
      'commitTypedIntent',
      `target ${intent.target} is not a known vault`,
    );
  }
  if (intent.selector.toLowerCase() !== MINT_SHARES_SELECTOR.toLowerCase()) {
    throw new UnsafeToolRequestError(
      'commitTypedIntent',
      `selector ${intent.selector} is not the supervised mint action`,
    );
  }
  if (!isIntentIdValid(intent)) {
    throw new UnsafeToolRequestError(
      'commitTypedIntent',
      'intentId does not match the hash of its own fields',
    );
  }

  const paramsHash = hashMintParams(intent.receiver, intent.shares);
  const dbIntent = await createIntent(ctx.db, {
    run_id: runId,
    agent_address: intent.agent,
    chain_id: intent.chainId,
    target_address: intent.target,
    selector: intent.selector,
    params: { receiver: intent.receiver, shares: intent.shares },
    params_hash: paramsHash,
    intent_hash: intent.intentId,
    nonce: intent.nonce,
    deadline: intent.deadline,
  });

  const req: ContractCallRequest = {
    contractAddress: ctx.chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
    chainId: ctx.chainEnv.CHAIN_ID,
    functionName: 'commitIntent',
    functionArgs: [
      intent.intentId,
      intent.target,
      intent.selector,
      paramsHash,
      intent.deadline,
      intent.nonce,
    ],
    // Neither contract is verified on BaseScan yet, so KeeperHub cannot
    // resolve the ABI itself — required, not merely optional, in practice.
    abi: intentRegistryAbi.filter((f) => f.name === 'commitIntent'),
  };

  let execution;
  try {
    execution = await executeContractCallSafely(
      ctx.keeperHubEnv,
      req,
      buildIdempotencyKey(runId, 'commit'),
      { fetchImpl: ctx.fetchImpl },
    );
  } catch (err) {
    await markIntentCommitFailed(ctx.db, dbIntent.id).catch(() => undefined);
    throw err;
  }

  const committedOnChain = await readIsCommitted(
    ctx.chainClient,
    ctx.chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
    intent.intentId,
  );
  if (!committedOnChain) {
    await markIntentCommitFailed(ctx.db, dbIntent.id).catch(() => undefined);
    throw new Error(
      `KeeperHub reported commit execution "${execution.status}" but isCommitted() is false on-chain`,
    );
  }

  await markIntentCommitted(ctx.db, dbIntent.id);

  return {
    dbIntentId: dbIntent.id,
    intentId: intent.intentId,
    executionId: execution.executionId,
    txHash: execution.transactionHash,
  };
}

// ---------------------------------------------------------------------------
// Tool 2: execute an approved (already-committed) mint
// ---------------------------------------------------------------------------

export const executeApprovedMintInputSchema = z
  .object({
    runId: z.string().uuid(),
    dbIntentId: z.string().uuid(),
  })
  .strict();

export type ExecuteApprovedMintInput = z.infer<typeof executeApprovedMintInputSchema>;

/**
 * NOT part of any Zod schema, NOT reachable from tool JSON input — see the
 * module docstring. Only `demo/scenarios.ts`'s deterministic orchestrator
 * ever constructs one of these, and only for the disclosed attack fixtures.
 */
export interface ExecutionOverride {
  readonly shares: string;
  readonly disclosureReason: string;
}

export interface ExecuteApprovedMintResult {
  readonly dbExecutionId: string;
  readonly executionId: string;
  readonly txHash: Hex | undefined;
  readonly receiver: Hex;
  readonly sharesExecuted: string;
  readonly mutated: boolean;
}

function extractDeclaredMintParams(params: Record<string, unknown>): {
  receiver: Hex;
  shares: string;
} {
  const receiver = params.receiver;
  const shares = params.shares;
  if (typeof receiver !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(receiver)) {
    throw new UnsafeToolRequestError(
      'executeApprovedMint',
      'committed intent has no valid declared receiver',
    );
  }
  if (typeof shares !== 'string' || !/^(0|[1-9][0-9]*)$/.test(shares)) {
    throw new UnsafeToolRequestError(
      'executeApprovedMint',
      'committed intent has no valid declared shares',
    );
  }
  return { receiver: receiver as Hex, shares };
}

function terminalMintResult(
  execution: Execution,
  receiver: Hex,
  sharesExecuted: string,
  mutated: boolean,
): ExecuteApprovedMintResult {
  return {
    dbExecutionId: execution.id,
    executionId: execution.provider_execution_id ?? execution.id,
    txHash: (execution.tx_hash ?? undefined) as Hex | undefined,
    receiver,
    sharesExecuted,
    mutated,
  };
}

/** Execute an already-committed mint intent through KeeperHub, verified independently on-chain. */
export async function executeApprovedMintTool(
  ctx: ToolContext,
  rawInput: unknown,
  internalOverride?: ExecutionOverride,
): Promise<ExecuteApprovedMintResult> {
  const parsed = executeApprovedMintInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new UnsafeToolRequestError('executeApprovedMint', parsed.error.message);
  }
  const { runId, dbIntentId } = parsed.data;

  const intent: Intent | null = await getIntent(ctx.db, dbIntentId);
  if (!intent) {
    throw new UnsafeToolRequestError('executeApprovedMint', `intent ${dbIntentId} does not exist`);
  }
  if (intent.run_id !== runId) {
    throw new UnsafeToolRequestError(
      'executeApprovedMint',
      'intent does not belong to the claimed run',
    );
  }
  if (intent.status !== 'committed') {
    throw new UnsafeToolRequestError(
      'executeApprovedMint',
      `intent is "${intent.status}", not "committed"`,
    );
  }

  const declared = extractDeclaredMintParams(intent.params);
  const sharesToExecute = internalOverride ? internalOverride.shares : declared.shares;
  if (internalOverride) {
    // Disclosed, deterministic, orchestrator-driven only — see module docstring.
    console.warn(`[demo-fixture] ${internalOverride.disclosureReason}`);
  }

  const vaultAddress = intent.target_address as Hex;
  const sharesBefore = await readSharesOf(ctx.chainClient, vaultAddress, declared.receiver);

  const req: ContractCallRequest = {
    contractAddress: vaultAddress,
    chainId: ctx.chainEnv.CHAIN_ID,
    functionName: 'mintShares',
    functionArgs: [intent.intent_hash, declared.receiver, sharesToExecute],
    abi: demoVaultAbi.filter((f) => f.name === 'mintShares'),
  };

  const { execution: dbExecution, alreadyExisted } = await createExecution(ctx.db, {
    run_id: runId,
    intent_id: intent.id,
    kind: 'action',
    idempotency_key: buildIdempotencyKey(runId, 'mint'),
    function_name: 'mintShares',
    function_args: [intent.intent_hash, declared.receiver, sharesToExecute],
  });

  // A genuine replay (same runId, same step, called again — e.g. a caller
  // retrying after a dropped response): this execution already ran to a
  // terminal outcome, so re-broadcasting through KeeperHub would be both
  // unnecessary and, for `recordExecutionOutcome`'s one-time terminal-state
  // guard, an error. Short-circuit on the already-recorded result instead.
  if (alreadyExisted && dbExecution.status !== 'pending' && dbExecution.status !== 'running') {
    return terminalMintResult(
      dbExecution,
      declared.receiver,
      sharesToExecute,
      internalOverride !== undefined,
    );
  }

  let execution;
  try {
    execution = await executeContractCallSafely(
      ctx.keeperHubEnv,
      req,
      buildIdempotencyKey(runId, 'mint'),
      { fetchImpl: ctx.fetchImpl },
    );
  } catch (err) {
    await recordExecutionOutcome(ctx.db, dbExecution.id, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    throw err;
  }

  const sharesAfter = await readSharesOf(ctx.chainClient, vaultAddress, declared.receiver);
  const delta = sharesAfter - sharesBefore;
  if (delta !== BigInt(sharesToExecute)) {
    await recordExecutionOutcome(ctx.db, dbExecution.id, {
      status: 'failed',
      error: `on-chain share delta ${delta} did not match executed amount ${sharesToExecute}`,
    }).catch(() => undefined);
    throw new Error(
      `KeeperHub reported mint execution "${execution.status}" but the on-chain share delta does not match`,
    );
  }

  await recordExecutionOutcome(ctx.db, dbExecution.id, {
    status: 'completed',
    tx_hash: execution.transactionHash ?? null,
    gas_used_wei: execution.gasUsedWei ?? null,
  });

  return {
    dbExecutionId: dbExecution.id,
    executionId: execution.executionId,
    txHash: execution.transactionHash,
    receiver: declared.receiver,
    sharesExecuted: sharesToExecute,
    mutated: internalOverride !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Tool 3: read-only run/result state
// ---------------------------------------------------------------------------

export const queryRunStateInputSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict();

export type QueryRunStateInput = z.infer<typeof queryRunStateInputSchema>;

export interface QueryRunStateResult {
  readonly run: DemoRun | null;
  readonly intents: readonly Intent[];
  readonly incidents: readonly Incident[];
}

/** Read-only run/intent/incident summary — never exposes the underlying DB client. */
export async function queryRunStateTool(
  ctx: ToolContext,
  rawInput: unknown,
): Promise<QueryRunStateResult> {
  const parsed = queryRunStateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new UnsafeToolRequestError('queryRunState', parsed.error.message);
  }
  const { runId } = parsed.data;

  const [run, intents, incidents] = await Promise.all([
    getDemoRun(ctx.db, runId),
    listIntentsByRunId(ctx.db, runId),
    listIncidentsByRunId(ctx.db, runId),
  ]);

  return { run, intents, incidents };
}

export { UnsafeToolRequestError } from './errors';
export type { MintIntentV1 };
