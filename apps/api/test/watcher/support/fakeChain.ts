/**
 * A minimal, in-memory stand-in for the `ChainReader` surface
 * (`getBlockNumber` / `getLogs` / `readContract` / `getBlock`), driven by
 * fixtures built in `fixtures.ts`. Not a mock of viem's behavior — a fake
 * store the watcher can genuinely query, so `watcher.ts`'s own filtering
 * logic (address matching, block ranges) runs unmodified, exactly as it
 * would against a real `PublicClient`.
 *
 * `ChainReader` is typed against viem's real, complex generic
 * `PublicClient` methods; a hand-written object satisfying that exactly
 * would fight viem's overload resolution for no real benefit (the fake's
 * actual return values are what matters, not reproducing viem's generic
 * signature machinery), so this asserts its shape once at construction
 * rather than per-call.
 */
import type { Hex } from 'viem';

import type { ChainReader, RawLog } from '../../../src/lib/watcher/types';

export class FakeChainClient {
  private readonly logs: RawLog[] = [];
  private latestBlock = 0n;
  private readonly blockTimestamps = new Map<string, bigint>();
  private readonly pausedByVault = new Map<string, boolean>();
  private pendingFailures = 0;

  addLog(log: RawLog): void {
    this.logs.push(log);
  }

  addLogs(logs: readonly RawLog[]): void {
    for (const log of logs) this.addLog(log);
  }

  setLatestBlock(n: bigint): void {
    this.latestBlock = n;
  }

  setBlockTimestamp(blockNumber: bigint, timestampSeconds: bigint): void {
    this.blockTimestamps.set(blockNumber.toString(), timestampSeconds);
  }

  setPaused(vault: Hex, value: boolean): void {
    this.pausedByVault.set(vault.toLowerCase(), value);
  }

  /** The next N provider calls (getBlockNumber/getLogs/getBlock) throw, simulating an outage. */
  failNextCalls(n: number): void {
    this.pendingFailures = n;
  }

  private maybeFail(label: string): void {
    if (this.pendingFailures > 0) {
      this.pendingFailures--;
      throw new Error(`simulated provider failure: ${label}`);
    }
  }

  async getBlockNumber(): Promise<bigint> {
    this.maybeFail('getBlockNumber');
    return this.latestBlock;
  }

  async getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }> {
    this.maybeFail('getBlock');
    return { timestamp: this.blockTimestamps.get(args.blockNumber.toString()) ?? 0n };
  }

  async getLogs(args: {
    address?: Hex | readonly Hex[];
    fromBlock?: bigint;
    toBlock?: bigint;
  }): Promise<RawLog[]> {
    this.maybeFail('getLogs');
    const from = args.fromBlock ?? 0n;
    const to = args.toBlock ?? this.latestBlock;
    const addresses = args.address
      ? new Set(
          (Array.isArray(args.address) ? args.address : [args.address]).map((a) => a.toLowerCase()),
        )
      : undefined;

    return this.logs.filter((log) => {
      const bn = log.blockNumber ?? 0n;
      if (bn < from || bn > to) return false;
      if (addresses && !addresses.has((log.address as string).toLowerCase())) return false;
      return true;
    });
  }

  async readContract(args: { address: Hex; functionName: string }): Promise<unknown> {
    this.maybeFail('readContract');
    if (args.functionName === 'paused') {
      return this.pausedByVault.get(args.address.toLowerCase()) ?? false;
    }
    throw new Error(
      `FakeChainClient.readContract: unsupported functionName "${args.functionName}"`,
    );
  }

  /** Cast once, at the boundary — see the module docstring for why. */
  asChainReader(): ChainReader {
    return this as unknown as ChainReader;
  }
}
