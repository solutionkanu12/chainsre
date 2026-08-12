/**
 * Validated public (browser-exposed) configuration. Only NEXT_PUBLIC_* vars
 * belong here — never a secret. Next inlines these at build time, so each is
 * referenced statically below rather than iterated dynamically.
 *
 * Values are optional in Phase 1 (contract addresses are filled in later
 * phases); when present they are validated for shape.
 */
import { z } from 'zod';

const optionalAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte 0x address')
  .optional()
  .or(z.literal('').transform(() => undefined));

const publicEnvSchema = z.object({
  apiUrl: z.string().url().default('http://localhost:8080'),
  chainId: z.coerce.number().int().positive().default(84532),
  explorerUrl: z.string().url().default('https://sepolia.basescan.org'),
  intentRegistryAddress: optionalAddress,
  protectedVaultAddress: optionalAddress,
  controlVaultAddress: optionalAddress,
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  apiUrl: emptyToUndefined(process.env.NEXT_PUBLIC_API_URL),
  chainId: emptyToUndefined(process.env.NEXT_PUBLIC_CHAIN_ID),
  explorerUrl: emptyToUndefined(process.env.NEXT_PUBLIC_EXPLORER_URL),
  intentRegistryAddress: emptyToUndefined(process.env.NEXT_PUBLIC_INTENT_REGISTRY_ADDRESS),
  protectedVaultAddress: emptyToUndefined(process.env.NEXT_PUBLIC_PROTECTED_VAULT_ADDRESS),
  controlVaultAddress: emptyToUndefined(process.env.NEXT_PUBLIC_CONTROL_VAULT_ADDRESS),
});
