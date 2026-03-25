import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: '../../.env', override: true });

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // API Auth
  API_KEY: z.string().min(1),

  // Kalshi
  KALSHI_API_KEY: z.string().default(''),
  KALSHI_API_SECRET: z.string().default(''),
  KALSHI_PRIVATE_KEY_PATH: z.string().default(''),
  KALSHI_BASE_URL: z.string().default('https://api.elections.kalshi.com/trade-api/v2'),

  // Polymarket
  POLYMARKET_CLOB_URL: z.string().default('https://clob.polymarket.com'),
  POLYMARKET_GAMMA_URL: z.string().default('https://gamma-api.polymarket.com'),
  POLYMARKET_API_KEY: z.string().default(''),

  // Claude API
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_DAILY_BUDGET: z.coerce.number().default(10.00),

  // Data Sources
  BINANCE_WS_ENABLED: z.coerce.boolean().default(true),
  FRED_API_KEY: z.string().default(''),
  CONGRESS_API_KEY: z.string().default(''),

  // Server
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      console.error('Invalid environment variables:');
      console.error(result.error.format());
      process.exit(1);
    }
    _config = result.data;
  }
  return _config;
}

export const config = getConfig();
