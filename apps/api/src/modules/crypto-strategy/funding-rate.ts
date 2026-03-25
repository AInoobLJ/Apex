/**
 * FundingRateSignal — fetches Binance perpetual futures funding rate.
 *
 * Positive funding (>0.05%) = longs overcrowded = bearish for hourly "Up" contracts
 * Negative funding (<-0.05%) = shorts overcrowded = bullish for hourly "Up" contracts
 * Extreme funding (>0.1% or <-0.1%) = high confidence mean reversion signal
 */
import axios from 'axios';
import { logger } from '../../lib/logger';
import { logApiUsage } from '../../services/api-usage-logger';

export interface FundingSignal {
  symbol: string;
  fundingRate: number;       // Current 8-hour funding rate (e.g., 0.0001 = 0.01%)
  fundingRatePct: number;    // As percentage
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  annualizedRate: number;    // Annualized funding rate
}

interface FundingRateResponse {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
}

// Cache for 5 minutes — funding rate updates every 8 hours but we want fresh data
let cache: Record<string, { data: FundingSignal; fetchedAt: number }> = {};
const CACHE_TTL = 5 * 60 * 1000;

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
};

/**
 * Fetch current funding rate for a crypto asset.
 */
export async function getFundingSignal(symbol: string): Promise<FundingSignal | null> {
  const cached = cache[symbol];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const binanceSymbol = SYMBOL_MAP[symbol];
  if (!binanceSymbol) return null;

  const start = Date.now();

  try {
    const response = await axios.get<FundingRateResponse[]>(
      `${BINANCE_FUTURES_BASE}/fapi/v1/fundingRate`,
      {
        params: { symbol: binanceSymbol, limit: 1 },
        timeout: 5000,
      }
    );

    await logApiUsage({
      service: 'binance_futures',
      endpoint: 'GET /fapi/v1/fundingRate',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    if (!response.data?.[0]) return null;

    const rate = parseFloat(response.data[0].fundingRate);
    const ratePct = rate * 100;
    const annualized = rate * 3 * 365; // 3 funding periods per day

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;

    if (rate > 0.001) {
      // Extreme positive — longs very overcrowded — strong bearish signal
      direction = 'BEARISH';
      confidence = Math.min(0.7, rate * 500);
    } else if (rate > 0.0005) {
      // Moderately positive — longs overcrowded
      direction = 'BEARISH';
      confidence = Math.min(0.5, rate * 300);
    } else if (rate < -0.001) {
      // Extreme negative — shorts very overcrowded — strong bullish signal
      direction = 'BULLISH';
      confidence = Math.min(0.7, Math.abs(rate) * 500);
    } else if (rate < -0.0005) {
      // Moderately negative — shorts overcrowded
      direction = 'BULLISH';
      confidence = Math.min(0.5, Math.abs(rate) * 300);
    } else {
      direction = 'NEUTRAL';
      confidence = 0;
    }

    const signal: FundingSignal = {
      symbol,
      fundingRate: rate,
      fundingRatePct: ratePct,
      direction,
      confidence,
      annualizedRate: annualized,
    };

    cache[symbol] = { data: signal, fetchedAt: Date.now() };
    return signal;
  } catch (err) {
    await logApiUsage({
      service: 'binance_futures',
      endpoint: 'GET /fapi/v1/fundingRate',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message, symbol }, 'Binance funding rate fetch failed');
    return cached?.data ?? null;
  }
}

/**
 * Get funding rates for all tracked assets.
 */
export async function getAllFundingSignals(): Promise<Record<string, FundingSignal>> {
  const results: Record<string, FundingSignal> = {};
  const symbols = Object.keys(SYMBOL_MAP);

  const signals = await Promise.all(symbols.map(s => getFundingSignal(s)));
  for (let i = 0; i < symbols.length; i++) {
    if (signals[i]) results[symbols[i]] = signals[i]!;
  }
  return results;
}
