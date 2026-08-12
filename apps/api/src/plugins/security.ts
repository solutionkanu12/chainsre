/**
 * Baseline security plugins: strict security headers (helmet), a CORS
 * allowlist, and rate limiting. Registered as one encapsulation-friendly
 * plugin so the app builder stays readable and tests can build the same app.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { ApiEnv } from '../config/env';

async function securityPlugin(app: FastifyInstance, env: ApiEnv): Promise<void> {
  // Strict security headers. API serves JSON only, so a locked-down CSP is safe.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  // CORS allowlist. Requests with no Origin (curl, server-to-server, health
  // probes) are allowed; browser origins must be on the list.
  const allowed = new Set(env.CORS_ALLOWED_ORIGINS);
  await app.register(cors, {
    origin(origin, cb) {
      if (!origin || allowed.has(origin)) {
        cb(null, true);
        return;
      }
      // A disallowed origin is a client policy rejection, not a server fault.
      const err = new Error('Origin not allowed by CORS policy') as Error & {
        statusCode?: number;
      };
      err.statusCode = 403;
      cb(err, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });
}

export default fp(securityPlugin, { name: 'security' });
