/**
 * SpotBookImbalance — analyzes Binance spot order book depth.
 *
 * Ratio >1.5 = buy pressure = bullish for hourly "Up" contracts
 * Ratio <0.67 = sell pressure = bearish
 */
import axios from 'axios';
import { logger } from '../../lib/logger';
import { logApiUsage } from '../../services/api-usage-logger';

export interface BookImbalanceSignal {
  symbol: string;
  bidDepth: number;        // USD value of bids within 1% of mid
  askDepth: number;        // USD value of asks within 1% of mid
  ratio: number;           // bid/ask ratio
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  midPrice: number;
  spread: number;
}

const BINANCE_BASE = 'https://api.binance.com';

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
};

// Cache for 10 seconds — book changes fast
let cache: Record<string, { data: BookImbalanceSignal; fetchedAt: number }> = {};
const CACHE_TTL = 10_000;

/**
 * Fetch order book and calculate bid/ask imbalance.
 */
export async function getBookImbalance(symbol: string): Promise<BookImbalanceSignal | null> {
  const cached = cache[symbol];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const binanceSymbol = SYMBOL_MAP[symbol];
  if (!binanceSymbol) return null;

  const start = Date.now();

  try {
    const response = await axios.get(`${BINANCE_BASE}/api/v3/depth`, {
      params: { symbol: binanceSymbol, limit: 20 },
      timeout: 3000,
    });

    await logApiUsage({
      service: 'binance_spot',
      endpoint: 'GET /api/v3/depth',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    const { bids, asks } = response.data;
    if (!bids?.length || !asks?.length) return null;

    // Calculate mid price
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = (bestAsk - bestBid) / midPrice;

    // Calculate depth within 1% of mid
    const bidThreshold = midPrice * 0.99;
    const askThreshold = midPrice * 1.01;

    let bidDepth = 0;
    for (const [priceStr, qtyStr] of bids) {
      const price = parseFloat(priceStr);
      if (price < bidThreshold) break;
      bidDepth += price * parseFloat(qtyStr);
    }

    let askDepth = 0;
    for (const [priceStr, qtyStr] of asks) {
      const price = parseFloat(priceStr);
      if (price > askThreshold) break;
      askDepth += price * parseFloat(qtyStr);
    }

    const ratio = askDepth > 0 ? bidDepth / askDepth : 1;

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;

    if (ratio > 2.0) {
      direction = 'BULLISH';
      confidence = Math.min(0.6, (ratio - 1) * 0.2);
    } else if (ratio > 1.5) {
      direction = 'BULLISH';
      confidence = Math.min(0.4, (ratio - 1) * 0.15);
    } else if (ratio < 0.5) {
      direction = 'BEARISH';
      confidence = Math.min(0.6, (1 - ratio) * 0.2);
    } else if (ratio < 0.67) {
      direction = 'BEARISH';
      confidence = Math.min(0.4, (1 - ratio) * 0.15);
    } else {
      direction = 'NEUTRAL';
      confidence = 0;
    }

    const signal: BookImbalanceSignal = {
      symbol,
      bidDepth,
      askDepth,
      ratio,
      direction,
      confidence,
      midPrice,
      spread,
    };

    cache[symbol] = { data: signal, fetchedAt: Date.now() };
    return signal;
  } catch (err) {
    await logApiUsage({
      service: 'binance_spot',
      endpoint: 'GET /api/v3/depth',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message, symbol }, 'Binance book depth failed');
    return cached?.data ?? null;
  }
}

/**
 * Get book imbalance for all tracked assets.
 */
export async function getAllBookImbalances(): Promise<Record<string, BookImbalanceSignal>> {
  const results: Record<string, BookImbalanceSignal> = {};
  const symbols = Object.keys(SYMBOL_MAP);

  const signals = await Promise.all(symbols.map(s => getBookImbalance(s)));
  for (let i = 0; i < symbols.length; i++) {
    if (signals[i]) results[symbols[i]] = signals[i]!;
  }
  return results;
}
