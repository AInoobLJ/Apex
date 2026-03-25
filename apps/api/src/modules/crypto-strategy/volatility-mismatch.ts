/**
 * VolatilityMismatch — compares realized crypto volatility against
 * prediction market implied volatility.
 *
 * If realized vol >> implied vol: contracts are underpriced (buy both up and down)
 * If realized vol << implied vol: contracts are overpriced (sell/fade)
 */
import { binanceWs } from '../../services/data-sources/binance-ws';
import { logger } from '../../lib/logger';

export interface VolatilitySignal {
  symbol: string;
  realizedVol1h: number;   // Annualized from 1hr
  realizedVol4h: number;
  realizedVol24h: number;
  impliedVol: number;      // Derived from contract pricing
  mismatch: number;        // realized / implied ratio. >1.5 = underpriced, <0.67 = overpriced
  direction: 'UNDERPRICED' | 'OVERPRICED' | 'FAIR';
  confidence: number;
}

// Rolling price history for vol calc (stored in memory)
const priceHistory: Record<string, { price: number; ts: number }[]> = {};
const MAX_HISTORY = 86400; // ~24 hours of 1-second ticks

/**
 * Record a price point (called from Binance WS feed or poll loop).
 */
export function recordPrice(symbol: string, price: number): void {
  if (!priceHistory[symbol]) priceHistory[symbol] = [];
  priceHistory[symbol].push({ price, ts: Date.now() });

  // Prune to last 24 hours
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  priceHistory[symbol] = priceHistory[symbol].filter(p => p.ts >= cutoff);
}

/**
 * Calculate annualized realized volatility over a given window.
 */
function calculateRealizedVol(symbol: string, windowMs: number): number | null {
  const history = priceHistory[symbol];
  if (!history || history.length < 10) return null;

  const cutoff = Date.now() - windowMs;
  const relevant = history.filter(p => p.ts >= cutoff);
  if (relevant.length < 5) return null;

  // Calculate log returns
  const returns: number[] = [];
  for (let i = 1; i < relevant.length; i++) {
    if (relevant[i - 1].price > 0) {
      returns.push(Math.log(relevant[i].price / relevant[i - 1].price));
    }
  }
  if (returns.length < 3) return null;

  // Standard deviation of returns
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const stddev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(observations per year)
  // Interval between observations in ms
  const avgInterval = windowMs / returns.length;
  const intervalsPerYear = (365.25 * 24 * 60 * 60 * 1000) / avgInterval;

  return stddev * Math.sqrt(intervalsPerYear);
}

/**
 * Derive implied volatility from how aggressively up/down contracts are priced
 * relative to current price distance from strike.
 */
export function deriveImpliedVol(
  spotPrice: number,
  strike: number,
  contractPrice: number, // YES contract price (0-1)
  hoursToExpiry: number
): number {
  if (hoursToExpiry <= 0 || contractPrice <= 0.01 || contractPrice >= 0.99) return 0;

  // Invert the simplified Black-Scholes-like probability formula
  // P(S > K) ≈ N(d1) where d1 = ln(S/K) / (σ * √T)
  // Given P, solve for σ
  const moneyness = Math.log(spotPrice / strike);
  const T = hoursToExpiry / (365.25 * 24); // Time in years

  // Inverse normal CDF approximation
  const p = Math.max(0.01, Math.min(0.99, contractPrice));
  const z = inverseNormalCDF(p);

  if (Math.abs(z) < 0.001 || T <= 0) return 0;
  const impliedVol = Math.abs(moneyness / (z * Math.sqrt(T)));

  return Math.max(0, Math.min(10, impliedVol)); // Cap at 1000% annualized
}

/**
 * Analyze volatility mismatch for a crypto asset.
 */
export function analyzeVolMismatch(
  symbol: string,
  spotPrice: number,
  strike: number,
  contractPrice: number,
  hoursToExpiry: number
): VolatilitySignal | null {
  // Record current price
  recordPrice(symbol, spotPrice);

  const realizedVol1h = calculateRealizedVol(symbol, 60 * 60 * 1000);
  const realizedVol4h = calculateRealizedVol(symbol, 4 * 60 * 60 * 1000);
  const realizedVol24h = calculateRealizedVol(symbol, 24 * 60 * 60 * 1000);

  // Need at least 1h of data
  if (realizedVol1h == null) return null;

  const impliedVol = deriveImpliedVol(spotPrice, strike, contractPrice, hoursToExpiry);
  if (impliedVol <= 0) return null;

  // Use weighted average of realized vol windows
  const realizedAvg = realizedVol1h * 0.5 + (realizedVol4h ?? realizedVol1h) * 0.3 + (realizedVol24h ?? realizedVol1h) * 0.2;
  const mismatch = realizedAvg / impliedVol;

  let direction: 'UNDERPRICED' | 'OVERPRICED' | 'FAIR';
  let confidence: number;

  if (mismatch > 1.5) {
    direction = 'UNDERPRICED';
    confidence = Math.min(0.7, (mismatch - 1) * 0.3);
  } else if (mismatch < 0.67) {
    direction = 'OVERPRICED';
    confidence = Math.min(0.7, (1 - mismatch) * 0.3);
  } else {
    direction = 'FAIR';
    confidence = 0;
  }

  return {
    symbol,
    realizedVol1h,
    realizedVol4h: realizedVol4h ?? realizedVol1h,
    realizedVol24h: realizedVol24h ?? realizedVol1h,
    impliedVol,
    mismatch,
    direction,
    confidence,
  };
}

/** Rational approximation of inverse normal CDF */
function inverseNormalCDF(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  if (p < 0.5) return -inverseNormalCDF(1 - p);

  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}
