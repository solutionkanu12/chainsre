/** Shared HTTP contract schemas used by the API and, later, typed clients. */
import { z } from 'zod';

export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string(),
    version: z.string(),
    uptimeSeconds: z.number().nonnegative(),
    timestamp: z.string(),
  })
  .strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    statusCode: z.number().int(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
