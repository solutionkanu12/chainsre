import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Behavioral watcher/demo tests need a real Postgres+PostgREST pair (see
    // vitest.watcher.config.ts / vitest.demo.config.ts) and run via
    // `pnpm test:watcher` / `pnpm test:demo` instead — excluded here so the
    // default `pnpm test` stays fast and Docker-free for every other suite.
    exclude: [
      ...configDefaults.exclude,
      'test/watcher/*.behavior.test.ts',
      'test/demo/*.behavior.test.ts',
    ],
  },
});
