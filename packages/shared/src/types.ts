// ── Module IDs ──
export const MODULE_IDS = ['COGEX', 'LEGEX', 'DOMEX', 'SIGINT', 'NEXUS', 'ALTEX', 'FLOWEX', 'REFLEX', 'ARBEX', 'SPEEDEX', 'CRYPTEX'] as const;
export type ModuleId = typeof MODULE_IDS[number];

// ── Platform & Enums ──
export type Platform = 'KALSHI' | 'POLYMARKET';
export type MarketStatus = 'ACTIVE' | 'CLOSED' | 'RESOLVED' | 'SUSPENDED';
export type MarketCategory = 'POLITICS' | 'FINANCE' | 'CRYPTO' | 'SCIENCE' | 'SPORTS' | 'CULTURE' | 'OTHER';
export type Resolution = 'YES' | 'NO' | 'AMBIGUOUS' | 'CANCELLED';
export type EdgeDirection = 'BUY_YES' | 'BUY_NO';

// ── Signal Output (all modules) ──
export interface SignalOutput {
  moduleId: ModuleId;
  marketId: string;
  probability: number;
  confidence: number;
  reasoning: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
  expiresAt: Date;
}

// ── Edge Output (CORTEX) ──
export interface EdgeOutput {
  marketId: string;
  cortexProbability: number;
  marketPrice: number;
  edgeMagnitude: number;
  edgeDirection: EdgeDirection;
  confidence: number;
  expectedValue: number;
  signals: SignalContribution[];
  kellySize: number;
  isActionable: boolean;
  conflictFlag: boolean;
  timestamp: Date;
  /** Human-readable explanation of why this edge is/isn't actionable */
  actionabilitySummary?: string;
}

export interface SignalContribution {
  moduleId: ModuleId;
  probability: number;
  confidence: number;
  weight: number;
  reasoning: string;
}

// ── Time Decay Constants ──
export const MODULE_HALF_LIVES: Record<ModuleId, number> = {
  COGEX: 30,      // minutes
  FLOWEX: 30,
  LEGEX: 360,     // 6 hours
  DOMEX: 360,
  ALTEX: 360,
  REFLEX: 360,
  SIGINT: 120,    // 2 hours
  NEXUS: 120,
  ARBEX: 15,      // arbs are time-sensitive
  SPEEDEX: 15,    // latency arbs expire fast
  CRYPTEX: 5,     // crypto strategy signals expire very fast (hourly markets)
};

// ── CORTEX Default Weights ──
export const DEFAULT_WEIGHTS: Record<ModuleId, Record<string, number>> = {
  COGEX:  { POLITICS: 0.15, FINANCE: 0.15, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  LEGEX:  { POLITICS: 0.15, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  DOMEX:  { POLITICS: 0.20, FINANCE: 0.20, CRYPTO: 0.25, SCIENCE: 0.15, OTHER: 0.15 },
  SIGINT: { POLITICS: 0.05, FINANCE: 0.10, CRYPTO: 0.15, SCIENCE: 0.05, OTHER: 0.05 },
  NEXUS:  { POLITICS: 0.10, FINANCE: 0.15, CRYPTO: 0.10, SCIENCE: 0.10, OTHER: 0.10 },
  ALTEX:  { POLITICS: 0.15, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.15 },
  FLOWEX: { POLITICS: 0.10, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.10, OTHER: 0.15 },
  REFLEX: { POLITICS: 0.10, FINANCE: 0.10, CRYPTO: 0.10, SCIENCE: 0.15, OTHER: 0.10 },
  ARBEX:  { POLITICS: 0.00, FINANCE: 0.00, CRYPTO: 0.00, SCIENCE: 0.00, OTHER: 0.00 }, // ARBEX produces arb signals, not probability — zero weight in CORTEX synthesis
  SPEEDEX:{ POLITICS: 0.00, FINANCE: 0.00, CRYPTO: 0.00, SCIENCE: 0.00, OTHER: 0.00 }, // SPEEDEX produces latency signals — zero weight in CORTEX synthesis
  CRYPTEX: { POLITICS: 0.00, FINANCE: 0.00, CRYPTO: 0.00, SCIENCE: 0.00, OTHER: 0.00 }, // CRYPTEX produces composite crypto signals — standalone, not in CORTEX
};

// ── Alert Types ──
export type AlertType = 'NEW_EDGE' | 'SMART_MONEY_MOVE' | 'PRICE_SPIKE' | 'MODULE_FAILURE' | 'CAUSAL_INCONSISTENCY' | 'EDGE_EVAPORATION';
export type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AlertRecord {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  marketId: string | null;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  snoozedUntil: string | null;
  createdAt: string;
}

// ── WebSocket Event Types ──
export type WsEvent =
  | { event: 'edge:new'; data: EdgeOutput }
  | { event: 'edge:update'; data: EdgeOutput }
  | { event: 'edge:evaporate'; data: { marketId: string } }
  | { event: 'alert:new'; data: AlertRecord }
  | { event: 'price:update'; data: { marketId: string; yesPrice: number; change: number } }
  | { event: 'sigint:smartmove'; data: { walletAddress: string; marketId: string; direction: string; amount: number } }
  | { event: 'system:moduleStatus'; data: { moduleId: ModuleId; status: 'healthy' | 'degraded' | 'down' } };

// ── API Response Types ──
export interface MarketSummary {
  id: string;
  platform: Platform;
  title: string;
  category: MarketCategory;
  status: MarketStatus;
  yesPrice: number | null;
  noPrice: number | null;
  volume: number;
  liquidity: number;
  closesAt: string | null;
  hasEdge: boolean;
  edgeMagnitude: number | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListMarketsResponse {
  data: MarketSummary[];
  pagination: Pagination;
}

export interface ContractDetail {
  id: string;
  outcome: string;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  volume: number;
}

export interface MarketDetailResponse {
  id: string;
  platform: Platform;
  platformMarketId: string;
  title: string;
  description: string | null;
  category: MarketCategory;
  status: MarketStatus;
  resolutionText: string | null;
  resolutionSource: string | null;
  resolutionDate: string | null;
  resolution: Resolution | null;
  volume: number;
  liquidity: number;
  closesAt: string | null;
  createdAt: string;
  contracts: ContractDetail[];
  latestEdge: EdgeOutput | null;
}

export interface PriceHistoryResponse {
  marketId: string;
  points: { timestamp: string; yesPrice: number; volume: number }[];
}

export interface OrderBookResponse {
  marketId: string;
  contracts: {
    outcome: string;
    bids: { price: number; quantity: number }[];
    asks: { price: number; quantity: number }[];
    spread: number;
    midPrice: number;
    totalBidDepth: number;
    totalAskDepth: number;
    timestamp: string;
  }[];
}

export interface ListEdgesResponse {
  data: EdgeOutput[];
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    postgres: { status: 'up' | 'down'; latencyMs: number };
    redis: { status: 'up' | 'down'; latencyMs: number };
    kalshi: { status: 'up' | 'down' | 'unknown'; lastSuccessAt: string | null };
    polymarket: { status: 'up' | 'down' | 'unknown'; lastSuccessAt: string | null };
  };
  uptime: number;
}

export interface JobStatusResponse {
  queues: {
    name: string;
    active: number;
    waiting: number;
    completed: number;
    failed: number;
    delayed: number;
  }[];
}
