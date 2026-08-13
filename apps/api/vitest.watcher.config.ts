import { defineConfig } from 'vitest/config';

/**
 * Separate config for the watcher's behavioral tests only — these need a
 * real Postgres+PostgREST pair (see test/watcher/global-setup.ts) and
 * Docker, unlike the rest of apps/api's suite (fetch-mocked, no DB). Kept
 * out of the default `vitest.config.ts`/`pnpm test` so unrelated tests
 * (keeperhub/app/env) never pay the container-startup cost or require
 * Docker to run at all. Invoked via `pnpm test:watcher`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/watcher/*.behavior.test.ts'],
    globalSetup: ['test/watcher/global-setup.ts'],
    // Container bring-up + full migration apply can take a while on a cold
    // image cache; give tests headroom beyond vitest's 5s default.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
