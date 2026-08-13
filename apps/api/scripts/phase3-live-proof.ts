#!/usr/bin/env tsx
/**
 * ChainSRE Phase 3 — standalone, no-frontend, KeeperHub-backed live proof.
 *
 * Proves, against real Base Sepolia (84532) and the real Phase 2 contracts,
 * that ChainSRE can: authenticate to KeeperHub; confirm chain readiness;
 * commit a fresh typed `MintIntentV1` through KeeperHub; execute the declared
 * mint through KeeperHub; trigger the real guardian workflow through
 * KeeperHub; and independently verify every claim by reading Base Sepolia
 * directly — never trusting a KeeperHub-reported status as the final word.
 *
 * Safety model (same shape as `phase0/*.sh`):
 *   - Every state-changing step is preceded by a dry-run stage that prints the
 *     exact request and does nothing.
 *   - No real write happens unless `CONFIRM_BROADCAST=yes` is set.
 *   - Nothing secret is ever printed. Only public evidence — execution ids,
 *     workflow ids, tx hashes, BaseScan links, on-chain read results — reaches
 *     stdout.
 *
 * Usage:
 *   pnpm --filter @chainsre/api proof:phase3                 # dry run
 *   CONFIRM_BROADCAST=yes pnpm --filter @chainsre/api proof:phase3
 *
 * Required environment (see `.env.example`):
 *   KEEPERHUB_API_KEY, KEEPERHUB_GUARDIAN_WORKFLOW_ID, BASE_SEPOLIA_RPC_HTTP
 * Optional:
 *   AGENT_ADDRESS       (defaults to the Phase 0/2 KeeperHub sender wallet)
 *   DEPLOYER_PRIVATE_KEY (if set, the script restores the vault to unpaused
 *                         afterward via a direct admin `unpause()` call — the
 *                         documented, intended reset path. If unset, the
 *                         script still completes the proof and prints a clear
 *                         manual follow-up instead of silently leaving the
 *                         canonical demo vault paused.)
 *   CHAINSRE_RUN_ID      (reuse across retries of a failed attempt so the
 *                         idempotency keys stay stable instead of minting a
 *                         second real transaction for the same logical step)
 */
import { buildMintIntent, MINT_SHARES_SELECTOR } from '@chainsre/shared/intent-hash';
import { createWalletClient, http, publicActions, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

import {
  demoVaultAbi,
  intentRegistryAbi,
  loadChainEnv,
  createBaseSepoliaClient,
} from '../src/lib/chain';
import {
  buildIdempotencyKey,
  checkAuth,
  executeContractCallSafely,
  executeWorkflowSafely,
  loadKeeperHubEnvWithGuardian,
  requireChainEnabled,
  type ContractCallRequest,
} from '../src/lib/keeperhub';

const DECLARED_SHARES = '950000000000000000000'; // 950 * 1e18, matches the ChainSRE demo story.
const DEFAULT_AGENT_ADDRESS: Hex = '0x6C0a292C3e7CF192EfB4d6c7328FcAFf12208bcB';

function confirmedBroadcast(): boolean {
  return process.env.CONFIRM_BROADCAST === 'yes';
}

function explorerTxLink(hash: string): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}

const results: { step: string; ok: boolean; detail: string }[] = [];
function record(step: string, ok: boolean, detail: string): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? '[OK]  ' : '[XX]  '}${step} — ${detail}`);
}

async function retry<T>(label: string, attempts: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.log(`  (retry ${i}/${attempts} for ${label}: ${(err as Error).message})`);
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  console.log('=== ChainSRE Phase 3 — KeeperHub live proof ===');
  console.log(
    `mode: ${confirmedBroadcast() ? 'REAL BROADCAST (CONFIRM_BROADCAST=yes)' : 'dry run'}`,
  );
  console.log();

  // ---- 1. Load & validate configuration (never prints secret values) ------
  const keeperHubEnv = loadKeeperHubEnvWithGuardian();
  const chainEnv = loadChainEnv();
  const agentAddress = (process.env.AGENT_ADDRESS as Hex | undefined) ?? DEFAULT_AGENT_ADDRESS;
  const runId = process.env.CHAINSRE_RUN_ID ?? `phase3-proof-${Date.now()}`;
  console.log(`runId: ${runId}`);
  console.log(`agent/receiver: ${agentAddress}`);
  console.log(`registry: ${chainEnv.INTENT_REGISTRY_ADDRESS}`);
  console.log(`protected vault: ${chainEnv.PROTECTED_VAULT_ADDRESS}`);
  console.log();

  const rpc = createBaseSepoliaClient(chainEnv);

  // ---- 2. Readiness -------------------------------------------------------
  const authOk = await retry('KeeperHub auth check', 3, () => checkAuth(keeperHubEnv));
  record(
    'KeeperHub credential valid',
    authOk,
    authOk ? 'GET /api/keys -> 2xx' : 'GET /api/keys -> 401',
  );
  if (!authOk) {
    throw new Error('KEEPERHUB_API_KEY is not valid — aborting before any further step');
  }

  const chain = await retry('chain discovery', 3, () =>
    requireChainEnabled(keeperHubEnv, chainEnv.CHAIN_ID),
  );
  record(
    'Base Sepolia available',
    true,
    `chainId=${chain.chainId} isEnabled=${chain.isEnabled} usePrivateMempoolRpc=${chain.usePrivateMempoolRpc}`,
  );

  // ---- 3. Build a fresh MintIntentV1 (never reuses a prior nonce) ---------
  const deadline = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const nonce = BigInt(Date.now()); // uint64-safe, monotonic, never collides with a prior run's nonce.
  const intent = buildMintIntent({
    chainId: chainEnv.CHAIN_ID,
    agent: agentAddress,
    target: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
    selector: MINT_SHARES_SELECTOR,
    receiver: agentAddress,
    shares: DECLARED_SHARES,
    deadline,
    nonce,
  });
  console.log();
  console.log('Fresh MintIntentV1:');
  console.log(`  intentId  = ${intent.intentId}`);
  console.log(`  declared shares = ${intent.shares} (950 * 1e18)`);
  console.log(
    `  deadline  = ${intent.deadline} (${new Date(intent.deadline * 1000).toISOString()})`,
  );
  console.log(`  nonce     = ${intent.nonce}`);
  console.log();

  const commitIntentAbi = intentRegistryAbi.filter((f) => f.name === 'commitIntent');
  const mintSharesAbi = demoVaultAbi.filter((f) => f.name === 'mintShares');
  const pauseAbi = demoVaultAbi.filter((f) => f.name === 'pause');

  const paramsHashArgs = [intent.receiver, BigInt(intent.shares)] as const;
  // Recompute paramsHash the same way the contract does, so the request we
  // send is self-consistent with the intentId above (see IntentHashLib.sol).
  const paramsHash = await rpc.readContract({
    address: chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
    abi: intentRegistryAbi,
    functionName: 'hashParams',
    args: paramsHashArgs,
  });

  const commitReq: ContractCallRequest = {
    contractAddress: chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
    chainId: chainEnv.CHAIN_ID,
    functionName: 'commitIntent',
    functionArgs: [
      intent.intentId,
      intent.target,
      intent.selector,
      paramsHash,
      intent.deadline,
      intent.nonce,
    ],
    abi: commitIntentAbi,
  };

  if (!confirmedBroadcast()) {
    console.log('[DRY RUN] Would commit intent via KeeperHub:');
    console.log(
      `  POST /api/execute/contract-call  Idempotency-Key: ${buildIdempotencyKey(runId, 'commit')}`,
    );
    console.log(`  ${JSON.stringify(commitReq, null, 2)}`);
    console.log();
    console.log('Re-run with CONFIRM_BROADCAST=yes to execute the real proof.');
    printSummary();
    return;
  }

  // ---- 4. Commit the intent through KeeperHub ------------------------------
  const commitExec = await executeContractCallSafely(
    keeperHubEnv,
    commitReq,
    buildIdempotencyKey(runId, 'commit'),
  );
  record(
    'Intent committed via KeeperHub',
    true,
    `executionId=${commitExec.executionId} tx=${commitExec.transactionHash} ${
      commitExec.transactionHash ? explorerTxLink(commitExec.transactionHash) : ''
    }`,
  );

  const isCommitted = await retry('independent isCommitted() read', 5, () =>
    rpc.readContract({
      address: chainEnv.INTENT_REGISTRY_ADDRESS as Hex,
      abi: intentRegistryAbi,
      functionName: 'isCommitted',
      args: [intent.intentId],
    }),
  );
  record(
    'Independently verified on-chain: isCommitted()',
    isCommitted,
    `isCommitted(${intent.intentId}) = ${isCommitted}`,
  );
  if (!isCommitted)
    throw new Error('KeeperHub reported success but isCommitted() is false on-chain');

  // ---- 5. Execute the declared mint through KeeperHub ----------------------
  const sharesBefore = await retry('sharesOf() before mint', 5, () =>
    rpc.readContract({
      address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
      abi: demoVaultAbi,
      functionName: 'sharesOf',
      args: [agentAddress],
    }),
  );

  const mintReq: ContractCallRequest = {
    contractAddress: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
    chainId: chainEnv.CHAIN_ID,
    functionName: 'mintShares',
    functionArgs: [intent.intentId, intent.receiver, intent.shares],
    abi: mintSharesAbi,
  };
  const mintExec = await executeContractCallSafely(
    keeperHubEnv,
    mintReq,
    buildIdempotencyKey(runId, 'mint'),
  );
  record(
    'Declared mint (950) executed via KeeperHub',
    true,
    `executionId=${mintExec.executionId} tx=${mintExec.transactionHash} ${
      mintExec.transactionHash ? explorerTxLink(mintExec.transactionHash) : ''
    }`,
  );

  const sharesAfter = await retry('sharesOf() after mint', 5, () =>
    rpc.readContract({
      address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
      abi: demoVaultAbi,
      functionName: 'sharesOf',
      args: [agentAddress],
    }),
  );
  const delta = sharesAfter - sharesBefore;
  const mintOk = delta === BigInt(DECLARED_SHARES);
  record(
    'Independently verified on-chain: sharesOf() delta',
    mintOk,
    `sharesOf before=${sharesBefore} after=${sharesAfter} delta=${delta} (expected ${DECLARED_SHARES})`,
  );
  if (!mintOk)
    throw new Error('KeeperHub reported success but the on-chain share delta does not match');

  // ---- 6. Trigger the real guardian workflow through KeeperHub -------------
  const pausedBefore = await rpc.readContract({
    address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
    abi: demoVaultAbi,
    functionName: 'paused',
  });
  console.log();
  console.log(
    `Triggering guardian workflow ${keeperHubEnv.KEEPERHUB_GUARDIAN_WORKFLOW_ID} (paused before: ${pausedBefore})`,
  );

  const workflowExec = await executeWorkflowSafely(
    keeperHubEnv,
    keeperHubEnv.KEEPERHUB_GUARDIAN_WORKFLOW_ID,
    buildIdempotencyKey(runId, 'pause'),
  );
  const nodeTx = workflowExec.transactionHashes[0];
  record(
    'Guardian workflow executed via KeeperHub',
    true,
    `workflowExecutionId=${workflowExec.executionId} nodeTx=${nodeTx?.hash ?? '(none reported)'} ` +
      `${nodeTx ? explorerTxLink(nodeTx.hash) : ''} receiptStatus=${nodeTx?.receiptStatus ?? 'n/a'}`,
  );

  // ---- 7. Independently verify containment — a 2xx is not enough ----------
  const pausedAfter = await retry('independent paused() read', 8, () =>
    rpc.readContract({
      address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
      abi: demoVaultAbi,
      functionName: 'paused',
    }),
  );
  record(
    'Independently verified on-chain: paused() == true',
    pausedAfter,
    `paused() = ${pausedAfter}`,
  );
  if (!pausedAfter) {
    throw new Error(
      'KeeperHub reported the workflow completed but paused() is still false on-chain',
    );
  }

  // ---- 8. Restore canonical demo state (documented reset path) ------------
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (deployerKey) {
    const account = privateKeyToAccount(deployerKey as Hex);
    const wallet = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(chainEnv.BASE_SEPOLIA_RPC_HTTP),
    }).extend(publicActions);
    const unpauseTx = await wallet.writeContract({
      address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
      abi: demoVaultAbi,
      functionName: 'unpause',
    });
    await wallet.waitForTransactionReceipt({ hash: unpauseTx });
    const pausedFinal = await rpc.readContract({
      address: chainEnv.PROTECTED_VAULT_ADDRESS as Hex,
      abi: demoVaultAbi,
      functionName: 'paused',
    });
    record(
      'Canonical demo vault restored to unpaused (admin unpause())',
      !pausedFinal,
      `tx=${unpauseTx} ${explorerTxLink(unpauseTx)} paused()=${pausedFinal}`,
    );
  } else {
    console.log();
    console.log(
      '[!!] DEPLOYER_PRIVATE_KEY not set - the protected vault is left PAUSED. ' +
        'Run: cast send <vault> "unpause()" --private-key $DEPLOYER_PRIVATE_KEY ' +
        '--rpc-url $BASE_SEPOLIA_RPC_HTTP  before any later phase relies on an unpaused vault.',
    );
  }
  void pauseAbi; // reserved for a future guardian-role smoke check; unused for now.

  printSummary();
}

function printSummary(): void {
  console.log();
  console.log('=== Summary (public evidence only) ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}: ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log();
    console.log(`${failed.length} step(s) failed.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  // Deliberately prints only a message string, never the raw error object —
  // defense in depth against some future thrown value carrying extra fields.
  console.error();
  console.error('Phase 3 live proof FAILED:', err instanceof Error ? err.message : String(err));
  printSummary();
  process.exitCode = 1;
});
