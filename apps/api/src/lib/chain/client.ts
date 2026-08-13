/**
 * Independent Base Sepolia read access, used to verify what KeeperHub
 * reports rather than trust it. An HTTP 2xx or a `completed` execution status
 * from KeeperHub is evidence that a request was accepted and processed — the
 * only authority on what actually happened on-chain is the chain itself.
 */
import { createPublicClient, http, type Hex, type PublicClient } from 'viem';

import { demoVaultAbi, intentRegistryAbi } from './abi';
import type { ChainEnv } from './env';

export function createBaseSepoliaClient(
  env: Pick<ChainEnv, 'BASE_SEPOLIA_RPC_HTTP'>,
): PublicClient {
  return createPublicClient({ transport: http(env.BASE_SEPOLIA_RPC_HTTP) });
}

/** Read `IntentRegistry.isCommitted(intentId)` directly from the chain. */
export async function readIsCommitted(
  client: PublicClient,
  registryAddress: Hex,
  intentId: Hex,
): Promise<boolean> {
  return client.readContract({
    address: registryAddress,
    abi: intentRegistryAbi,
    functionName: 'isCommitted',
    args: [intentId],
  });
}

/** Read `DemoVault.paused()` directly from the chain. */
export async function readPaused(client: PublicClient, vaultAddress: Hex): Promise<boolean> {
  return client.readContract({
    address: vaultAddress,
    abi: demoVaultAbi,
    functionName: 'paused',
  });
}

/** Read `DemoVault.sharesOf(holder)` directly from the chain. */
export async function readSharesOf(
  client: PublicClient,
  vaultAddress: Hex,
  holder: Hex,
): Promise<bigint> {
  return client.readContract({
    address: vaultAddress,
    abi: demoVaultAbi,
    functionName: 'sharesOf',
    args: [holder],
  });
}

/** Read the transaction receipt's on-chain status independently of KeeperHub. */
export async function readTransactionStatus(
  client: PublicClient,
  hash: Hex,
): Promise<'success' | 'reverted'> {
  const receipt = await client.getTransactionReceipt({ hash });
  return receipt.status;
}
