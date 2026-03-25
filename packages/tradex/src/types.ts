import type { Platform, EdgeDirection } from '@apex/shared';

// ── Execution Modes ──

export type ExecutionMode = 'FAST_EXEC' | 'SLOW_EXEC';

export type ExecutionStatus = 'PENDING' | 'FILLED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

export type ArbStatus = 'BOTH_FILLED' | 'PARTIAL' | 'FAILED';

// ── FAST_EXEC signal sources (auto-execute, speed is the edge) ──
export const FAST_EXEC_MODULES = ['ARBEX', 'SPEEDEX', 'FLOWEX', 'SIGINT'] as const;

// ── SLOW_EXEC signal sources (Telegram confirmation) ──
export const SLOW_EXEC_MODULES = ['DOMEX', 'LEGEX', 'COGEX', 'REFLEX', 'NEXUS', 'ALTEX'] as const;

// ── Order Request ──

export interface OrderRequest {
  platform: Platform;
  ticker: string;        // market/contract identifier
  side: 'yes' | 'no';
  action: 'buy' | 'sell';
  type: 'market_limit' | 'limit';
  price: number;         // 0.01-0.99
  size: number;          // dollars or contracts
}

export interface OrderResult {
  orderId: string;
  platform: Platform;
  status: ExecutionStatus;
  filledPrice: number | null;
  filledSize: number | null;
  fee: number;
  latencyMs: number;
  errorMessage?: string;
}

// ── Preflight ──

export type PreflightGate =
  | 'RISK_GATE'
  | 'BALANCE_CHECK'
  | 'EDGE_VALID'
  | 'FEE_CHECK'
  | 'GRADUATION_CHECK'
  | 'DAILY_LIMIT'
  | 'POSITION_COUNT';

export interface PreflightResult {
  pass: boolean;
  failedGate?: PreflightGate;
  reason?: string;
  details?: Record<string, unknown>;
}

// ── Risk Limits ──

export interface RiskLimitConfig {
  maxPerTrade: number;
  maxDailyNewTrades: number;
  maxSimultaneousPositions: number;
  maxTotalDeployed: number;
  consecutiveLossHalt: number;
  dailyPnlHalt: number;
  maxArbExecutionsPerHour: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimitConfig = {
  maxPerTrade: 10,
  maxDailyNewTrades: 30,
  maxSimultaneousPositions: 5,
  maxTotalDeployed: 100,
  consecutiveLossHalt: 3,
  dailyPnlHalt: -15,
  maxArbExecutionsPerHour: 3,
};

export const HARD_CEILINGS: RiskLimitConfig = {
  maxPerTrade: 500,
  maxDailyNewTrades: 1000,
  maxSimultaneousPositions: 25,
  maxTotalDeployed: 5000,
  consecutiveLossHalt: 10,
  dailyPnlHalt: -500,
  maxArbExecutionsPerHour: 50,
};

// ── Arb Signal ──

export interface ArbSignal {
  edgeId: string;
  leg1: {
    platform: Platform;
    ticker: string;
    side: 'yes' | 'no';
    price: number;
    size: number;
  };
  leg2: {
    platform: Platform;
    ticker: string;
    side: 'yes' | 'no';
    price: number;
    size: number;
  };
  expectedGrossSpread: number;
  expectedNetProfit: number;
}
