/**
 * Base Sepolia RPC + deployed-contract configuration.
 *
 * Contract addresses default to the real Phase 2 deployment
 * (`packages/contracts/deployments/base-sepolia.json`, `PHASE-2-RESULTS.md` §1)
 * since those are public on-chain facts, not secrets — defaulting them removes
 * one source of drift between "the addresses ChainSRE actually deployed" and
 * "the addresses this code points at". `BASE_SEPOLIA_RPC_HTTP` has no safe
 * default (a public endpoint you don't control is a reliability risk, not a
 * correctness one) and is required only by code paths that read chain state.
 */
import { parseEnv, zChainId, zHttpUrl } from '@chainsre/shared/env';
import { z } from 'zod';

const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte 0x address');

const chainEnvSchema = z.object({
  BASE_SEPOLIA_RPC_HTTP: zHttpUrl,
  CHAIN_ID: zChainId.default(84_532),

  INTENT_REGISTRY_ADDRESS: zAddress.default('0x6A78fCF6Cb1BF7b45b98E262Ee65965263BB23F9'),
  MOCK_ASSET_ADDRESS: zAddress.default('0x961fA7f8cDcbA67717cE92c249443F74F3D448C5'),
  PROTECTED_VAULT_ADDRESS: zAddress.default('0x429F2b842e5B0BCfd5f8359736aCC444FB35fB4B'),
  CONTROL_VAULT_ADDRESS: zAddress.default('0xF0Dd43FBbEA515f2fa8e2c0C0a2C60f5eFC6f3b5'),
});

export type ChainEnv = z.infer<typeof chainEnvSchema>;

export function loadChainEnv(source?: Record<string, string | undefined>): ChainEnv {
  return parseEnv(chainEnvSchema, source ? { source } : {});
}
