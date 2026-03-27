import { Platform, MarketCategory } from './types';

// ── Raw types from platform APIs (before normalization) ──

export interface RawMarket {
  platformMarketId: string;
  title: string;
  description?: string;
  resolutionText?: string;
  resolutionSource?: string;
  closesAt?: string;
  volume?: number;
  liquidity?: number;
  outcomes: RawOutcome[];
  status: string;
  raw: Record<string, unknown>; // full platform response preserved
}

export interface RawOutcome {
  platformContractId: string;
  outcome: string;
  price: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
  volume?: number;
}

export interface RawOrderbook {
  contractId: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
}

export interface RawPricePoint {
  timestamp: string;
  price: number;
  volume: number;
}

// ── Normalized types (what goes into DB) ──

export interface NormalizedMarket {
  platform: Platform;
  platformMarketId: string;
  title: string;
  description: string | null;
  category: MarketCategory;
  rawPlatformCategory?: string | null; // Exact string from Kalshi/Polymarket API
  status: 'ACTIVE' | 'CLOSED' | 'RESOLVED' | 'SUSPENDED';
  resolutionText: string | null;
  resolutionSource: string | null;
  closesAt: Date | null;
  volume: number;
  liquidity: number;
  resolution: 'YES' | 'NO' | null;
  contracts: NormalizedContract[];
}

export interface NormalizedContract {
  platformContractId: string;
  outcome: string;
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  volume: number;
}

export interface NormalizedOrderbook {
  contractId: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  spread: number;
  midPrice: number;
  totalBidDepth: number;
  totalAskDepth: number;
}

export interface NormalizedPosition {
  platform: Platform;
  platformMarketId: string;
  direction: 'BUY_YES' | 'BUY_NO';
  quantity: number;
  avgPrice: number;
}

// ── Query types ──

export interface MarketQuery {
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface OrderParams {
  marketId: string;
  side: 'buy' | 'sell';
  outcome: string;
  price: number;
  quantity: number;
}

export interface OrderResult {
  orderId: string;
  status: 'filled' | 'partial' | 'pending' | 'rejected';
  filledQuantity: number;
  filledPrice: number;
}

// ── Adapter Interface ──

export interface PredictionMarketAdapter {
  readonly platform: Platform;

  // Market data
  getMarkets(params?: MarketQuery): Promise<RawMarket[]>;
  getOrderbook(contractId: string): Promise<RawOrderbook>;

  // Normalization
  normalizeMarket(raw: RawMarket): NormalizedMarket;
  normalizeOrderbook(raw: RawOrderbook): NormalizedOrderbook;

  // Fee calculation
  calculateFee(price: number, quantity: number, side: 'buy' | 'sell'): number;

  // Execution (optional, Phase 6)
  placeOrder?(params: OrderParams): Promise<OrderResult>;
  cancelOrder?(orderId: string): Promise<void>;
  getPositions?(): Promise<NormalizedPosition[]>;

  // Health
  healthCheck(): Promise<boolean>;
}
