import type { Platform, EdgeDirection } from '@apex/shared';

// ── Trade Mode (live vs paper vs dry-run) ──

export type TradeMode = 'LIVE' | 'PAPER' | 'DRY_RUN';

// ── Execution Modes (speed-based routing) ──

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
  | 'POSITION_COUNT'
  | 'CONCENTRATION'
  | 'MARKET_OPEN'
  | 'BRACKET_CONFLICT';

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
  maxPerTrade: 500,            // $500 max single trade (5% of $10K bankroll)
  maxDailyNewTrades: 10000,    // Effectively unlimited during data collection
  maxSimultaneousPositions: 10000, // Effectively unlimited during data collection
  maxTotalDeployed: 5000,      // $5,000 max deployed (50% of bankroll)
  consecutiveLossHalt: 10,
  dailyPnlHalt: -1000,         // -$1,000 daily loss halt (10% of bankroll)
  maxArbExecutionsPerHour: 20,
};

export const HARD_CEILINGS: RiskLimitConfig = {
  maxPerTrade: 2000,
  maxDailyNewTrades: 10000,
  maxSimultaneousPositions: 10000,
  maxTotalDeployed: 10000,
  consecutiveLossHalt: 15,
  dailyPnlHalt: -2000,
  maxArbExecutionsPerHour: 50,
};

// ── Concentration Limits ──

export interface ConcentrationLimits {
  /** Max fraction of portfolio in one category (e.g., 0.25 = 25%) */
  maxPerCategory: number;
  /** Max fraction of portfolio in a single market/event */
  maxPerEvent: number;
  /** Max fraction of portfolio on one platform (Kalshi or Polymarket) */
  maxPerPlatform: number;
  /** Max number of open positions (hard cap) */
  maxOpenPositions: number;
}

export const DEFAULT_CONCENTRATION_LIMITS: ConcentrationLimits = {
  maxPerCategory: 0.90,   // 90% — data collection phase, crypto-focused
  maxPerEvent: 0.50,      // 50% per market — relaxed for data collection
  maxPerPlatform: 0.95,   // 95% — nearly all Kalshi
  maxOpenPositions: 10000, // Effectively unlimited
};

export const CONCENTRATION_HARD_CEILINGS: ConcentrationLimits = {
  maxPerCategory: 0.50,
  maxPerEvent: 0.30,
  maxPerPlatform: 0.80,
  maxOpenPositions: 50,
};

/** Snapshot of an existing open position for concentration checks. */
export interface PositionSnapshot {
  marketId: string;
  platform: Platform;
  category: string;
  notional: number; // dollar value of position (kellySize × entryPrice)
}

// ── Arb Signal ──

// ── Bracket Conflict Detection ──

/** A position in a mutually exclusive bracket group (same asset + expiry). */
export interface BracketPosition {
  marketId: string;
  /** Market title e.g. "ETH $1,970-$2,010 MAR 29 5PM" */
  title: string;
  /** Entry price in cents (0-1 range, e.g. 0.256 = 25.6¢) */
  entryPrice: number;
  /** Direction of the position */
  direction: EdgeDirection;
}

/** Group of mutually exclusive bracket positions for the same asset + expiry. */
export interface BracketGroup {
  /** Underlying asset: BTC, ETH, SOL, etc. */
  asset: string;
  /** Expiry date string for grouping (e.g. "29MAR2617") */
  expiry: string;
  /** Human-readable expiry (e.g. "MAR 29 5PM") */
  expiryDisplay: string;
  /** Existing open positions in this bracket group */
  positions: BracketPosition[];
  /** Sum of all entry prices across the group (0-1 scale) */
  totalCost: number;
  /** Maximum payout: ~$1 per contract (only one bracket wins) */
  maxPayout: number;
}

/** Context for Gate 10 bracket conflict check. */
export interface BracketConflictContext {
  /** Market title of the proposed trade */
  marketTitle: string;
  /** Entry price of the proposed trade (0-1 range) */
  proposedEntryPrice: number;
  /** Direction of the proposed trade */
  proposedDirection: EdgeDirection;
  /** All open bracket positions (same asset + expiry) */
  existingBracketPositions: BracketPosition[];
}

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
