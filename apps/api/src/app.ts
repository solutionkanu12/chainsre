/**
 * Application factory. Builds a fully-configured Fastify instance without
 * binding a port, so both server.ts and the test suite construct the app the
 * same way. Wires Zod validation/serialization, security baseline, a
 * structured secret-redacting logger, sane body limits, and a consistent
 * error shape.
 */
import { createLogger } from '@chainsre/shared/logger';
import { errorResponseSchema } from '@chainsre/shared/schemas';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { loadApiEnv, type ApiEnv } from './config/env';
import { createSupabaseClients, type SupabaseClients } from './lib/supabase';
import securityPlugin from './plugins/security';
import { healthRoutes } from './routes/health';

// Make the augmented properties visible to route handlers.
declare module 'fastify' {
  interface FastifyInstance {
    appEnv: ApiEnv;
    supabase: SupabaseClients;
  }
}

export interface BuildAppOptions {
  env?: ApiEnv;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadApiEnv();

  const log = createLogger({ level: env.LOG_LEVEL, base: { service: 'chainsre-api' } });

  const app = Fastify({
    // Reject oversized bodies before they are buffered.
    bodyLimit: env.BODY_LIMIT_BYTES,
    // Trust the immediate proxy so rate limiting keys on the real client IP.
    trustProxy: true,
    // Disable Fastify's built-in pino; we use our own redacting logger. With
    // logging off there are no request logs to disable separately.
    logger: false,
  }).withTypeProvider<ZodTypeProvider>();

  // Zod drives both request validation and response serialization.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('appEnv', env);
  app.decorate('supabase', createSupabaseClients(env));

  // Consistent, non-leaky error envelope. The Zod type provider types the
  // thrown error as `unknown` (validation errors are not FastifyError), so we
  // narrow defensively.
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { statusCode?: number; name?: string; message?: string };
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      log.error('request failed', {
        method: request.method,
        url: request.url,
        err: error,
      });
    } else {
      log.warn('request rejected', {
        method: request.method,
        url: request.url,
        statusCode,
        reason: err.message,
      });
    }
    const body = errorResponseSchema.parse({
      error: err.name || 'Error',
      // Never surface internal error detail on 5xx.
      message: statusCode >= 500 ? 'Internal Server Error' : (err.message ?? 'Error'),
      statusCode,
    });
    void reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body = errorResponseSchema.parse({
      error: 'NotFound',
      message: `Route ${request.method} ${request.url} not found`,
      statusCode: 404,
    });
    void reply.status(404).send(body);
  });

  await app.register(securityPlugin, env);
  await app.register(healthRoutes);

  return app;
}
