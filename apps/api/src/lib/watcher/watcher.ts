/**
 * The watcher tick: resume from the persisted cursor, fetch confirmed logs
 * for a bounded block range, decode and correlate them, and act only on a
 * confirmed mint that diverges from what was declared.
 *
 * On WHY the watcher cannot recover "what was declared" from the on-chain
 * `IntentCommitted` event alone: that event carries `paramsHash =
 * keccak256(abi.encode(receiver, shares))` — a commitment, not the
 * plaintext. Recovering `receiver`/`shares` from a hash is impossible by
 * design (`IntentHashLib.sol`). The plaintext lives in `intents.params`,
 * written by whoever declared the intent (the agent orchestrator, Phase 6)
 * before committing on-chain. This watcher's job is to compare that
 * DECLARED baseline against the CONFIRMED `SharesMinted` event — not to
 * invert a hash.
 *
 * Only `SharesMinted` on an ENROLLED vault ever creates an incident.
 * `IntentCommitted`/`SharesRedeemed`/`Paused`/`Unpaused` are decoded (so a
 * future phase can persist them as evidence) but drive no comparison logic —
 * mint is the one action ChainSRE supervises (`02-Hackathon-PRD.md` §6). A
 * mint on a contract with no active enrollment (the control vault, by
 * design — `PHASE-2-RESULTS.md`) is ignored exactly like an unsupported
 * log: "ChainSRE sees no enrollment and takes no action."
 */
import {
  createIncidentIfAbsent,
  getActiveEnrollment,
  getChainCursor,
  getIntentByHash,
  upsertChainCursor,
  type DbClient,
} from '@chainsre/db';
import type { Hex } from 'viem';

import { demoVaultAbi, intentRegistryAbi } from '../chain/abi';
import { exponentialBackoffMs } from '../keeperhub';
import type { KeeperHubEnv } from '../keeperhub';
import { compareMint, type DeclaredMintParams } from './comparator';
import { decodeLog } from './decode';
import { containIncident } from './guardian';
import type { ChainReader, RawLog } from './types';

/** The one event name this watcher's cursor tracks — a single unified cursor
 * across every event/address it scans, not one per event type. */
const CURSOR_EVENT_NAME = 'watcher';

const intentRegistryEvents = intentRegistryAbi.filter((f) => f.type === 'event');
const demoVaultEvents = demoVaultAbi.filter((f) => f.type === 'event');

export interface WatcherConfig {
  readonly chainId: number;
  readonly registryAddress: Hex;
  /** Every vault the watcher reads logs from — enrolled or not (see module docstring). */
  readonly vaultAddresses: readonly Hex[];
  readonly guardianWorkflowId: string;
  /** Blocks behind head required before a log counts as confirmed. */
  readonly confirmations?: number;
  /** Max blocks fetched per `eth_getLogs` call. */
  readonly maxBlockRange?: number;
  /** Bounded retry budget for a single provider call. */
  readonly providerRetryAttempts?: number;
  /** Where to start if no cursor exists yet. */
  readonly startBlock?: bigint;
}

export interface WatcherDeps {
  readonly db: DbClient;
  readonly chainClient: ChainReader;
  readonly keeperHubEnv: KeeperHubEnv;
  /** Injectable for tests; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * When `false`, incidents are still detected and persisted normally, but
   * the real guardian trigger (`containIncident`) is skipped — matches the
   * project's `CONFIRM_BROADCAST` dry-run convention (`phase0/*.sh`,
   * `phase3-live-proof.ts`): detection is safe, reversible DB state;
   * triggering a real KeeperHub workflow is not. Defaults to `true`.
   */
  readonly containmentEnabled?: boolean;
  /** Overrides the `fetch` KeeperHub calls use — production omits this; tests inject a mock. */
  readonly fetchImpl?: typeof fetch;
}

export interface TickResult {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly hadWork: boolean;
  readonly logsScanned: number;
  readonly unsupportedSkipped: number;
  readonly unenrolledSkipped: number;
  readonly uncorrelatedSkipped: number;
  readonly matchedMints: number;
  readonly incidentsCreated: number;
  readonly incidentsAlreadyExisted: number;
  readonly containmentsAttempted: number;
  readonly containmentsSucceeded: number;
  readonly containmentsFailed: number;
}

type MutableCounters = {
  -readonly [K in keyof Omit<TickResult, 'fromBlock' | 'toBlock' | 'hadWork'>]: TickResult[K];
};

function emptyCounters(): MutableCounters {
  return {
    logsScanned: 0,
    unsupportedSkipped: 0,
    unenrolledSkipped: 0,
    uncorrelatedSkipped: 0,
    matchedMints: 0,
    incidentsCreated: 0,
    incidentsAlreadyExisted: 0,
    containmentsAttempted: 0,
    containmentsSucceeded: 0,
    containmentsFailed: 0,
  };
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  label: string,
  attempts: number,
  sleep: (ms: number) => Promise<void>,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(exponentialBackoffMs(i));
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} failed after ${attempts} attempt(s): ${detail}`);
}

function sortLogs(logs: readonly RawLog[]): RawLog[] {
  return [...logs].sort((a, b) => {
    const ab = a.blockNumber ?? 0n;
    const bb = b.blockNumber ?? 0n;
    if (ab !== bb) return ab < bb ? -1 : 1;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });
}

/** Extract a well-formed `{ receiver, shares }` from a stored intent's plaintext params. */
function extractDeclaredParams(params: Record<string, unknown>): DeclaredMintParams | undefined {
  const receiver = params.receiver;
  const shares = params.shares;
  if (typeof receiver !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(receiver)) return undefined;
  if (typeof shares !== 'string' || !/^(0|[1-9][0-9]*)$/.test(shares)) return undefined;
  return { receiver: receiver as Hex, shares };
}

/**
 * Run one bounded tick: fetch whatever confirmed blocks are newly available
 * (up to `maxBlockRange`), process them, and persist the cursor — but ONLY
 * after successfully processing everything in range, so a crash mid-tick
 * re-scans rather than silently skipping blocks (backfill-safe by
 * construction, not by a separate "backfill mode").
 */
export async function runWatcherTick(
  config: WatcherConfig,
  deps: WatcherDeps,
  runId: string,
): Promise<TickResult> {
  const confirmations = BigInt(config.confirmations ?? 1);
  const maxBlockRange = BigInt(config.maxBlockRange ?? 2000);
  const providerRetryAttempts = config.providerRetryAttempts ?? 5;
  const sleep = deps.sleep ?? defaultSleep;

  const cursor = await getChainCursor(
    deps.db,
    config.chainId,
    config.registryAddress,
    CURSOR_EVENT_NAME,
  );
  const fromBlock = cursor ? BigInt(cursor.last_processed_block) + 1n : (config.startBlock ?? 0n);

  const latest = await withRetry('getBlockNumber', providerRetryAttempts, sleep, () =>
    deps.chainClient.getBlockNumber(),
  );
  const confirmedHead = latest > confirmations ? latest - confirmations : 0n;

  if (confirmedHead < fromBlock) {
    // Nothing newly confirmed since the last tick. Cursor untouched.
    return { fromBlock, toBlock: fromBlock, hadWork: false, ...emptyCounters() };
  }

  const remaining = confirmedHead - fromBlock + 1n;
  const toBlock = remaining > maxBlockRange ? fromBlock + maxBlockRange - 1n : confirmedHead;

  const vaultAddresses = [...config.vaultAddresses];
  const [registryLogs, vaultLogs] = await Promise.all([
    withRetry('getLogs(IntentRegistry)', providerRetryAttempts, sleep, () =>
      deps.chainClient.getLogs({
        address: config.registryAddress,
        events: intentRegistryEvents,
        fromBlock,
        toBlock,
      }),
    ),
    vaultAddresses.length === 0
      ? Promise.resolve([] as RawLog[])
      : withRetry('getLogs(DemoVault)', providerRetryAttempts, sleep, () =>
          deps.chainClient.getLogs({
            address: vaultAddresses,
            events: demoVaultEvents,
            fromBlock,
            toBlock,
          }),
        ),
  ]);

  const logs = sortLogs([...registryLogs, ...vaultLogs]);
  const counters = emptyCounters();

  for (const log of logs) {
    counters.logsScanned++;
    const decoded = decodeLog(log);

    if (decoded.kind === 'Unsupported') {
      counters.unsupportedSkipped++;
      continue;
    }
    if (decoded.kind !== 'SharesMinted') {
      // IntentCommitted / SharesRedeemed / Paused / Unpaused: decoded, but
      // Phase 5 drives no further action from them.
      continue;
    }

    const enrollment = await getActiveEnrollment(deps.db, config.chainId, decoded.address);
    if (!enrollment) {
      counters.unenrolledSkipped++;
      continue;
    }

    const intent = await getIntentByHash(deps.db, decoded.intentId);
    const declared = intent ? extractDeclaredParams(intent.params) : undefined;
    if (!intent || !declared) {
      // No prior commitment record to compare against — cannot prove
      // divergence without a baseline, so this is treated the same as an
      // unsupported action: safely ignored, not guessed at.
      counters.uncorrelatedSkipped++;
      continue;
    }

    const comparison = compareMint(declared, decoded);
    if (comparison.matched) {
      counters.matchedMints++;
      continue;
    }

    const block = await withRetry('getBlock', providerRetryAttempts, sleep, () =>
      deps.chainClient.getBlock({ blockNumber: decoded.blockNumber }),
    );
    const detectedAt = new Date();
    const detectionLatencyMs = Math.max(0, detectedAt.getTime() - Number(block.timestamp) * 1000);

    const { incident, alreadyExisted } = await createIncidentIfAbsent(deps.db, {
      run_id: intent.run_id,
      intent_id: intent.id,
      severity: 'critical',
      expected: comparison.expected,
      actual: comparison.actual,
      mismatch_fields: [...comparison.mismatchFields],
      action_tx_hash: decoded.transactionHash,
      // Only meaningful for the insert that actually wins; harmless to
      // compute even when a concurrent caller's row is the one returned.
      detection_latency_ms: detectionLatencyMs,
    });
    if (alreadyExisted) {
      counters.incidentsAlreadyExisted++;
    } else {
      counters.incidentsCreated++;
    }

    if (deps.containmentEnabled === false) {
      continue;
    }

    counters.containmentsAttempted++;
    const containment = await containIncident(
      {
        db: deps.db,
        keeperHubEnv: deps.keeperHubEnv,
        chainClient: deps.chainClient,
        fetchImpl: deps.fetchImpl,
      },
      incident,
      decoded.address,
      config.guardianWorkflowId,
      runId,
    );
    if (containment.attempted) {
      if (containment.contained) counters.containmentsSucceeded++;
      else counters.containmentsFailed++;
    }
  }

  // Cursor advances only after the whole range processed successfully —
  // a thrown error above leaves it untouched, so the next tick re-scans
  // this exact range rather than silently skipping it.
  await upsertChainCursor(deps.db, {
    chain_id: config.chainId,
    contract_address: config.registryAddress,
    event_name: CURSOR_EVENT_NAME,
    last_processed_block: toBlock.toString(),
  });

  return { fromBlock, toBlock, hadWork: true, ...counters };
}
