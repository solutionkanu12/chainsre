/**
 * Health route. Returns a Zod-validated payload so the response shape is part
 * of the shared HTTP contract and drift is caught at build time.
 */
import { healthResponseSchema } from '@chainsre/shared/schemas';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

const SERVICE_NAME = 'chainsre-api';
const VERSION = '0.1.0';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/health',
    {
      schema: {
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: SERVICE_NAME,
      version: VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }),
  );
}
