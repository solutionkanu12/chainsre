/**
 * KeeperHub credentials, loaded separately from the main API env.
 *
 * These are required only by code paths that actually talk to KeeperHub (the
 * client factory, the live-proof script) — not by every route or by `pnpm test`
 * / `pnpm build`, which must keep working on a clean checkout with no KeeperHub
 * key configured. Call {@link loadKeeperHubEnv} at the point of use and let it
 * throw there; never make it a silent global default.
 *
 * The key itself is never logged. `parseEnv` (from `@chainsre/shared/env`) only
 * ever reports variable *names* in validation errors, never values.
 */
import { parseEnv, zHttpUrl } from '@chainsre/shared/env';
import { z } from 'zod';

const keeperHubEnvSchema = z.object({
  /** `Authorization: Bearer <this>` on every KeeperHub request. Server-only. */
  KEEPERHUB_API_KEY: z
    .string()
    .min(8, 'KEEPERHUB_API_KEY looks too short to be a real key')
    .describe('KeeperHub organization API key (kh_...). Server-side only, never logged.'),

  /** Paths already include `/api`; do not append it again here. */
  KEEPERHUB_BASE_URL: zHttpUrl.default('https://app.keeperhub.com'),

  /** Workflow that calls `pause()` on the real protected DemoVault. */
  KEEPERHUB_GUARDIAN_WORKFLOW_ID: z.string().min(1).optional(),
});

export type KeeperHubEnv = z.infer<typeof keeperHubEnvSchema>;

/**
 * Load and validate KeeperHub credentials. Throws {@link EnvValidationError}
 * (from `@chainsre/shared/env`) with a message listing missing/invalid
 * variable *names* — never values — when required configuration is absent.
 */
export function loadKeeperHubEnv(source?: Record<string, string | undefined>): KeeperHubEnv {
  const env = parseEnv(keeperHubEnvSchema, source ? { source } : {});
  // Normalize away a trailing slash so `${baseUrl}${path}` never double-slashes.
  return { ...env, KEEPERHUB_BASE_URL: env.KEEPERHUB_BASE_URL.replace(/\/+$/, '') };
}

/** Like {@link loadKeeperHubEnv}, but additionally requires the guardian workflow id. */
export function loadKeeperHubEnvWithGuardian(
  source?: Record<string, string | undefined>,
): KeeperHubEnv & { KEEPERHUB_GUARDIAN_WORKFLOW_ID: string } {
  const env = loadKeeperHubEnv(source);
  if (!env.KEEPERHUB_GUARDIAN_WORKFLOW_ID) {
    throw new Error(
      'Missing required environment variable: KEEPERHUB_GUARDIAN_WORKFLOW_ID ' +
        '(the KeeperHub workflow id that calls pause() on the protected DemoVault)',
    );
  }
  return { ...env, KEEPERHUB_GUARDIAN_WORKFLOW_ID: env.KEEPERHUB_GUARDIAN_WORKFLOW_ID };
}
