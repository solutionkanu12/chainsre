/**
 * Narrow, typed KeeperHub client. This is the only place ChainSRE code is
 * allowed to build a KeeperHub request — every call into KeeperHub, from every
 * later phase (the watcher, the guardian service, the demo orchestrator), goes
 * through the functions here so the safe-execution lifecycle (simulate first,
 * idempotent broadcast, bounded poll) is enforced in exactly one place.
 *
 * Deliberately does NOT expose a generic "call any contract with any ABI"
 * surface to anything outside this package — every caller supplies a fully
 * formed {@link ContractCallRequest}, and nothing here accepts a raw URL or
 * lets `KEEPERHUB_BASE_URL` be swapped per-call (that would open an SSRF path
 * where a caller-controlled base URL smuggles the bearer token to a third
 * party). The base URL comes from validated env, once, per client.
 */
import { keeperHubRequest } from './http';
import { exponentialBackoffMs, pollUntil } from './polling';
import {
  KeeperHubAuthError,
  KeeperHubChainUnavailableError,
  KeeperHubExecutionFailedError,
  KeeperHubMalformedResponseError,
  KeeperHubSimulationRevertError,
} from './errors';
import type { KeeperHubEnv } from './env';
import {
  isDirectExecutionTerminal,
  isWorkflowExecutionTerminal,
  type BroadcastAccepted,
  type ChainInfo,
  type ContractCallRequest,
  type ExecutionStatus,
  type SimulationResult,
  type WorkflowExecutionAccepted,
  type WorkflowExecutionStatus,
} from './types';

export interface CallOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface PollBudget {
  readonly maxAttempts?: number;
  readonly maxTotalWaitMs?: number;
  /** Injectable so tests never actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

// --------------------------------------------------------------------------
// Readiness
// --------------------------------------------------------------------------

/**
 * `GET /api/keys` — the documented credential health check. Returns `false`
 * (never throws) specifically for an invalid/expired/absent key, so callers
 * can build a readiness screen; any other failure (network down, 5xx) still
 * throws, since that is not "the key is bad", it is "KeeperHub is unreachable".
 */
export async function checkAuth(env: KeeperHubEnv, options: CallOptions = {}): Promise<boolean> {
  try {
    const { status } = await keeperHubRequest(env, {
      method: 'GET',
      path: '/api/keys',
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    return status >= 200 && status < 300;
  } catch (err) {
    if (err instanceof KeeperHubAuthError) {
      return false;
    }
    throw err;
  }
}

// --------------------------------------------------------------------------
// Chain discovery
// --------------------------------------------------------------------------

function normalizeChain(raw: unknown): ChainInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.chainId !== 'number') return undefined;
  return {
    chainId: r.chainId,
    isEnabled: r.isEnabled === true,
    isTestnet: r.isTestnet === true,
    usePrivateMempoolRpc: r.usePrivateMempoolRpc === true,
    name: typeof r.name === 'string' ? r.name : undefined,
  };
}

/** `GET /api/chains` — a bare JSON array, normalized defensively element-by-element. */
export async function listChains(
  env: KeeperHubEnv,
  opts: { includeDisabled?: boolean } & CallOptions = {},
): Promise<ChainInfo[]> {
  const path = opts.includeDisabled ? '/api/chains?includeDisabled=true' : '/api/chains';
  const { data } = await keeperHubRequest(env, {
    method: 'GET',
    path,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
  });
  if (!Array.isArray(data)) {
    throw new KeeperHubMalformedResponseError('GET /api/chains did not return a JSON array');
  }
  return data.map(normalizeChain).filter((c): c is ChainInfo => c !== undefined);
}

/**
 * Confirm `chainId` is present AND enabled for this org before any live
 * execution. Never assumes gas sponsorship or private-mempool routing —
 * callers that care read `usePrivateMempoolRpc` off the returned info
 * themselves rather than asserting it here.
 */
export async function requireChainEnabled(
  env: KeeperHubEnv,
  chainId: number,
  opts: CallOptions = {},
): Promise<ChainInfo> {
  const chains = await listChains(env, { ...opts, includeDisabled: true });
  const chain = chains.find((c) => c.chainId === chainId);
  if (!chain) {
    throw new KeeperHubChainUnavailableError(
      `Chain ${chainId} is not present in this KeeperHub org's chain set`,
    );
  }
  if (!chain.isEnabled) {
    throw new KeeperHubChainUnavailableError(`Chain ${chainId} is present but not enabled`);
  }
  return chain;
}

// --------------------------------------------------------------------------
// Direct Execution — contract calls
// --------------------------------------------------------------------------

/**
 * Build the wire body for `/api/execute/contract-call`. `functionArgs` and
 * `abi` are JSON-ENCODED STRINGS on the wire (confirmed from the live docs
 * example: `"functionArgs": "[\"0x...\"]"`) — a field-shape detail the Phase 0
 * verification scripts got wrong (they embedded a raw array literal). Every
 * argument value that represents an on-chain integer must already be a
 * decimal string by the time it reaches this function; nothing here widens a
 * JS `number` into one, so callers are responsible for using bigint/string
 * inputs upstream (matching the shared intent-hash canonicalizer's rule).
 */
function buildContractCallBody(
  req: ContractCallRequest,
  simulate: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contractAddress: req.contractAddress,
    chainId: req.chainId,
    functionName: req.functionName,
  };
  if (req.functionArgs !== undefined) {
    body.functionArgs = JSON.stringify(req.functionArgs);
  }
  if (req.abi !== undefined) {
    body.abi = JSON.stringify(req.abi);
  }
  if (req.value !== undefined) {
    body.value = req.value;
  }
  if (simulate) {
    body.simulate = true;
  }
  return body;
}

function normalizeSimulation(data: unknown): SimulationResult {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    success: d.success === true,
    wouldRevert: d.wouldRevert === true,
    gasEstimate: typeof d.gasEstimate === 'string' ? d.gasEstimate : undefined,
    revertReason:
      typeof d.revertReason === 'string'
        ? d.revertReason
        : typeof d.error === 'string'
          ? d.error
          : undefined,
    from: typeof d.from === 'string' ? (d.from as `0x${string}`) : undefined,
    to: typeof d.to === 'string' ? (d.to as `0x${string}`) : undefined,
  };
}

/**
 * `POST /api/execute/contract-call` with `simulate:true`. Never throws for a
 * would-revert dry run (HTTP 400 + `wouldRevert:true`) — that is normal,
 * informative output, not a transport failure. Only genuinely unexpected
 * shapes raise {@link KeeperHubMalformedResponseError}.
 */
export async function simulateContractCall(
  env: KeeperHubEnv,
  req: ContractCallRequest,
  options: CallOptions = {},
): Promise<SimulationResult> {
  const { status, data } = await keeperHubRequest(env, {
    method: 'POST',
    path: '/api/execute/contract-call',
    body: buildContractCallBody(req, true),
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  if (status !== 200 && status !== 400) {
    throw new KeeperHubMalformedResponseError(
      `Unexpected HTTP ${status} from simulate contract-call`,
      { httpStatus: status },
    );
  }
  return normalizeSimulation(data);
}

/**
 * `POST /api/execute/contract-call` WITHOUT `simulate` — a real broadcast.
 * Callers should almost always go through {@link executeContractCallSafely}
 * instead, which simulates first and refuses to call this on a would-revert
 * result. This low-level function exists for tests and for callers that have
 * already simulated the exact same body themselves.
 */
export async function broadcastContractCall(
  env: KeeperHubEnv,
  req: ContractCallRequest,
  idempotencyKey: string,
  options: CallOptions = {},
): Promise<BroadcastAccepted> {
  const { status, data } = await keeperHubRequest(env, {
    method: 'POST',
    path: '/api/execute/contract-call',
    body: buildContractCallBody(req, false),
    idempotencyKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const d = (data ?? {}) as Record<string, unknown>;
  if (status >= 300 || typeof d.executionId !== 'string' || typeof d.status !== 'string') {
    throw new KeeperHubMalformedResponseError(
      `Broadcast did not return a valid { executionId, status } (HTTP ${status})`,
      { httpStatus: status },
    );
  }
  return {
    executionId: d.executionId,
    status: d.status,
    idempotentReplay: d.idempotentReplay === true,
  };
}

function normalizeExecutionStatus(data: unknown, headers: Headers): ExecutionStatus {
  const d = (data ?? {}) as Record<string, unknown>;
  const statusValue = typeof d.status === 'string' ? d.status : 'pending';
  const hintRaw = headers.get('X-Poll-Interval-Hint');
  const hint = hintRaw !== null ? Number(hintRaw) : undefined;
  const receipts = Array.isArray(d.receipts)
    ? d.receipts.map((r: Record<string, unknown>) => ({
        hash: r.hash as `0x${string}`,
        chainId: typeof r.chainId === 'number' ? r.chainId : undefined,
        verified: r.verified === true,
        receiptStatus: typeof r.receiptStatus === 'string' ? r.receiptStatus : undefined,
        blockNumber: typeof r.blockNumber === 'number' ? r.blockNumber : undefined,
        gasUsed: typeof r.gasUsed === 'string' ? r.gasUsed : undefined,
        verifiedAt: typeof r.verifiedAt === 'string' ? r.verifiedAt : undefined,
      }))
    : undefined;
  return {
    executionId: typeof d.executionId === 'string' ? d.executionId : '',
    status: statusValue as ExecutionStatus['status'],
    transactionHash:
      typeof d.transactionHash === 'string' ? (d.transactionHash as `0x${string}`) : undefined,
    transactionLink: typeof d.transactionLink === 'string' ? d.transactionLink : undefined,
    sponsored: typeof d.sponsored === 'boolean' ? d.sponsored : undefined,
    receipts,
    gasUsedWei: typeof d.gasUsedWei === 'string' ? d.gasUsedWei : undefined,
    error: d.error === null ? null : typeof d.error === 'string' ? d.error : undefined,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : undefined,
    completedAt: typeof d.completedAt === 'string' ? d.completedAt : undefined,
    pollIntervalHintSeconds: Number.isFinite(hint) ? hint : undefined,
  };
}

/** `GET /api/execute/{executionId}/status`. */
export async function getExecutionStatus(
  env: KeeperHubEnv,
  executionId: string,
  options: CallOptions = {},
): Promise<ExecutionStatus> {
  const { data, headers } = await keeperHubRequest(env, {
    method: 'GET',
    path: `/api/execute/${encodeURIComponent(executionId)}/status`,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  return normalizeExecutionStatus(data, headers);
}

/**
 * Poll `getExecutionStatus` to a terminal state, honoring the server's
 * `X-Poll-Interval-Hint` when present and falling back to exponential backoff
 * otherwise. Bounded by `maxAttempts` / `maxTotalWaitMs` — never infinite.
 */
export async function pollExecutionUntilTerminal(
  env: KeeperHubEnv,
  executionId: string,
  options: CallOptions & PollBudget = {},
): Promise<ExecutionStatus> {
  return pollUntil<ExecutionStatus>({
    label: `execution ${executionId}`,
    maxAttempts: options.maxAttempts,
    maxTotalWaitMs: options.maxTotalWaitMs,
    sleep: options.sleep,
    fetchStatus: () => getExecutionStatus(env, executionId, options),
    isTerminal: (s) => isDirectExecutionTerminal(s.status),
    nextDelayMs: (result, attempt) => {
      if (result?.pollIntervalHintSeconds !== undefined) {
        // A hint of 0 means "terminal", but isTerminal already returned false
        // here, so treat 0 as "poll again soon" rather than stalling forever.
        return result.pollIntervalHintSeconds > 0 ? result.pollIntervalHintSeconds * 1000 : 1000;
      }
      return exponentialBackoffMs(attempt);
    },
  });
}

/**
 * The full safe-execution lifecycle for one contract call: simulate, require
 * success and no revert, broadcast with a stable idempotency key, poll to a
 * terminal state, and require the terminal state to be `completed`. This is
 * the function every later phase should call — `broadcastContractCall` alone
 * skips the revert guard.
 */
export async function executeContractCallSafely(
  env: KeeperHubEnv,
  req: ContractCallRequest,
  idempotencyKey: string,
  options: CallOptions & PollBudget = {},
): Promise<ExecutionStatus> {
  const simulation = await simulateContractCall(env, req, options);
  if (!simulation.success || simulation.wouldRevert) {
    throw new KeeperHubSimulationRevertError(
      `Simulation blocked the broadcast for ${req.functionName} on ${req.contractAddress}` +
        (simulation.revertReason ? `: ${simulation.revertReason}` : ''),
      simulation.revertReason,
    );
  }

  const accepted = await broadcastContractCall(env, req, idempotencyKey, options);
  const final = await pollExecutionUntilTerminal(env, accepted.executionId, options);

  if (final.status !== 'completed') {
    throw new KeeperHubExecutionFailedError(
      `Execution ${accepted.executionId} for ${req.functionName} ended in status "${final.status}"` +
        (final.error ? `: ${final.error}` : ''),
      accepted.executionId,
    );
  }
  return final;
}

// --------------------------------------------------------------------------
// Workflows
// --------------------------------------------------------------------------

/**
 * `POST /api/workflows/{workflowId}/execute`. The endpoint's idempotency
 * behavior is undocumented, but the Phase 0 scripts already send an
 * `Idempotency-Key` header here on the (reasonable) assumption that KeeperHub
 * applies the same header uniformly; if the server ignores it for this route
 * the header is simply inert, so sending it is never harmful.
 */
export async function executeWorkflow(
  env: KeeperHubEnv,
  workflowId: string,
  idempotencyKey: string,
  input: Record<string, unknown> = {},
  options: CallOptions = {},
): Promise<WorkflowExecutionAccepted> {
  const { status, data } = await keeperHubRequest(env, {
    method: 'POST',
    path: `/api/workflows/${encodeURIComponent(workflowId)}/execute`,
    body: { input },
    idempotencyKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  const d = (data ?? {}) as Record<string, unknown>;
  if (status >= 300 || typeof d.executionId !== 'string' || typeof d.status !== 'string') {
    throw new KeeperHubMalformedResponseError(
      `Workflow trigger did not return a valid { executionId, status } (HTTP ${status})`,
      { httpStatus: status },
    );
  }
  return { executionId: d.executionId, status: d.status };
}

const WORKFLOW_STATUS_MAP: Record<string, WorkflowExecutionStatus['status']> = {
  success: 'completed',
  completed: 'completed',
  error: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
  pending: 'pending',
  running: 'running',
};

function normalizeWorkflowStatus(executionId: string, data: unknown): WorkflowExecutionStatus {
  const d = (data ?? {}) as Record<string, unknown>;
  const rawStatus = typeof d.status === 'string' ? d.status : 'pending';
  const txHashes = Array.isArray(d.transactionHashes)
    ? d.transactionHashes.map((t: Record<string, unknown>) => ({
        hash: t.hash as `0x${string}`,
        nodeId: typeof t.nodeId === 'string' ? t.nodeId : '',
        nodeName: typeof t.nodeName === 'string' ? t.nodeName : undefined,
        chainId: typeof t.chainId === 'number' ? t.chainId : undefined,
        verified: t.verified === true,
        receiptStatus: typeof t.receiptStatus === 'string' ? t.receiptStatus : undefined,
        blockNumber: typeof t.blockNumber === 'number' ? t.blockNumber : undefined,
        gasUsed: typeof t.gasUsed === 'string' ? t.gasUsed : undefined,
        verifiedAt: typeof t.verifiedAt === 'string' ? t.verifiedAt : undefined,
      }))
    : [];
  return {
    executionId: typeof d.executionId === 'string' ? d.executionId : executionId,
    status: WORKFLOW_STATUS_MAP[rawStatus] ?? 'pending',
    transactionHashes: txHashes,
    error: d.error === null ? null : typeof d.error === 'string' ? d.error : undefined,
    completedAt: typeof d.completedAt === 'string' ? d.completedAt : null,
    gasUsedWei: typeof d.gasUsedWei === 'string' ? d.gasUsedWei : null,
  };
}

/** `GET /api/workflows/executions/{executionId}/status`. */
export async function getWorkflowExecutionStatus(
  env: KeeperHubEnv,
  executionId: string,
  options: CallOptions = {},
): Promise<WorkflowExecutionStatus> {
  const { data } = await keeperHubRequest(env, {
    method: 'GET',
    path: `/api/workflows/executions/${encodeURIComponent(executionId)}/status`,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  return normalizeWorkflowStatus(executionId, data);
}

/**
 * Poll workflow execution status to a terminal state. Workflows carry no
 * poll-interval hint header, so this always backs off exponentially. Bounded
 * exactly like {@link pollExecutionUntilTerminal}.
 */
export async function pollWorkflowExecutionUntilTerminal(
  env: KeeperHubEnv,
  executionId: string,
  options: CallOptions & PollBudget = {},
): Promise<WorkflowExecutionStatus> {
  return pollUntil<WorkflowExecutionStatus>({
    label: `workflow execution ${executionId}`,
    maxAttempts: options.maxAttempts,
    maxTotalWaitMs: options.maxTotalWaitMs,
    sleep: options.sleep,
    fetchStatus: () => getWorkflowExecutionStatus(env, executionId, options),
    isTerminal: (s) => isWorkflowExecutionTerminal(s.status),
    nextDelayMs: (_result, attempt) => exponentialBackoffMs(attempt),
  });
}

/**
 * Trigger the guardian (or any) workflow and poll it to a terminal,
 * `completed` state. Throws {@link KeeperHubExecutionFailedError} if it ends
 * in `failed`/`cancelled` — an HTTP 2xx from the trigger call alone is never
 * treated as success; only a verified terminal status is.
 */
export async function executeWorkflowSafely(
  env: KeeperHubEnv,
  workflowId: string,
  idempotencyKey: string,
  input: Record<string, unknown> = {},
  options: CallOptions & PollBudget = {},
): Promise<WorkflowExecutionStatus> {
  const accepted = await executeWorkflow(env, workflowId, idempotencyKey, input, options);
  const final = await pollWorkflowExecutionUntilTerminal(env, accepted.executionId, options);
  if (final.status !== 'completed') {
    throw new KeeperHubExecutionFailedError(
      `Workflow execution ${accepted.executionId} ended in status "${final.status}"` +
        (final.error ? `: ${final.error}` : ''),
      accepted.executionId,
    );
  }
  return final;
}
