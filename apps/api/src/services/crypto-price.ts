import axios from 'axios';
import { logger } from '../lib/logger';
import { logApiUsage } from './api-usage-logger';

interface CryptoPrice {
  symbol: string;
  price: number;
  change24h: number;
  updatedAt: Date;
}

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
};

// Cache prices for 30 seconds (good enough for strike comparison, saves API calls)
let priceCache: Record<string, CryptoPrice> = {};
let lastFetch = 0;
const CACHE_TTL = 30_000; // 30 seconds

/**
 * Get current crypto spot prices from CoinGecko (free, no API key needed).
 * Cached for 30s to avoid rate limits (10-50 req/min on free tier).
 */
export async function getCryptoPrices(): Promise<Record<string, CryptoPrice>> {
  if (Date.now() - lastFetch < CACHE_TTL && Object.keys(priceCache).length > 0) {
    return priceCache;
  }

  const ids = Object.values(COINGECKO_IDS).join(',');
  const start = Date.now();

  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      { timeout: 10000 }
    );

    await logApiUsage({
      service: 'coingecko',
      endpoint: 'GET /simple/price',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    const now = new Date();
    priceCache = {};

    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      const data = response.data[geckoId];
      if (data) {
        priceCache[symbol] = {
          symbol,
          price: data.usd,
          change24h: data.usd_24h_change || 0,
          updatedAt: now,
        };
      }
    }

    lastFetch = Date.now();
    return priceCache;
  } catch (err) {
    await logApiUsage({
      service: 'coingecko',
      endpoint: 'GET /simple/price',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.error(err, 'CoinGecko price fetch failed');
    return priceCache; // Return stale cache on failure
  }
}

/**
 * Parse a Kalshi crypto market ticker to extract the strike price and asset.
 * Format: KXBTC-26MAR2717-B82650 → { asset: 'BTC', strike: 82650, direction: 'above' }
 * Format: KXBTC-26MAR2717-T82650 → { asset: 'BTC', strike: 82650, direction: 'below' }
 * The "B" prefix means "between" or "above", depends on the specific contract.
 */
export function parseKalshiCryptoTicker(ticker: string): {
  asset: string;
  strike: number;
  dateStr: string;
} | null {
  // KXBTC-26MAR2717-B82650
  const match = ticker.match(/KX(BTC|ETH|SOL)-(\w+)-[BT](\d+)/);
  if (!match) return null;

  return {
    asset: match[1],
    strike: parseInt(match[3]),
    dateStr: match[2],
  };
}

/**
 * Standard normal CDF using rational approximation (Abramowitz & Stegun).
 * Much more accurate than logistic approximation, especially in the tails.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate implied probability from spot price vs strike for a crypto range contract.
 *
 * Uses proper Black-Scholes-style model:
 *   d = ln(spot/strike) / (vol * sqrt(T))
 *   P(above strike at expiry) = N(d)
 *
 * Key insight: for near-expiry contracts (< 1 hour), even a small buffer
 * like $150 on BTC ($71K) is NOT 100% — BTC can move $500 in minutes.
 * The volatility and time remaining determine the real probability.
 */
export function calculateSpotImpliedProb(
  spotPrice: number,
  strike: number,
  hoursToResolution: number
): number {
  // Already expired
  if (hoursToResolution <= 0) return spotPrice >= strike ? 1 : 0;

  // Minimum time horizon to avoid division by near-zero
  const effectiveHours = Math.max(hoursToResolution, 1 / 60); // at least 1 minute

  // BTC hourly realized vol ≈ 0.6% (annualized ~57%, daily ~3%)
  // For short timeframes, vol is slightly higher due to microstructure noise
  const baseHourlyVol = 0.006; // 0.6% per hour

  // Scale vol by sqrt(time) for the relevant window
  const sigma = baseHourlyVol * Math.sqrt(effectiveHours);

  // d1 from Black-Scholes (no risk-free rate for short durations)
  const d = Math.log(spotPrice / strike) / sigma;

  // P(spot > strike at expiry) = N(d)
  const prob = normalCDF(d);

  // Clamp to avoid 0/1 extremes (always some uncertainty)
  return Math.max(0.01, Math.min(0.99, prob));
}
