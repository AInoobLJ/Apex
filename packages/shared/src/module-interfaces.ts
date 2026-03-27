/**
 * Provider interfaces for signal module dependency injection.
 *
 * Modules use these instead of importing Prisma/claude-client directly.
 * Concrete implementations live in apps/api/src/providers/.
 * Tests can use mock implementations.
 */

// ── Data types that modules operate on ──

export interface PriceSnapshotData {
  id: string;
  marketId: string;
  yesPrice: number;
  noPrice: number;
  volume?: number;
  timestamp: Date;
}

export interface OrderBookSnapshotData {
  id: string;
  contractId: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  totalBidDepth: number;
  totalAskDepth: number;
  timestamp: Date;
}

export interface ResolvedMarketData {
  id: string;
  category: string;
  resolution: string | null;
  priceSnapshots: { yesPrice: number; timestamp: Date }[];
}

// ── Market Data Provider ──

export interface MarketDataProvider {
  /** Get price snapshots for a market, going back N days */
  getPriceSnapshots(marketId: string, days: number): Promise<PriceSnapshotData[]>;

  /** Get order book snapshots for a contract */
  getOrderBookSnapshots(contractId: string, limit: number): Promise<OrderBookSnapshotData[]>;

  /** Get resolved markets in a category (for calibration/base rate calculations) */
  getResolvedMarkets(category: string, limit: number): Promise<ResolvedMarketData[]>;
}

// ── LLM Provider ──

export interface LLMCallOptions {
  task: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMCallResult<T> {
  parsed: T;
  raw: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface LLMProvider {
  call<T>(opts: LLMCallOptions): Promise<LLMCallResult<T>>;
}
