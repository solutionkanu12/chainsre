/**
 * Environment-variable parsing helpers built on Zod. Every service defines its
 * own env schema from these primitives and calls parseEnv, so a missing or
 * malformed variable fails fast at startup with a readable message instead of
 * surfacing as an undefined-at-runtime bug.
 */
import { z } from 'zod';

import { isSupportedChainId } from './chains';

export const zLogLevel = z.enum(['debug', 'info', 'warn', 'error']);

/** TCP port as a coerced integer in the valid range. */
export const zPort = z.coerce.number().int().min(1).max(65535);

/** A supported chain id, coerced from string env input. */
export const zChainId = z.coerce
  .number()
  .int()
  .refine((n) => isSupportedChainId(n), {
    message: 'must be a supported chain id',
  });

/** Comma-separated list → trimmed, non-empty string array. */
export const zCsv = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string()));

/** An http(s) URL string. */
export const zHttpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'must be an http(s) URL',
  });

/** Truthy/falsy env string → boolean. */
export const zBool = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no']))
  .transform((s) => s === 'true' || s === '1' || s === 'yes');

export interface ParseEnvOptions {
  /** Where variables are read from. Defaults to process.env. */
  source?: Record<string, string | undefined>;
}

export class EnvValidationError extends Error {
  public readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate `source` against `schema`, throwing an EnvValidationError whose
 * message lists every problem. Never logs values, so secrets are not leaked
 * through validation errors.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  options: ParseEnvOptions = {},
): z.infer<T> {
  const source =
    options.source ??
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
    {};
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}
