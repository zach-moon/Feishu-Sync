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
    include: ['tests/integration/**/*.{test,spec}.ts'],
    testTimeout: 30000,
  },
});
