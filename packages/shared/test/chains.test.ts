import { describe, expect, it } from 'vitest';

import {
  BASE_SEPOLIA_CHAIN_ID,
  CHAINS,
  DEMO_CHAIN_ID,
  getChain,
  isSupportedChainId,
  SUPPORTED_CHAIN_IDS,
} from '../src/chains';

describe('chains', () => {
  it('demo chain is Base Sepolia', () => {
    expect(DEMO_CHAIN_ID).toBe(BASE_SEPOLIA_CHAIN_ID);
    expect(DEMO_CHAIN_ID).toBe(84532);
  });

  it('registry entries are self-consistent (id matches key)', () => {
    for (const [key, config] of Object.entries(CHAINS)) {
      expect(config.id).toBe(Number(key));
      expect(config.explorerUrl.startsWith('https://')).toBe(true);
    }
  });

  it('recognizes supported and rejects unsupported ids', () => {
    expect(isSupportedChainId(84532)).toBe(true);
    expect(isSupportedChainId(999999)).toBe(false);
  });

  it('getChain returns config for supported ids', () => {
    expect(getChain(84532).name).toBe('Base Sepolia');
    expect(getChain(8453).testnet).toBe(false);
  });

  it('getChain throws loudly on unknown ids', () => {
    expect(() => getChain(999999)).toThrow(/Unsupported chainId/);
  });

  it('SUPPORTED_CHAIN_IDS covers every registry key', () => {
    expect(SUPPORTED_CHAIN_IDS.slice().sort()).toEqual(Object.keys(CHAINS).map(Number).sort());
  });
});
