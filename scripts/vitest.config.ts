import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts', 'tests/**/*.prop.ts'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/sync-to-feishu.ts'],
    },
  },
});
