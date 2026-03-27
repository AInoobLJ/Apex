import crypto from 'node:crypto';
import fs from 'node:fs';
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

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  // Current API fields (dollar strings)
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  volume_fp?: string;
  open_interest_fp?: string;
  // Legacy fields (cent integers)
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  open_interest?: number;
  // Common
  close_time: string;
  rules_primary: string;
  result: string | null;
  category: string;
}

/** Parse Kalshi market prices — handles both old (cents) and new (dollar strings) format */
function parseKalshiPrice(dollarStr?: string, centValue?: number): number {
  if (dollarStr && dollarStr !== '0.0000') return parseFloat(dollarStr);
  if (centValue && centValue > 0) return centValue / 100;
  return 0;
}

function parseKalshiVolume(fpStr?: string, legacyNum?: number): number {
  if (fpStr) return parseFloat(fpStr) || 0;
  return legacyNum ?? 0;
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor: string | null;
}

interface KalshiOrderBook {
  yes: [number, number][]; // [price, quantity]
  no: [number, number][];
}

export class KalshiClient implements PredictionMarketAdapter {
  readonly platform = 'KALSHI' as const;
  private client: AxiosInstance;
  private limiter: Bottleneck;

  constructor() {
    this.client = axios.create({
      baseURL: config.KALSHI_BASE_URL,
      timeout: 30000,
    });

    // Kalshi rate limit: ~2 req/s for paginated fetches
    this.limiter = new Bottleneck({
      reservoir: 2,
      reservoirRefreshAmount: 2,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 1,
    });
  }

  private privateKey: string | null = null;

  private getPrivateKey(): string | null {
    if (this.privateKey !== null) return this.privateKey;
    if (config.KALSHI_PRIVATE_KEY_PATH) {
      try {
        this.privateKey = fs.readFileSync(config.KALSHI_PRIVATE_KEY_PATH, 'utf-8');
        return this.privateKey;
      } catch {
        this.privateKey = '';
      }
    }
    return null;
  }

  private signRequest(method: string, path: string, timestamp: string): string {
    const message = `${timestamp}${method.toUpperCase()}/trade-api/v2${path}`;
    const pem = this.getPrivateKey();

    if (pem) {
      // RSA-PSS signing (current Kalshi API)
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(message);
      sign.end();
      return sign.sign({ key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, 'base64');
    }

    // Fallback: HMAC (legacy)
    return crypto
      .createHmac('sha256', config.KALSHI_API_SECRET)
      .update(message)
      .digest('base64');
  }

  private getAuthHeaders(method: string, path: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = this.signRequest(method, path, timestamp);
    return {
      'KALSHI-ACCESS-KEY': config.KALSHI_API_KEY,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };
  }

  // ── Raw data fetching (PredictionMarketAdapter) ──

  /**
   * Fetch resolved/settled markets from Kalshi for historical backtest.
   */
  async fetchResolvedMarkets(maxMarkets = 1000): Promise<NormalizedMarket[]> {
    const allMarkets: KalshiMarket[] = [];
    let cursor: string | null = null;
    const maxPages = Math.ceil(maxMarkets / 50);
    let pages = 0;

    do {
      const path = '/events';
      const qp: Record<string, string> = { limit: '50', status: 'closed', with_nested_markets: 'true' };
      if (cursor) qp.cursor = cursor;

      const queryString = new URLSearchParams(qp).toString();
      const fullPath = `${path}?${queryString}`;

      const start = Date.now();
      try {
        const response = await this.limiter.schedule(() =>
          this.client.get<{ events: { markets: KalshiMarket[]; category: string }[]; cursor: string | null }>(fullPath, {
            headers: this.getAuthHeaders('GET', fullPath),
          })
        );

        await logApiUsage({
          service: 'kalshi',
          endpoint: 'GET /events (resolved)',
          latencyMs: Date.now() - start,
          statusCode: response.status,
        });

        for (const event of response.data.events) {
          for (const market of event.markets) {
            market.category = event.category;
            if (market.result) allMarkets.push(market); // Only resolved
          }
        }
        cursor = response.data.cursor;
        pages++;
        if (pages >= maxPages || !cursor || allMarkets.length >= maxMarkets) break;
      } catch (err) {
        logger.error(err, 'Kalshi fetchResolvedMarkets failed');
        break;
      }
    } while (cursor);

    // Filter parlays and normalize
    return allMarkets
      .filter(m => !m.event_ticker.startsWith('KXMVE'))
      .map(m => this.normalizeMarket(this.toRawMarket(m)));
  }

  async getMarkets(params?: MarketQuery): Promise<RawMarket[]> {
    const kalshiMarkets = await this.fetchMarketsRaw(params);
    // Filter out multi-value event parlays (KXMVE*) — these are auto-generated
    // combo bets with no individual market value for analysis
    const filtered = kalshiMarkets.filter(m => !m.event_ticker.startsWith('KXMVE'));
    logger.info({ total: kalshiMarkets.length, filtered: filtered.length, parlaysSkipped: kalshiMarkets.length - filtered.length }, 'Kalshi parlay filter');
    return filtered.map(m => this.toRawMarket(m));
  }

  async getOrderbook(contractId: string): Promise<RawOrderbook> {
    // contractId is the ticker for Kalshi
    const book = await this.fetchOrderBookRaw(contractId);
    return {
      contractId,
      bids: book.yes.map(([price, qty]) => ({ price: price / 100, quantity: qty })),
      asks: book.no.map(([price, qty]) => ({ price: 1 - price / 100, quantity: qty })),
    };
  }

  // ── Normalization (PredictionMarketAdapter) ──

  normalizeMarket(raw: RawMarket): NormalizedMarket {
    const k = raw.raw as unknown as KalshiMarket;
    const category = detectCategory(raw.title, raw.description, k.category);

    const yesBid = parseKalshiPrice(k.yes_bid_dollars, k.yes_bid);
    const yesAsk = parseKalshiPrice(k.yes_ask_dollars, k.yes_ask);
    const noBid = parseKalshiPrice(k.no_bid_dollars, k.no_bid);
    const noAsk = parseKalshiPrice(k.no_ask_dollars, k.no_ask);
    const volume = parseKalshiVolume(k.volume_fp, k.volume);
    const liquidity = parseKalshiVolume(k.open_interest_fp, k.open_interest);

    return {
      platform: 'KALSHI',
      platformMarketId: raw.platformMarketId,
      title: raw.title,
      description: raw.description ?? null,
      category,
      rawPlatformCategory: k.category || null,
      status: k.result ? 'RESOLVED' : 'ACTIVE',
      resolutionText: k.rules_primary || null,
      resolutionSource: null,
      closesAt: k.close_time ? new Date(k.close_time) : null,
      volume,
      liquidity,
      resolution: k.result === 'yes' ? 'YES' : k.result === 'no' ? 'NO' : null,
      contracts: [
        {
          platformContractId: `${k.ticker}-YES`,
          outcome: 'YES',
          lastPrice: yesBid > 0 ? (yesBid + yesAsk) / 2 : null,
          bestBid: yesBid > 0 ? yesBid : null,
          bestAsk: yesAsk > 0 ? yesAsk : null,
          volume: 0,
        },
        {
          platformContractId: `${k.ticker}-NO`,
          outcome: 'NO',
          lastPrice: noBid > 0 ? (noBid + noAsk) / 2 : null,
          bestBid: noBid > 0 ? noBid : null,
          bestAsk: noAsk > 0 ? noAsk : null,
          volume: 0,
        },
      ],
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

  calculateFee(price: number, quantity: number, _side: 'buy' | 'sell'): number {
    if (price <= 0 || price >= 1) return 0;
    return Math.ceil(0.07 * quantity * price * (1 - price) * 100) / 100;
  }

  // ── Health check (PredictionMarketAdapter) ──

  async healthCheck(): Promise<boolean> {
    try {
      const path = '/markets?limit=1&status=open';
      await this.limiter.schedule(() =>
        this.client.get(path, { headers: this.getAuthHeaders('GET', path) })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Internal methods ──

  toRawMarket(m: KalshiMarket): RawMarket {
    const yesBid = parseKalshiPrice(m.yes_bid_dollars, m.yes_bid);
    const yesAsk = parseKalshiPrice(m.yes_ask_dollars, m.yes_ask);
    const noBid = parseKalshiPrice(m.no_bid_dollars, m.no_bid);
    const noAsk = parseKalshiPrice(m.no_ask_dollars, m.no_ask);

    return {
      platformMarketId: m.ticker,
      title: m.title,
      description: m.subtitle || undefined,
      resolutionText: m.rules_primary || undefined,
      closesAt: m.close_time || undefined,
      volume: parseKalshiVolume(m.volume_fp, m.volume),
      liquidity: parseKalshiVolume(m.open_interest_fp, m.open_interest),
      status: m.status,
      outcomes: [
        {
          platformContractId: `${m.ticker}-YES`,
          outcome: 'YES',
          price: yesBid > 0 ? (yesBid + yesAsk) / 2 : null,
          bestBid: yesBid > 0 ? yesBid : null,
          bestAsk: yesAsk > 0 ? yesAsk : null,
        },
        {
          platformContractId: `${m.ticker}-NO`,
          outcome: 'NO',
          price: noBid > 0 ? (noBid + noAsk) / 2 : null,
          bestBid: noBid > 0 ? noBid : null,
          bestAsk: noAsk > 0 ? noAsk : null,
        },
      ],
      raw: m as unknown as Record<string, unknown>,
    };
  }

  /** @deprecated Use getMarkets() instead — kept for backward compatibility */
  async fetchMarkets(): Promise<KalshiMarket[]> {
    return this.fetchMarketsRaw();
  }

  /** @deprecated Use getOrderbook() instead — kept for backward compatibility */
  async fetchOrderBook(ticker: string): Promise<KalshiOrderBook> {
    return this.fetchOrderBookRaw(ticker);
  }

  /**
   * Fetch crypto series markets — daily/hourly price range + threshold contracts.
   * Includes all crypto assets available on Kalshi.
   */
  async fetchCryptoSeriesMarkets(): Promise<KalshiMarket[]> {
    const CRYPTO_SERIES = ['KXBTC', 'KXETH', 'KXSOL', 'KXXRP', 'KXDOGE', 'KXBNB', 'KXHYPE'];
    const allMarkets: KalshiMarket[] = [];

    for (const series of CRYPTO_SERIES) {
      let cursor: string | null = null;
      let pages = 0;

      do {
        const path = '/events';
        const qp: Record<string, string> = {
          limit: '10',
          series_ticker: series,
          status: 'open',
          with_nested_markets: 'true',
        };
        if (cursor) qp.cursor = cursor;
        const queryString = new URLSearchParams(qp).toString();
        const fullPath = `${path}?${queryString}`;
        const start = Date.now();

        try {
          const response = await this.limiter.schedule(() =>
            this.client.get<{ events: { markets: KalshiMarket[]; category: string }[]; cursor: string | null }>(fullPath, {
              headers: this.getAuthHeaders('GET', fullPath),
            })
          );

          await logApiUsage({
            service: 'kalshi',
            endpoint: `GET /events (${series})`,
            latencyMs: Date.now() - start,
            statusCode: response.status,
          });

          for (const event of response.data.events) {
            for (const market of event.markets) {
              market.category = event.category || 'Crypto';
              allMarkets.push(market);
            }
          }
          cursor = response.data.cursor;
          pages++;
          if (pages >= 5 || !cursor) break;
        } catch (err) {
          logger.error(err, `Kalshi fetchCryptoSeries (${series}) failed`);
          break;
        }
      } while (cursor);
    }

    logger.info({ count: allMarkets.length }, 'Kalshi crypto series fetched');
    return allMarkets;
  }

  private async fetchMarketsRaw(_params?: MarketQuery): Promise<KalshiMarket[]> {
    const allMarkets: KalshiMarket[] = [];
    let cursor: string | null = null;
    const maxPages = 20;
    let pages = 0;

    // Fetch via /events API which returns real markets (not parlays)
    // and includes category metadata
    do {
      const path = '/events';
      const qp: Record<string, string> = { limit: '50', status: 'open', with_nested_markets: 'true' };
      if (cursor) qp.cursor = cursor;

      const queryString = new URLSearchParams(qp).toString();
      const fullPath = `${path}?${queryString}`;

      const start = Date.now();
      try {
        const response = await this.limiter.schedule(() =>
          this.client.get<{ events: { markets: KalshiMarket[]; category: string }[]; cursor: string | null }>(fullPath, {
            headers: this.getAuthHeaders('GET', fullPath),
          })
        );

        await logApiUsage({
          service: 'kalshi',
          endpoint: 'GET /events',
          latencyMs: Date.now() - start,
          statusCode: response.status,
        });

        for (const event of response.data.events) {
          for (const market of event.markets) {
            // Inject category from event into market for categorization
            market.category = event.category;
            allMarkets.push(market);
          }
        }
        cursor = response.data.cursor;
        pages++;
        if (pages >= maxPages || !cursor) break;
      } catch (err) {
        await logApiUsage({
          service: 'kalshi',
          endpoint: 'GET /events',
          latencyMs: Date.now() - start,
          statusCode: axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0,
        });
        logger.error(err, 'Kalshi fetchMarkets (events) failed');
        throw err;
      }
    } while (cursor);

    return allMarkets;
  }

  private async fetchOrderBookRaw(ticker: string): Promise<KalshiOrderBook> {
    const path = `/markets/${ticker}/orderbook`;
    const start = Date.now();

    try {
      const response = await this.limiter.schedule(() =>
        this.client.get<{ orderbook: KalshiOrderBook }>(path, {
          headers: this.getAuthHeaders('GET', path),
        })
      );

      await logApiUsage({
        service: 'kalshi',
        endpoint: `GET /markets/${ticker}/orderbook`,
        latencyMs: Date.now() - start,
        statusCode: response.status,
      });

      return response.data.orderbook;
    } catch (err) {
      await logApiUsage({
        service: 'kalshi',
        endpoint: `GET /markets/${ticker}/orderbook`,
        latencyMs: Date.now() - start,
        statusCode: axios.isAxiosError(err) ? (err.response?.status ?? 0) : 0,
      });
      logger.error(err, `Kalshi fetchOrderBook failed for ${ticker}`);
      throw err;
    }
  }
}

export const kalshiClient = new KalshiClient();
