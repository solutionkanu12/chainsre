import { defineConfig } from 'vitest/config';

/**
 * Config for the demo-scenario behavioral tests only — these need the same
 * real Postgres+PostgREST pair as the watcher's (`test/watcher/global-setup.ts`,
 * reused verbatim rather than duplicated: same harness, same container names
 * and ports, just a different set of test files). Kept out of the default
 * `vitest.config.ts`/`pnpm test` for the same reason as `vitest.watcher.config.ts`
 * — unrelated fast tests never pay the Docker cost. Invoked via `pnpm test:demo`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/demo/*.behavior.test.ts'],
    globalSetup: ['test/watcher/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
