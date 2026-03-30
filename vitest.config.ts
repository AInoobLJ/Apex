import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
    ],
    env: {
      // Required by apps/api config.ts Zod schema — prevent process.exit(1) during test import
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      API_KEY: 'test-api-key',
      KALSHI_API_KEY: 'test',
      KALSHI_API_SECRET: 'test',
      KALSHI_BASE_URL: 'https://demo-api.kalshi.co/trade-api/v2',
      POLYMARKET_CLOB_URL: 'https://clob.polymarket.com',
      POLYMARKET_GAMMA_URL: 'https://gamma-api.polymarket.com',
      PORT: '3001',
      HOST: '0.0.0.0',
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
    },
  },
});
