/**
 * Chain registry. The ChainSRE MVP demo runs only on Base Sepolia, but the
 * registry is intentionally multi-chain so later phases can add Base mainnet
 * and other networks without touching call sites.
 */

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface ChainConfig {
  readonly id: number;
  readonly name: string;
  /** Stable machine-friendly identifier, e.g. "base-sepolia". */
  readonly shortName: string;
  readonly explorerUrl: string;
  readonly explorerName: string;
  readonly nativeCurrency: NativeCurrency;
  readonly testnet: boolean;
}

export const BASE_SEPOLIA_CHAIN_ID = 84532;

const ETH: NativeCurrency = { name: 'Ether', symbol: 'ETH', decimals: 18 };

/**
 * Known chains. Add entries here to support additional networks; nothing else
 * needs to change. Keyed by numeric chain id.
 */
export const CHAINS = {
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'base-sepolia',
    explorerUrl: 'https://sepolia.basescan.org',
    explorerName: 'BaseScan',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    testnet: true,
  },
  8453: {
    id: 8453,
    name: 'Base',
    shortName: 'base',
    explorerUrl: 'https://basescan.org',
    explorerName: 'BaseScan',
    nativeCurrency: ETH,
    testnet: false,
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    shortName: 'sepolia',
    explorerUrl: 'https://sepolia.etherscan.io',
    explorerName: 'Etherscan',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    testnet: true,
  },
  1: {
    id: 1,
    name: 'Ethereum',
    shortName: 'ethereum',
    explorerUrl: 'https://etherscan.io',
    explorerName: 'Etherscan',
    nativeCurrency: ETH,
    testnet: false,
  },
} satisfies Record<number, ChainConfig>;

export type SupportedChainId = keyof typeof CHAINS;

/** The single chain the MVP demo runs on. Multi-chain support exists in the registry. */
export const DEMO_CHAIN_ID: SupportedChainId = BASE_SEPOLIA_CHAIN_ID;

export const SUPPORTED_CHAIN_IDS: readonly SupportedChainId[] = Object.freeze(
  (Object.keys(CHAINS) as unknown as string[]).map((k) => Number(k) as SupportedChainId),
);

export function isSupportedChainId(id: number): id is SupportedChainId {
  return Object.prototype.hasOwnProperty.call(CHAINS, id);
}

/** Look up a chain config, throwing on unknown ids so callers fail loudly. */
export function getChain(id: number): ChainConfig {
  if (!isSupportedChainId(id)) {
    throw new Error(`Unsupported chainId: ${id}`);
  }
  return CHAINS[id];
}
