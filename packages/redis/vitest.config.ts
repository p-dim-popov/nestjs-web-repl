import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// No decorators here, so no swc plugin and no reflect-metadata setup file.
export default defineConfig({
  resolve: {
    // Run against core's SOURCE so `npm test` needs no prior build (same
    // pattern as packages/nestjs). The build resolves the workspace symlink
    // to packages/core/dist instead (see tsconfig.build.json).
    alias: { '@remote-repl/core': resolve(__dirname, '../core/src/index.ts') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
