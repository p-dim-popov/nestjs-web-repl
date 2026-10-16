import { defineConfig } from 'vitest/config';

// No decorators in core, so no swc plugin and no reflect-metadata setup file.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
