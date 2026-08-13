/**
 * Unit tests for the narrow agent tool surface, focused on rejection: every
 * one of these calls must fail BEFORE ever reaching the DB/chain/KeeperHub
 * — proven by wiring those dependencies to stand-ins that throw if actually
 * invoked. Full happy-path coverage (real commit/mint against real
 * infrastructure) lives in `test/demo/scenarios.behavior.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { buildMintIntent, MINT_SHARES_SELECTOR } from '@chainsre/shared/intent-hash';
import type { Hex } from 'viem';

import {
  commitTypedIntentTool,
  executeApprovedMintInputSchema,
  executeApprovedMintTool,
  queryRunStateInputSchema,
  type ToolContext,
} from '../../src/lib/agent/tools';
import { UnsafeToolRequestError } from '../../src/lib/agent/errors';
import type { ChainEnv } from '../../src/lib/chain';
import type { ChainReader } from '../../src/lib/watcher/types';
import type { KeeperHubEnv } from '../../src/lib/keeperhub';

const AGENT = '0x6c0a292c3e7cf192efb4d6c7328fcaff12208bcb' as Hex;
const VAULT = '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b' as Hex;
const CONTROL_VAULT = '0xf0dd43fbbea515f2fa8e2c0c0a2c60f5efc6f3b5' as Hex;
const NOT_A_VAULT = '0x9999999999999999999999999999999999999999'.slice(0, 42) as Hex;
const RUN_ID = '11111111-1111-1111-1111-111111111111';

const chainEnv: ChainEnv = {
  BASE_SEPOLIA_RPC_HTTP: 'http://127.0.0.1:1/unused',
  CHAIN_ID: 84_532,
  INTENT_REGISTRY_ADDRESS: '0x6a78fcf6cb1bf7b45b98e262ee65965263bb23f9' as Hex,
  MOCK_ASSET_ADDRESS: '0x961fa7f8cdcba67717ce92c249443f74f3d448c5' as Hex,
  PROTECTED_VAULT_ADDRESS: VAULT,
  CONTROL_VAULT_ADDRESS: CONTROL_VAULT,
};

const keeperHubEnv: KeeperHubEnv = {
  KEEPERHUB_API_KEY: 'kh_test_00000000000000000000',
  KEEPERHUB_BASE_URL: 'https://kh.test',
  KEEPERHUB_GUARDIAN_WORKFLOW_ID: 'guardian-test-workflow',
};

/** A ToolContext whose db/chain/KeeperHub surfaces throw if actually reached — proves early rejection. */
function unreachableCtx(): ToolContext {
  return {
    db: {
      from: () => {
        throw new Error('db should never be reached for a rejected request');
      },
    } as never,
    chainClient: {
      getBlockNumber: () => {
        throw new Error('chain should never be reached for a rejected request');
      },
      readContract: () => {
        throw new Error('chain should never be reached for a rejected request');
      },
    } as unknown as ChainReader,
    chainEnv,
    keeperHubEnv,
  };
}

function validIntent(target: Hex) {
  return buildMintIntent({
    chainId: chainEnv.CHAIN_ID,
    agent: AGENT,
    target,
    selector: MINT_SHARES_SELECTOR,
    receiver: AGENT,
    shares: '950000000000000000000',
    deadline: 2_000_000_000,
    nonce: 1n,
  });
}

describe('commitTypedIntentTool — unsafe requests rejected before touching any dependency', () => {
  it('rejects an intent targeting a contract that is not a known vault', async () => {
    const intent = validIntent(NOT_A_VAULT);
    await expect(
      commitTypedIntentTool(unreachableCtx(), { runId: RUN_ID, intent }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });

  it('rejects an intent for the wrong chainId', async () => {
    const intent = { ...validIntent(VAULT), chainId: 1 };
    await expect(
      commitTypedIntentTool(unreachableCtx(), { runId: RUN_ID, intent }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });

  it('rejects an intent whose selector is not the supervised mint action', async () => {
    const intent = { ...validIntent(VAULT), selector: '0xdeadbeef' as Hex };
    await expect(
      commitTypedIntentTool(unreachableCtx(), { runId: RUN_ID, intent }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });

  it('rejects an intent whose intentId does not match the hash of its own fields (tampered)', async () => {
    const intent = { ...validIntent(VAULT), intentId: `0x${'ee'.repeat(32)}` as Hex };
    await expect(
      commitTypedIntentTool(unreachableCtx(), { runId: RUN_ID, intent }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });

  it('rejects a request that fails the strict input schema (e.g. runId is not a uuid)', async () => {
    const intent = validIntent(VAULT);
    await expect(
      commitTypedIntentTool(unreachableCtx(), { runId: 'not-a-uuid', intent }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });

  it('rejects a payload carrying an extra field the schema does not define', async () => {
    const intent = validIntent(VAULT);
    await expect(
      commitTypedIntentTool(unreachableCtx(), {
        runId: RUN_ID,
        intent,
        contractAddress: NOT_A_VAULT, // an attempted escape hatch — must be rejected, not ignored
      }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });
});

describe('executeApprovedMintTool — unsafe requests rejected before touching KeeperHub', () => {
  it('the input schema is strict: no shares/contractAddress override field is even accepted', () => {
    const parsed = executeApprovedMintInputSchema.safeParse({
      runId: RUN_ID,
      dbIntentId: RUN_ID,
      shares: '999999999999999999999999999',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a request whose input fails the strict schema', async () => {
    await expect(
      executeApprovedMintTool(unreachableCtx(), { runId: 'not-a-uuid', dbIntentId: RUN_ID }),
    ).rejects.toThrow(UnsafeToolRequestError);
  });
});

describe('queryRunStateInputSchema — read-only tool input is also strict', () => {
  it('rejects a non-uuid runId', () => {
    expect(queryRunStateInputSchema.safeParse({ runId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an unexpected extra field', () => {
    expect(
      queryRunStateInputSchema.safeParse({ runId: RUN_ID, includeSecrets: true }).success,
    ).toBe(false);
  });

  it('accepts a well-formed request', () => {
    expect(queryRunStateInputSchema.safeParse({ runId: RUN_ID }).success).toBe(true);
  });
});
