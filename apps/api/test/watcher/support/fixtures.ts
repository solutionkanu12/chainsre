/**
 * Byte-accurate `Log` fixtures for the five events the watcher decodes.
 *
 * These are NOT hand-typed objects with plausible-looking fields — every
 * fixture's `topics`/`data` are computed with viem's own ABI encoders
 * (`encodeEventTopics` for the indexed fields, `encodeAbiParameters` for the
 * rest), against the SAME ABI fragments `apps/api/src/lib/chain/abi.ts`
 * exports. That is the exact byte layout a real `DemoVault`/`IntentRegistry`
 * would emit, so `decodeLog` is exercised against authentic encoded data —
 * the only thing NOT real here is that no EVM actually produced it.
 */
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Hex } from 'viem';

import { demoVaultAbi, intentRegistryAbi } from '../../../src/lib/chain/abi';
import type { RawLog } from '../../../src/lib/watcher/types';

let logCounter = 0;

interface LogMeta {
  readonly address: Hex;
  readonly blockNumber: bigint;
  readonly transactionHash?: Hex;
  readonly logIndex?: number;
}

function nextTxHash(): Hex {
  logCounter += 1;
  return keccak256(toHex(`fixture-tx-${logCounter}`));
}

function withMeta(topics: readonly (Hex | Hex[] | null)[], data: Hex, meta: LogMeta): RawLog {
  return {
    address: meta.address,
    // `encodeEventTopics` types each slot as `Hex | Hex[] | null` to cover
    // wildcard/anonymous-event cases; every fixture below supplies concrete
    // indexed args, so every slot is always a single Hex in practice.
    topics: topics as [Hex, ...Hex[]],
    data,
    blockNumber: meta.blockNumber,
    blockHash: keccak256(toHex(`fixture-block-${meta.blockNumber}`)),
    transactionHash: meta.transactionHash ?? nextTxHash(),
    transactionIndex: 0,
    logIndex: meta.logIndex ?? 0,
    removed: false,
  } as RawLog;
}

export interface IntentCommittedArgs {
  intentId: Hex;
  agent: Hex;
  target: Hex;
  selector: Hex;
  paramsHash: Hex;
  deadline: bigint;
  nonce: bigint;
}

export function intentCommittedLog(args: IntentCommittedArgs, meta: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: intentRegistryAbi,
    eventName: 'IntentCommitted',
    args: { intentId: args.intentId, agent: args.agent, target: args.target },
  });
  const data = encodeAbiParameters(
    [
      { name: 'selector', type: 'bytes4' },
      { name: 'paramsHash', type: 'bytes32' },
      { name: 'deadline', type: 'uint64' },
      { name: 'nonce', type: 'uint64' },
    ],
    [args.selector, args.paramsHash, args.deadline, args.nonce],
  );
  return withMeta(topics, data, meta);
}

export interface SharesMintedArgs {
  intentId: Hex;
  operator: Hex;
  receiver: Hex;
  shares: bigint;
}

export function sharesMintedLog(args: SharesMintedArgs, meta: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: demoVaultAbi,
    eventName: 'SharesMinted',
    args: { intentId: args.intentId, operator: args.operator, receiver: args.receiver },
  });
  const data = encodeAbiParameters([{ name: 'shares', type: 'uint256' }], [args.shares]);
  return withMeta(topics, data, meta);
}

export interface SharesRedeemedArgs {
  operator: Hex;
  receiver: Hex;
  shares: bigint;
  assets: bigint;
}

export function sharesRedeemedLog(args: SharesRedeemedArgs, meta: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: demoVaultAbi,
    eventName: 'SharesRedeemed',
    args: { operator: args.operator, receiver: args.receiver },
  });
  const data = encodeAbiParameters(
    [
      { name: 'shares', type: 'uint256' },
      { name: 'assets', type: 'uint256' },
    ],
    [args.shares, args.assets],
  );
  return withMeta(topics, data, meta);
}

export function pausedLog(account: Hex, meta: LogMeta): RawLog {
  const topics = encodeEventTopics({ abi: demoVaultAbi, eventName: 'Paused' });
  const data = encodeAbiParameters([{ name: 'account', type: 'address' }], [account]);
  return withMeta(topics, data, meta);
}

export function unpausedLog(account: Hex, meta: LogMeta): RawLog {
  const topics = encodeEventTopics({ abi: demoVaultAbi, eventName: 'Unpaused' });
  const data = encodeAbiParameters([{ name: 'account', type: 'address' }], [account]);
  return withMeta(topics, data, meta);
}

/** A log with a topic0 that matches nothing in either ABI — genuinely unsupported. */
export function unsupportedLog(meta: LogMeta): RawLog {
  const topics = [keccak256(toHex('SomeOtherEvent(address,uint256)'))] as const;
  const data = encodeAbiParameters([{ name: 'x', type: 'uint256' }], [123n]);
  return withMeta(topics, data, meta);
}

/** A log whose topic0 IS a known event, but whose data is truncated/malformed. */
export function malformedSharesMintedLog(meta: LogMeta): RawLog {
  const topics = encodeEventTopics({
    abi: demoVaultAbi,
    eventName: 'SharesMinted',
    args: {
      intentId: `0x${'1'.repeat(64)}`,
      operator: '0x0000000000000000000000000000000000000001',
      receiver: '0x0000000000000000000000000000000000000002',
    },
  });
  return withMeta(topics, '0x' as Hex, meta);
}
