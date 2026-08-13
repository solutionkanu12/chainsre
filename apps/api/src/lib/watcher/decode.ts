/**
 * Decode a confirmed log into one of the five events ChainSRE understands, or
 * report it as {@link UnsupportedLog} — never throw. A log from an unrelated
 * contract, an unrecognized event, or a malformed/partial log (all real
 * possibilities once `getLogs` is filtered only by topic0, not by address —
 * see `watcher.ts`) must not crash a tick; it must be safely ignored.
 */
import { decodeEventLog, type Hex } from 'viem';

import { demoVaultAbi, intentRegistryAbi } from '../chain/abi';
import type { DecodeResult, RawLog } from './types';

const watcherEventsAbi = [...intentRegistryAbi, ...demoVaultAbi] as const;

function base(log: RawLog) {
  return {
    address: log.address as Hex,
    blockNumber: log.blockNumber ?? 0n,
    transactionHash: (log.transactionHash ?? '0x') as Hex,
    logIndex: log.logIndex ?? 0,
  };
}

/**
 * Isolated so its return type is inferred from the real call (tied to
 * `watcherEventsAbi`'s literal shape) rather than widened by an explicit
 * `ReturnType<typeof decodeEventLog>` annotation, which — on an overloaded
 * generic function — resolves to a loose fallback that loses the
 * per-event-name `args` discrimination `decodeLog`'s switch depends on.
 */
function tryDecode(log: RawLog) {
  try {
    return decodeEventLog({
      abi: watcherEventsAbi,
      data: log.data,
      topics: log.topics,
      strict: true,
    });
  } catch {
    return undefined;
  }
}

export function decodeLog(log: RawLog): DecodeResult {
  const decoded = tryDecode(log);
  const b = base(log);

  if (!decoded) {
    return {
      kind: 'Unsupported',
      address: b.address,
      transactionHash: (log.transactionHash ?? null) as Hex | null,
      logIndex: log.logIndex ?? null,
      reason: 'log topics/data do not match any known event',
    };
  }

  switch (decoded.eventName) {
    case 'IntentCommitted': {
      const a = decoded.args;
      return {
        kind: 'IntentCommitted',
        ...b,
        intentId: a.intentId,
        agent: a.agent,
        target: a.target,
        selector: a.selector,
        paramsHash: a.paramsHash,
        deadline: a.deadline,
        nonce: a.nonce,
      };
    }
    case 'SharesMinted': {
      const a = decoded.args;
      return {
        kind: 'SharesMinted',
        ...b,
        intentId: a.intentId,
        operator: a.operator,
        receiver: a.receiver,
        shares: a.shares,
      };
    }
    case 'SharesRedeemed': {
      const a = decoded.args;
      return {
        kind: 'SharesRedeemed',
        ...b,
        operator: a.operator,
        receiver: a.receiver,
        shares: a.shares,
        assets: a.assets,
      };
    }
    case 'Paused': {
      const a = decoded.args;
      return { kind: 'Paused', ...b, account: a.account };
    }
    case 'Unpaused': {
      const a = decoded.args;
      return { kind: 'Unpaused', ...b, account: a.account };
    }
    default:
      // Unreachable given watcherEventsAbi's fixed event set — the switch
      // above is exhaustive over it, which is exactly why TS narrows this
      // branch to `never`. Kept (rather than removed) so a future ABI
      // addition that isn't also added to the switch fails to compile here
      // instead of silently mis-typing as a known event.
      return { kind: 'Unsupported', ...b, reason: 'decoded an event this watcher does not handle' };
  }
}
