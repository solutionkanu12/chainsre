/**
 * Normalized KeeperHub types, shaped from `docs.keeperhub.com` (Direct Execution,
 * Executions, Workflows) plus the field-name corrections recorded in
 * `PHASE-0-RESULTS.md` §1 (`contractAddress`/`functionArgs`, not `target`/`args`;
 * `simulate` is a body boolean; idempotency is the `Idempotency-Key` header).
 *
 * Every on-chain integer (gas, wei) stays a string end to end — never coerced to
 * a JS `number` — matching the shared `MintIntentV1` convention.
 */
import type { Hex } from 'viem';

/** A minimal ABI function fragment — just enough to describe one callable function. */
export interface AbiFunctionFragment {
  readonly name: string;
  readonly type: 'function';
  readonly stateMutability: 'nonpayable' | 'payable' | 'view' | 'pure';
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly outputs: readonly { readonly name: string; readonly type: string }[];
}

/** One chain entry from `GET /api/chains`. */
export interface ChainInfo {
  readonly chainId: number;
  readonly isEnabled: boolean;
  readonly isTestnet: boolean;
  readonly usePrivateMempoolRpc: boolean;
  readonly name?: string;
}

/** The one action ChainSRE ever asks KeeperHub to broadcast: a single contract call. */
export interface ContractCallRequest {
  readonly contractAddress: Hex;
  readonly chainId: number;
  readonly functionName: string;
  /** Positional constructor/function arguments, in ABI order. */
  readonly functionArgs?: readonly unknown[];
  /** Required for unverified contracts (KeeperHub cannot resolve the ABI itself). */
  readonly abi?: readonly AbiFunctionFragment[];
  /** Native value to send, as a decimal ether-unit string (e.g. "0"). */
  readonly value?: string;
}

/** `POST /api/execute/contract-call` with `simulate:true` — normalized. */
export interface SimulationResult {
  readonly success: boolean;
  readonly wouldRevert: boolean;
  readonly gasEstimate?: string;
  readonly revertReason?: string;
  readonly from?: Hex;
  readonly to?: Hex;
}

/** The immediate (non-terminal) response to a broadcast request. */
export interface BroadcastAccepted {
  readonly executionId: string;
  readonly status: string;
  /** Present only when a retried Idempotency-Key returned the original response verbatim. */
  readonly idempotentReplay?: boolean;
}

export type DirectExecutionStatusValue =
  'pending' | 'running' | 'unconfirmed' | 'completed' | 'failed';

export function isDirectExecutionTerminal(status: DirectExecutionStatusValue): boolean {
  return status === 'completed' || status === 'failed';
}

export interface ExecutionReceipt {
  readonly hash: Hex;
  readonly chainId?: number;
  readonly verified?: boolean;
  readonly receiptStatus?: string;
  readonly blockNumber?: number;
  readonly gasUsed?: string;
  readonly verifiedAt?: string;
}

/** `GET /api/execute/{executionId}/status` — normalized. */
export interface ExecutionStatus {
  readonly executionId: string;
  readonly status: DirectExecutionStatusValue;
  readonly transactionHash?: Hex;
  readonly transactionLink?: string;
  readonly sponsored?: boolean;
  readonly receipts?: readonly ExecutionReceipt[];
  readonly gasUsedWei?: string;
  readonly error?: string | null;
  readonly createdAt?: string;
  readonly completedAt?: string;
  /** From the `X-Poll-Interval-Hint` response header. `0` means terminal. */
  readonly pollIntervalHintSeconds?: number;
}

/** `POST /api/workflows/{workflowId}/execute` — normalized. */
export interface WorkflowExecutionAccepted {
  readonly executionId: string;
  readonly status: string;
}

export type WorkflowExecutionStatusValue =
  'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export function isWorkflowExecutionTerminal(status: WorkflowExecutionStatusValue): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export interface WorkflowTransactionHash {
  readonly hash: Hex;
  readonly nodeId: string;
  readonly nodeName?: string;
  readonly chainId?: number;
  readonly verified?: boolean;
  readonly receiptStatus?: string;
  readonly blockNumber?: number;
  readonly gasUsed?: string;
  readonly verifiedAt?: string;
}

/** `GET /api/workflows/executions/{executionId}/status` (and the `/wait` long-poll) — normalized. */
export interface WorkflowExecutionStatus {
  readonly executionId: string;
  readonly status: WorkflowExecutionStatusValue;
  readonly transactionHashes: readonly WorkflowTransactionHash[];
  readonly error?: string | null;
  readonly completedAt?: string | null;
  readonly gasUsedWei?: string | null;
}
