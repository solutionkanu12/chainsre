/** Block-explorer URL helpers, resolved from the multi-chain registry. */
import { getChain } from './chains';

export function txUrl(chainId: number, txHash: string): string {
  return `${getChain(chainId).explorerUrl}/tx/${txHash}`;
}

export function addressUrl(chainId: number, address: string): string {
  return `${getChain(chainId).explorerUrl}/address/${address}`;
}

export function blockUrl(chainId: number, block: number | bigint): string {
  return `${getChain(chainId).explorerUrl}/block/${block.toString()}`;
}

export function tokenUrl(chainId: number, address: string): string {
  return `${getChain(chainId).explorerUrl}/token/${address}`;
}
