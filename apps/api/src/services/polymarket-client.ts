import axios, { AxiosInstance } from 'axios';
import Bottleneck from 'bottleneck';
import { config } from '../config';
import { logApiUsage } from './api-usage-logger';
import { logger } from '../lib/logger';
import { detectCategory } from './category-detector';
import type {
  PredictionMarketAdapter,
  RawMarket,
  RawOrderbook,
  NormalizedMarket,
  NormalizedOrderbook,
  MarketQuery,
} from '@apex/shared';

// ── Gamma API Types (market metadata) ──
export interface PolymarketGammaMarket {
  id: string;
  conditionId: string;
  question: string;
  description: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  volume: number | string;
  outcomes: string;        // JSON string: '["Yes","No"]'
  outcomePrices: string;   // JSON string: '["0.55","0.45"]'
  clobTokenIds: string;    // JSON string: '["token1","token2"]'
  bestBid: number;
  bestAsk: number;
  liquidity: number | string;
  liquidityNum?: number;
  category?: string;       // Platform category (e.g., "Sports", "Crypto", "US-current-affairs")
  // Legacy fields (may or may not exist)
  tokens?: PolymarketToken[];
}

export interface PolymarketToken {
  token_id: string;
  outcome: string;
  price: number;
}

/** Parse Gamma response into token objects */
function parseGammaTokens(market: PolymarketGammaMarket): PolymarketToken[] {
  // If tokens array exists (old API), use it
  if (market.tokens && Array.isArray(market.tokens) && market.tokens.length > 0) {
    return market.tokens;
  }

  // Parse from string fields (current API)
  try {
    const outcomes: string[] = JSON.parse(market.outcomes || '[]');
    const prices: string[] = JSON.parse(market.outcomePrices || '[]');
    const tokenIds: string[] = JSON.parse(market.clobTokenIds || '[]');

    return outcomes.map((outcome, i) => ({
      token_id: tokenIds[i] || `${market.conditionId}-${outcome}`,
      outcome,
      price: parseFloat(prices[i] || '0'),
    }));
  } catch {
    return [];
  }
}

// ── CLOB API Types (order book) ──
export interface PolymarketOrderBook {
  market: string;
  asset_id: string;
  bids: PolymarketOrderLevel[];
  asks: PolymarketOrderLevel[];
}

export interface PolymarketOrderLevel {
  price: string;
  size: string;
}

export class PolymarketClient implements PredictionMarketAdapter {
  readonly platform = 'POLYMARKET' as const;
  private gammaClient: AxiosInstance;
  private clobClient: AxiosInstance;
  private gammaLimiter: Bottleneck;
  private clobLimiter: Bottleneck;
  private breaker: any; // circuit breaker

  constructor() {
    const { polymarketBreaker } = require('../lib/circuit-breaker');
    this.breaker = polymarketBreaker;
    this.gammaClient = axios.create({
      baseURL: config.POLYMARKET_GAMMA_URL,
      timeout: 30000,
    });

    this.clobClient = axios.create({
      baseURL: config.POLYMARKET_CLOB_URL,
      timeout: 30000,
      headers: config.POLYMARKET_API_KEY
        ? { Authorization: `Bearer ${config.POLYMARKET_API_KEY}` }
        : {},
    });

    // Gamma: 60 req/min
    this.gammaLimiter = new Bottleneck({
      reservoir: 60,
      reservoirRefreshAmount: 60,
      reservoirRefreshInterval: 60000,
      maxConcurrent: 3,
    });

    // CLOB: 100 req/min
    this.clobLimiter = new Bottleneck({
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 60000,
      maxConcurrent: 5,
    });
  }

  // ── Raw data fetching (PredictionMarketAdapter) ──

  async getMarkets(params?: MarketQuery): Promise<RawMarket[]> {
    const gammaMarkets = await this.fetchMarketsRaw(params);
    return gammaMarkets.map(m => this.toRawMarket(m));
  }

  async getOrderbook(contractId: string): Promise<RawOrderbook> {
    const book = await this.fetchOrderBookRaw(contractId);
    return {
      contractId,
      bids: book.bids.map(l => ({ price: parseFloat(l.price), quantity: parseFloat(l.size) })),
      asks: book.asks.map(l => ({ price: parseFloat(l.price), quantity: parseFloat(l.size) })),
    };
  }

  // ── Normalization (PredictionMarketAdapter) ──

  normalizeMarket(raw: RawMarket): NormalizedMarket {
    const gamma = raw.raw as unknown as PolymarketGammaMarket;
    const category = detectCategory(raw.title, raw.description, gamma.category);
    const tokens = parseGammaTokens(gamma);

    return {
      platform: 'POLYMARKET',
      platformMarketId: gamma.conditionId,
      title: gamma.question,
      description: gamma.description || null,
      category,
      rawPlatformCategory: gamma.category || null,
      status: gamma.active ? 'ACTIVE' : gamma.closed ? 'CLOSED' : 'SUSPENDED',
      resolutionText: null,
      resolutionSource: null,
      closesAt: gamma.endDate ? new Date(gamma.endDate) : null,
      volume: typeof gamma.volume === 'string' ? parseFloat(gamma.volume) || 0 : gamma.volume ?? 0,
      liquidity: parseFloat(String(gamma.liquidityNum ?? gamma.liquidity ?? 0)) || 0,
      resolution: null,
      contracts: tokens.map(t => ({
        platformContractId: t.token_id,
        outcome: t.outcome.toUpperCase(),
        lastPrice: t.price,
        bestBid: null,
        bestAsk: null,
        volume: 0,
      })),
    };
  }

  normalizeOrderbook(raw: RawOrderbook): NormalizedOrderbook {
    const bestBid = raw.bids.length > 0 ? Math.max(...raw.bids.map(b => b.price)) : 0;
    const bestAsk = raw.asks.length > 0 ? Math.min(...raw.asks.map(a => a.price)) : 1;
    const totalBidDepth = raw.bids.reduce((s, b) => s + b.quantity * b.price, 0);
    const totalAskDepth = raw.asks.reduce((s, a) => s + a.quantity * a.price, 0);

    return {
      contractId: raw.contractId,
      bids: raw.bids,
      asks: raw.asks,
      spread: bestAsk - bestBid,
      midPrice: (bestBid + bestAsk) / 2,
      totalBidDepth,
      totalAskDepth,
    };
  }

  // ── Fee calculation (PredictionMarketAdapter) ──

  calculateFee(_price: number, _quantity: number, _side: 'buy' | 'sell'): number {
    return 0; // Polymarket generally 0 fees for most markets
  }

  // ── Health check (PredictionMarketAdapter) ──

  async healthCheck(): Promise<boolean> {
    try {
      await this.gammaLimiter.schedule(() =>
        this.gammaClient.get('/markets', { params: { limit: '1', active: 'true' } })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Internal methods ──

  private toRawMarket(m: PolymarketGammaMarket): RawMarket {
    const tokens = parseGammaTokens(m);
    return {
      platformMarketId: m.conditionId,
      title: m.question,
      description: m.description || undefined,
      closesAt: m.endDate || undefined,
      volume: typeof m.volume === 'string' ? parseFloat(m.volume) || 0 : m.volume ?? 0,
      status: m.active ? 'active' : m.closed ? 'closed' : 'suspended',
      outcomes: tokens.map(t => ({
        platformContractId: t.token_id,
        outcome: t.outcome.toUpperCase(),
        price: t.price,
      })),
      raw: m as unknown as Record<string, unknown>,
    };
  }

  /** @deprecated Use getMarkets() instead — kept for backward compatibility */
  async fetchMarkets(): Promise<PolymarketGammaMarket[]> {
    return this.fetchMarketsRaw();
  }

  /** @deprecated Use getOrderbook() instead — kept for backward compatibility */
  async fetchOrderBook(tokenId: string): Promise<PolymarketOrderBook> {
    return this.fetchOrderBookRaw(tokenId);
  }

  /**
   * Fetch resolved/closed markets from Gamma API for historical backtest.
   * Returns markets with final prices (YES=1.0/0.0 indicate resolution).
   */
  async fetchResolvedMarkets(maxMarkets = 2000): Promise<NormalizedMarket[]> {
    const allMarkets: PolymarketGammaMarket[] = [];
    let offset = 0;
    const pageSize = 100;
    const maxPages = Math.ceil(maxMarkets / pageSize);
    let pages = 0;

    do {
      const params: Record<string, string> = {
        active: 'false',
        closed: 'true',
        limit: String(pageSize),
        offset: String(offset),
      };

      const start = Date.now();
      try {
        const response = await this.breaker.execute(() =>
          this.gammaLimiter.schedule(() =>
            this.gammaClient.get<PolymarketGammaMarket[]>('/markets', { params })
          )
        );

        await logApiUsage({
          service: 'polymarket',
          endpoint: 'GET /markets (gamma, resolved)',
          latencyMs: Date.now() - start,
          statusCode: response.status,
        });

        const markets = response.data;
        if (!Array.isArray(markets) || markets.length === 0) break;
        allMarkets.push(...markets);
        offset += markets.length;
        pages++;
        if (markets.length < pageSize || pages >= maxPages) break;
      } catch (err) {
        logger.error(err, 'Polymarket Gamma fetchResolvedMarkets failed');
        break; // Don't throw — return what we have
      }
    } while (true);

    // Normalize and detect resolution from final prices
    return allMarkets.map(m => {
      const normalized = this.normalizeMarket(this.toRawMarket(m));
      normalized.status = 'RESOLVED';

      // Detect resolution from outcome prices
      const prices = parseGammaTokens(m);
      const yesToken = prices.find(t => t.outcome.toUpperCase() === 'YES');
      if (yesToken) {
        if (yesToken.price >= 0.95) normalized.resolution = 'YES';
        else if (yesToken.price <= 0.05) normalized.resolution = 'NO';
        // Markets between 0.05-0.95 may still be settling — skip
      }

      return normalized;
    }).filter(m => m.resolution !== null);
  }

  private async fetchMarketsRaw(_params?: MarketQuery): Promise<PolymarketGammaMarket[]> {
    const allMarkets: PolymarketGammaMarket[] = [];
    let offset = 0;
    const pageSize = 100;
    const maxPages = 30; // Cap at 3000 markets per fetch to avoid 30-min syncs
    let pages = 0;

    do {
      const params: Record<string, string> = {
        active: 'true',
        closed: 'false',
        limit: String(pageSize),
        offset: String(offset),
      };

      const start = Date.now();
      try {
        const response = await this.breaker.execute(() =>
          this.gammaLimiter.schedule(() =>
            this.gammaClient.get<PolymarketGammaMarket[]>('/markets', { params })
          )
        );

        await logApiUsage({
          service: 'polymarket',
          endpoint: 'GET /markets (gamma)',
          latencyMs: Date.now() - start,
          statusCode: response.status,
        });

        const markets = response.data;
        if (!Array.isArray(markets) || markets.length === 0) break;
        allMarkets.push(...markets);
        offset += markets.length;
        pages++;

        if (markets.length < pageSize || pages >= maxPages) break;
      } catch (err) {
        await logApiUsage({
          service: 'polymarket',
          endpoint: 'GET /markets (gamma)',
          latencyMs: Date.now() - start,
          statusCode: axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0,
        });
        logger.error(err, 'Polymarket Gamma fetchMarkets failed');
        throw err;
      }
    } while (true);

    return allMarkets;
  }

  private async fetchOrderBookRaw(tokenId: string): Promise<PolymarketOrderBook> {
    const start = Date.now();

    try {
      const response = await this.clobLimiter.schedule(() =>
        this.clobClient.get<PolymarketOrderBook>('/book', {
          params: { token_id: tokenId },
        })
      );

      await logApiUsage({
        service: 'polymarket',
        endpoint: 'GET /book (clob)',
        latencyMs: Date.now() - start,
        statusCode: response.status,
      });

      return response.data;
    } catch (err) {
      await logApiUsage({
        service: 'polymarket',
        endpoint: 'GET /book (clob)',
        latencyMs: Date.now() - start,
        statusCode: axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0,
      });
      logger.error(err, `Polymarket CLOB fetchOrderBook failed for ${tokenId}`);
      throw err;
    }
  }
}

export const polymarketClient = new PolymarketClient();
