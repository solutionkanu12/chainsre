import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Behavioral watcher tests need a real Postgres+PostgREST pair (see
    // vitest.watcher.config.ts) and run via `pnpm test:watcher` instead —
    // excluded here so the default `pnpm test` stays fast and Docker-free
    // for every other suite in this package.
    exclude: [...configDefaults.exclude, 'test/watcher/*.behavior.test.ts'],
  },
});
