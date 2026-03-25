// Re-export MODULE_IDS from types (canonical location)
export { MODULE_IDS, MODULE_HALF_LIVES, DEFAULT_WEIGHTS } from './types';

// ── Edge Thresholds ──
export const EDGE_ACTIONABILITY_THRESHOLD = 0.03;
export const EDGE_HIGH_THRESHOLD = 0.05;

// ── Market Categories ──
export const MARKET_CATEGORIES = ['POLITICS', 'FINANCE', 'CRYPTO', 'SCIENCE', 'SPORTS', 'CULTURE', 'OTHER'] as const;

// ── Concentration Limits (defaults) ──
export const CONCENTRATION_LIMITS = {
  SINGLE_MARKET: 0.05,
  SINGLE_CATEGORY: 0.25,
  SINGLE_PLATFORM: 0.60,
  CORRELATED_CLUSTER: 0.30,
  TOTAL_DEPLOYED: 0.80,
} as const;

// ── Risk Thresholds ──
export const RISK_LIMITS = {
  DAILY_LOSS_PCT: 0.05,
  WEEKLY_LOSS_PCT: 0.10,
  MAX_DRAWDOWN_PCT: 0.15,
  PORTFOLIO_HEAT_PCT: 0.20,
} as const;

// ── Alert Cooldowns (minutes) ──
export const ALERT_COOLDOWNS: Record<string, number> = {
  NEW_EDGE_HIGH: 60,
  NEW_EDGE_MODERATE: 240,
  SMART_MONEY_MOVE: 30,
  PRICE_SPIKE: 60,
  MODULE_FAILURE: 0,
  CAUSAL_INCONSISTENCY: 360,
  EDGE_EVAPORATION: Infinity, // once per edge
};

// ── Job Schedules (ms) ──
export const JOB_SCHEDULES = {
  MARKET_SYNC: 5 * 60 * 1000,
  ORDERBOOK_SYNC: 5 * 60 * 1000,
  NEWS_INGEST: 5 * 60 * 1000,
  SIGNAL_PIPELINE: 15 * 60 * 1000,
  WALLET_PROFILE: 60 * 60 * 1000,
  WALLET_MONITOR: 5 * 60 * 1000,
  GRAPH_REBUILD: 6 * 60 * 60 * 1000,
  CONSISTENCY_CHECK: 15 * 60 * 1000,
  ARB_SCAN: 60 * 1000, // every 60 seconds — arb-sensitive
  CRYPTO_STRATEGY: 30 * 1000, // every 30 seconds — short-duration crypto markets
  DAILY_DIGEST: '0 13 * * *', // 8 AM ET = 13:00 UTC (cron, not ms)
  DATA_RETENTION: 24 * 60 * 60 * 1000, // daily cleanup
  WEIGHT_UPDATE: 60 * 60 * 1000, // hourly module weight recalculation
} as const;
