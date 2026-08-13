import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Starts a real Postgres + PostgREST pair once for the whole run (see
    // test/integration/global-setup.ts) so the integration suite exercises
    // the actual migrations and RLS policies, not a re-implementation of
    // them. Requires Docker; see that file's docstring for the clear error
    // it raises when the daemon is unreachable.
    globalSetup: ['test/integration/global-setup.ts'],
    // Container bring-up + full migration apply can take a while on a cold
    // image cache; give tests headroom beyond vitest's 5s default.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
