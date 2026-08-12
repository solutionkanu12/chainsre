/**
 * Server entry point. Loads and validates env, builds the app, binds the port,
 * and installs graceful-shutdown handlers so in-flight requests drain on
 * SIGINT/SIGTERM.
 */
import { createLogger } from '@chainsre/shared/logger';

import { buildApp } from './app';
import { loadApiEnv } from './config/env';

async function main(): Promise<void> {
  const env = loadApiEnv();
  const log = createLogger({ level: env.LOG_LEVEL, base: { service: 'chainsre-api' } });

  const app = await buildApp({ env });

  try {
    await app.listen({ host: env.API_HOST, port: env.API_PORT });
    log.info('api listening', { host: env.API_HOST, port: env.API_PORT, env: env.NODE_ENV });
  } catch (err) {
    log.error('failed to start', { err });
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    app
      .close()
      .then(() => {
        log.info('closed cleanly');
        process.exit(0);
      })
      .catch((err: unknown) => {
        log.error('error during shutdown', { err });
        process.exit(1);
      });
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

void main();
