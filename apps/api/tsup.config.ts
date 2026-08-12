import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Bundle the workspace package (source-first exports) into the output so the
  // API runs without a separate build step for @chainsre/shared.
  noExternal: ['@chainsre/shared'],
});
