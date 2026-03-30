/**
 * VOL-REGIME — Dynamic volatility estimator for SPEEDEX.
 *
 * Primary: Deribit DVOL (30-day forward-looking implied vol — crypto's VIX)
 * Secondary: Realized vol from Coinbase tick data (fallback + regime detection)
 *
 * Regime detection uses the relationship between short-term realized vol,
 * long-term realized vol, and Deribit implied vol to classify the current
 * volatility environment and adjust the estimate accordingly.
 *
 * Zero LLM cost — pure math.
 */
import { deribit, DVOLData } from './data-sources/deribit';
import { binanceWs } from './data-sources/binance-ws';
import { logger } from '../lib/logger';

// ── Types ──

export type VolRegime = 'COMPRESSED' | 'EXPANDING' | 'NORMAL' | 'EXHAUSTION';

export interface VolatilityEstimate {
  vol: number;                 // Annualized vol as decimal (e.g., 0.544 = 54.4%)
  regime: VolRegime;
  confidence: number;          // 0-1
  source: 'deribit' | 'realized' | 'blended';
  components: {
    deribitDVOL: number | null;     // Annualized IV % from Deribit (e.g., 54.4)
    rv5m: number | null;            // 5-min realized vol (annualized decimal)
    variancePremium: number | null; // DVOL - realized vol (percentage points)
  };
}

// ── Cache ──

interface VolCache {
  estimate: VolatilityEstimate;
  fetchedAt: number;
}

const VOL_CACHE_TTL_MS = 30_000; // 30 seconds
const volCache: Record<string, VolCache> = {};

// Track previous regime for logging transitions
const previousRegime: Record<string, VolRegime> = {};

// Track consecutive rv5m readings for EXHAUSTION detection
const rv5mHistory: Record<string, number[]> = {};
const MAX_RV_HISTORY = 6; // 6 readings × 30s = 3 minutes

// ── Public API ──

/**
 * Get the best volatility estimate for an asset.
 * Returns annualized vol as a decimal (e.g., 0.544 = 54.4%).
 *
 * This is the single function SPEEDEX should call instead of
 * `binanceWs.getVolatility(symbol, 5) ?? DEFAULT_ANNUALIZED_VOL`.
 */
export async function estimateVolatility(
  asset: 'BTC' | 'ETH' | 'SOL',
  hoursToExpiry?: number,
): Promise<VolatilityEstimate> {
  // Check cache
  const cached = volCache[asset];
  if (cached && Date.now() - cached.fetchedAt < VOL_CACHE_TTL_MS) {
    return cached.estimate;
  }

  // Gather inputs
  const [dvolData, rv5m] = await Promise.all([
    deribit.getDVOL(asset).catch(() => null),
    getRealizedVol(asset),
  ]);

  const dvol = dvolData?.dvol ?? null; // e.g., 54.4 (percentage)
  const rv5mVal = rv5m; // annualized decimal (e.g., 0.35)

  // Track rv5m for EXHAUSTION detection
  if (rv5mVal != null) {
    if (!rv5mHistory[asset]) rv5mHistory[asset] = [];
    rv5mHistory[asset].push(rv5mVal);
    if (rv5mHistory[asset].length > MAX_RV_HISTORY) rv5mHistory[asset].shift();
  }

  // Detect regime
  const regime = detectRegime(asset, dvol, rv5mVal);

  // Build estimate
  let vol: number;
  let source: 'deribit' | 'realized' | 'blended';
  let confidence: number;

  if (dvol != null) {
    const dvolDecimal = dvol / 100; // Convert percentage to decimal

    switch (regime) {
      case 'COMPRESSED':
        // Market coiling — use higher of DVOL and realized, add 20% buffer
        vol = Math.max(dvolDecimal, rv5mVal ?? dvolDecimal) * 1.2;
        confidence = 0.6;
        source = 'blended';
        break;

      case 'EXPANDING':
        // Active move — use the highest recent reading
        vol = Math.max(dvolDecimal, rv5mVal ?? dvolDecimal);
        confidence = 0.7;
        source = 'blended';
        break;

      case 'EXHAUSTION':
        // Vol declining — DVOL may be slow to adjust down
        vol = dvolDecimal * 0.85;
        confidence = 0.8;
        source = 'deribit';
        break;

      case 'NORMAL':
      default:
        // Use DVOL directly — it's the best estimate
        vol = dvolDecimal;
        confidence = 0.9;
        source = 'deribit';
        break;
    }
  } else {
    // Fallback: Deribit unavailable — use realized vol or default
    vol = rv5mVal ?? 0.57; // 57% default
    confidence = rv5mVal != null ? 0.5 : 0.3;
    source = 'realized';
  }

  // Compute variance premium
  const variancePremium = (dvol != null && rv5mVal != null)
    ? dvol - (rv5mVal * 100) // in percentage points
    : null;

  const estimate: VolatilityEstimate = {
    vol,
    regime,
    confidence,
    source,
    components: {
      deribitDVOL: dvol,
      rv5m: rv5mVal,
      variancePremium,
    },
  };

  // Log regime transitions
  if (previousRegime[asset] && previousRegime[asset] !== regime) {
    logger.info({
      asset,
      from: previousRegime[asset],
      to: regime,
      dvol: dvol?.toFixed(1) ?? 'N/A',
      rv5m: rv5mVal != null ? (rv5mVal * 100).toFixed(1) + '%' : 'N/A',
      vol: (vol * 100).toFixed(1) + '%',
    }, `[VOL-REGIME] ${asset} regime: ${previousRegime[asset]} → ${regime}`);
  }
  previousRegime[asset] = regime;

  // Cache
  volCache[asset] = { estimate, fetchedAt: Date.now() };
  return estimate;
}

// ── Regime Detection ──

function detectRegime(
  asset: string,
  dvol: number | null,    // percentage (e.g., 54.4)
  rv5m: number | null,    // annualized decimal (e.g., 0.35)
): VolRegime {
  if (rv5m == null) return 'NORMAL'; // Can't detect without realized vol

  const rv5mPct = rv5m * 100; // Convert to percentage for comparison with DVOL
  const dvolVal = dvol ?? rv5mPct; // Use rv5m as proxy if no DVOL

  // COMPRESSED: short-term vol much lower than DVOL and long-term
  if (rv5mPct < 0.5 * dvolVal) {
    return 'COMPRESSED';
  }

  // EXPANDING: short-term vol much higher than DVOL
  if (rv5mPct > 1.5 * dvolVal) {
    // Check if it's EXHAUSTION (was expanding but now declining)
    const history = rv5mHistory[asset];
    if (history && history.length >= 3) {
      const recent3 = history.slice(-3);
      const declining = recent3[0] > recent3[1] && recent3[1] > recent3[2];
      if (declining) return 'EXHAUSTION';
    }
    return 'EXPANDING';
  }

  return 'NORMAL';
}

// ── Realized Vol (from Coinbase WS price buffer) ──

function getRealizedVol(asset: string): number | null {
  // Use the existing Coinbase WS getVolatility method (5-min window)
  return binanceWs.getVolatility(asset, 5);
}

/**
 * Get all current vol estimates for dashboard display.
 */
export async function getAllVolEstimates(): Promise<Record<string, VolatilityEstimate>> {
  const [btc, eth, sol] = await Promise.all([
    estimateVolatility('BTC'),
    estimateVolatility('ETH'),
    estimateVolatility('SOL'),
  ]);
  return { BTC: btc, ETH: eth, SOL: sol };
}
