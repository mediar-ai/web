import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: '', // Disable PostCSS
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 30000,
    root: '.',
  },
});
