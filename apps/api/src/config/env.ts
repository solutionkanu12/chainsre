/**
 * Validated API environment. Loaded once at startup; a missing or malformed
 * variable throws before the server binds a port. No secret value is ever
 * logged — only the variable name appears in validation errors.
 */
import { parseEnv, zCsv, zLogLevel, zPort } from '@chainsre/shared/env';
import { z } from 'zod';

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: zPort.default(8080),
  LOG_LEVEL: zLogLevel.default('info'),

  // Comma-separated CORS allowlist. Empty in dev falls back to localhost:3000.
  CORS_ALLOWED_ORIGINS: zCsv.default('http://localhost:3000'),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(1_048_576),

  // Optional in Phase 1 (auth foundation is wired but not required to boot).
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source?: Record<string, string | undefined>): ApiEnv {
  return parseEnv(apiEnvSchema, source ? { source } : {});
}
