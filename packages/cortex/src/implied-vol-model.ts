/**
 * ImpliedVolModel — Black-Scholes-like pricing for crypto bracket contracts.
 *
 * Pure math, no LLM. Calculates fair value using:
 * - Current spot price
 * - Strike/bracket boundaries
 * - Time to expiry
 * - Realized volatility (from price history)
 *
 * Edge = model price - market price
 */

/**
 * Standard normal CDF approximation (Abramowitz & Stegun).
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate realized volatility from a price series.
 * Returns annualized vol.
 */
export function calculateRealizedVol(prices: number[], periodMinutes: number): number {
  if (prices.length < 3) return 0.03 * Math.sqrt(365); // Default ~57% annualized

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  if (returns.length < 2) return 0.03 * Math.sqrt(365);

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const periodVol = Math.sqrt(variance);

  // Annualize based on period length
  const periodsPerYear = (365 * 24 * 60) / periodMinutes;
  return periodVol * Math.sqrt(periodsPerYear);
}

/**
 * Price a FLOOR (above/below) contract using log-normal model.
 * P(S > K) = N(d) where d = ln(S/K) / (σ√T)
 */
export function priceFloorContract(
  spotPrice: number,
  strike: number,
  hoursToExpiry: number,
  annualizedVol: number
): number {
  if (hoursToExpiry <= 0) return spotPrice >= strike ? 1 : 0;
  if (annualizedVol <= 0) annualizedVol = 0.57; // default

  const T = hoursToExpiry / (365 * 24); // years
  const sigma = annualizedVol;
  const d = Math.log(spotPrice / strike) / (sigma * Math.sqrt(T));

  return normalCDF(d);
}

/**
 * Price a BRACKET contract: P(lower ≤ S_T ≤ upper)
 * = N(d_upper) - N(d_lower)
 */
export function priceBracketContract(
  spotPrice: number,
  lowerStrike: number,
  upperStrike: number,
  hoursToExpiry: number,
  annualizedVol: number
): number {
  if (hoursToExpiry <= 0) {
    return (spotPrice >= lowerStrike && spotPrice < upperStrike) ? 1 : 0;
  }
  if (annualizedVol <= 0) annualizedVol = 0.57;

  const T = hoursToExpiry / (365 * 24);
  const sigma = annualizedVol;
  const sqrtT = Math.sqrt(T);

  const dUpper = Math.log(spotPrice / upperStrike) / (sigma * sqrtT);
  const dLower = Math.log(spotPrice / lowerStrike) / (sigma * sqrtT);

  // P(S > lower) - P(S > upper) = P(lower ≤ S ≤ upper)
  return normalCDF(dLower) - normalCDF(dUpper);
}

export interface VolEdge {
  ticker: string;
  modelPrice: number;
  marketPrice: number;
  edge: number;              // model - market (positive = underpriced)
  realizedVol: number;
  impliedVol: number;        // backing out from market price
  volRatio: number;          // realized / implied
  hoursToExpiry: number;
  spotPrice: number;
  strike: number;
  contractType: 'FLOOR' | 'BRACKET';
}

/**
 * Scan crypto contracts for vol-mispricing edges.
 * Pure math — no API calls.
 */
export function findVolEdges(contracts: {
  ticker: string;
  marketPrice: number;
  spotPrice: number;
  strike: number;
  bracketWidth: number;
  contractType: 'FLOOR' | 'BRACKET';
  hoursToExpiry: number;
}[], recentPrices: number[], pricePeriodMinutes: number): VolEdge[] {
  const realizedVol = calculateRealizedVol(recentPrices, pricePeriodMinutes);
  const edges: VolEdge[] = [];

  for (const c of contracts) {
    if (c.marketPrice <= 0 || c.hoursToExpiry <= 0.1) continue;

    let modelPrice: number;
    if (c.contractType === 'FLOOR') {
      modelPrice = priceFloorContract(c.spotPrice, c.strike, c.hoursToExpiry, realizedVol);
    } else {
      modelPrice = priceBracketContract(
        c.spotPrice,
        c.strike,
        c.strike + c.bracketWidth,
        c.hoursToExpiry,
        realizedVol
      );
    }

    const edge = modelPrice - c.marketPrice;

    // Back out implied vol from market price (Newton's method, 5 iterations)
    let impliedVol = realizedVol;
    for (let i = 0; i < 5; i++) {
      let pAtVol: number;
      if (c.contractType === 'FLOOR') {
        pAtVol = priceFloorContract(c.spotPrice, c.strike, c.hoursToExpiry, impliedVol);
      } else {
        pAtVol = priceBracketContract(c.spotPrice, c.strike, c.strike + c.bracketWidth, c.hoursToExpiry, impliedVol);
      }
      const diff = pAtVol - c.marketPrice;
      // Numerical derivative
      const dv = 0.001;
      let pAtVolUp: number;
      if (c.contractType === 'FLOOR') {
        pAtVolUp = priceFloorContract(c.spotPrice, c.strike, c.hoursToExpiry, impliedVol + dv);
      } else {
        pAtVolUp = priceBracketContract(c.spotPrice, c.strike, c.strike + c.bracketWidth, c.hoursToExpiry, impliedVol + dv);
      }
      const vega = (pAtVolUp - pAtVol) / dv;
      if (Math.abs(vega) > 0.0001) {
        impliedVol -= diff / vega;
        impliedVol = Math.max(0.01, Math.min(5, impliedVol)); // clamp
      }
    }

    edges.push({
      ticker: c.ticker,
      modelPrice,
      marketPrice: c.marketPrice,
      edge,
      realizedVol,
      impliedVol,
      volRatio: impliedVol > 0 ? realizedVol / impliedVol : 1,
      hoursToExpiry: c.hoursToExpiry,
      spotPrice: c.spotPrice,
      strike: c.strike,
      contractType: c.contractType,
    });
  }

  // Sort by absolute edge
  edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  return edges;
}
