import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// The shim's specs import `nestjs-web-repl` and `nestjs-web-repl/redis` by
// their PUBLIC names, aliased to this package's own barrels, and every
// @remote-repl/* package to its SOURCE so `npm test` needs no prior build
// (same pattern as packages/nestjs). The build resolves the workspace
// symlinks to the sibling packages' dist instead (see tsconfig.build.json).
// swc + reflect-metadata: @remote-repl/nestjs's sources carry decorators.
export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      'nestjs-web-repl/redis': resolve(__dirname, 'src/redis.ts'),
      'nestjs-web-repl': resolve(__dirname, 'src/index.ts'),
      '@remote-repl/nestjs': resolve(__dirname, '../nestjs/src/index.ts'),
      '@remote-repl/redis': resolve(__dirname, '../redis/src/index.ts'),
      '@remote-repl/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
});
