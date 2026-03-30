import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { getCryptoPrices, parseKalshiCryptoTicker, calculateSpotImpliedProb, calculateBracketImpliedProb } from '../services/crypto-price';
import { estimateVolatility } from '../services/volatility-estimator';
import { logger } from '../lib/logger';

/**
 * SPEEDEX: Detects mispricing between crypto spot prices and Kalshi contract prices.
 *
 * Handles both contract types:
 * - BRACKET: "Will BTC be between $69,000-$69,500?" → P(bracket) = N(d_upper) - N(d_lower)
 * - FLOOR: "Will BTC be above $69,000?" → P(above) = N(d)
 *
 * Uses Black-Scholes-style model with realized volatility from Binance.US.
 * Zero LLM calls. Most Kalshi crypto contracts are BRACKET (~97%).
 *
 * In the event-driven speed-worker, SPEEDEX is called implicitly via
 * bracket probability calculations on every tick. This module is used
 * by the BullMQ speed-pipeline for periodic batch processing.
 */
export class SpeedexModule extends SignalModule {
  readonly moduleId = 'SPEEDEX' as const;
  private _hasLoggedExample = false;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    if (market.category !== 'CRYPTO') return null;
    if (market.platform !== 'KALSHI') return null;

    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;

    // Price filter: skip extreme brackets where fee economics are prohibitive
    const yesPrice = yesContract.lastPrice;
    if (yesPrice < 0.05 || yesPrice > 0.95) return null;

    const platformContractId = (yesContract as any).platformContractId || '';
    const parsed = parseKalshiCryptoTicker(platformContractId);
    if (!parsed) return null;

    // Get spot price — prefer Binance.US WebSocket (ms latency), fall back to CoinGecko
    let spotPrice: number;
    let priceSource: 'binance_ws' | 'coingecko';

    const wsPrice = binanceWs.getLatestPrice(parsed.asset);
    if (wsPrice) {
      spotPrice = wsPrice;
      priceSource = 'binance_ws';
    } else {
      const prices = await getCryptoPrices();
      const spotData = prices[parsed.asset];
      if (!spotData) return null;
      spotPrice = spotData.price;
      priceSource = 'coingecko';
    }

    // Calculate hours to resolution
    const hoursToResolution = market.closesAt
      ? (new Date(market.closesAt).getTime() - Date.now()) / 3600000
      : 0;
    if (hoursToResolution <= 0 || hoursToResolution > 24) return null;

    // Don't trade markets < 2 minutes to expiry
    if (hoursToResolution < 2 / 60) return null;

    // VOL-REGIME: get Deribit-powered volatility estimate
    const volEst = await estimateVolatility(
      parsed.asset as 'BTC' | 'ETH' | 'SOL',
      hoursToResolution,
    );
    const volForPricing = volEst.vol; // annualized decimal

    // Calculate implied probability with regime-adjusted volatility
    let impliedProb: number;
    let contractDesc: string;

    if (parsed.contractType === 'BRACKET') {
      impliedProb = calculateBracketImpliedProb(
        spotPrice, parsed.strike, parsed.bracketWidth, hoursToResolution, volForPricing,
      );
      contractDesc = `BRACKET $${parsed.strike.toLocaleString()}-$${(parsed.strike + parsed.bracketWidth).toLocaleString()}`;
    } else if (parsed.contractType === 'FLOOR') {
      impliedProb = calculateSpotImpliedProb(spotPrice, parsed.strike, hoursToResolution, volForPricing);
      contractDesc = `FLOOR above $${parsed.strike.toLocaleString()}`;
    } else {
      return null;
    }

    const marketPrice = yesContract.lastPrice;
    const divergence = impliedProb - marketPrice;
    const absDivergence = Math.abs(divergence);

    // Vol model validation: log one complete example per worker session
    if (!this._hasLoggedExample) {
      this._hasLoggedExample = true;
      logger.info({
        validation: 'SPEEDEX_VOL_MODEL',
        asset: parsed.asset,
        spotPrice,
        priceSource,
        contractType: parsed.contractType,
        bracketLow: parsed.strike,
        bracketHigh: parsed.strike + parsed.bracketWidth,
        bracketWidth: parsed.bracketWidth,
        hoursToExpiry: parseFloat(hoursToResolution.toFixed(2)),
        vol: parseFloat((volForPricing * 100).toFixed(1)) + '%',
        volSource: volEst.source,
        volRegime: volEst.regime,
        volConfidence: volEst.confidence,
        deribitDVOL: volEst.components.deribitDVOL?.toFixed(1) ?? 'N/A',
        modelProbability: parseFloat(impliedProb.toFixed(4)),
        marketPrice: parseFloat(marketPrice.toFixed(4)),
        calculatedEdge: parseFloat((impliedProb - marketPrice).toFixed(4)),
        absEdge: parseFloat(absDivergence.toFixed(4)),
        feeEstimate: parseFloat((0.07 * marketPrice * (1 - marketPrice)).toFixed(4)),
      }, 'SPEEDEX vol model validation (VOL-REGIME powered)');
    }

    // Minimum edge threshold: must exceed Kalshi fees by 1.5x
    const feeEstimate = 0.07 * marketPrice * (1 - marketPrice);
    if (absDivergence < feeEstimate * 1.5) return null;

    // Minimum 3% absolute divergence
    if (absDivergence < 0.03) return null;

    // Confidence: higher for larger divergence, shorter time to expiry, and better vol data
    const timeBoost = hoursToResolution < 1 ? 1.5 : hoursToResolution < 4 ? 1.2 : 1.0;
    const volPenalty = volEst.confidence < 0.7 ? 0.75 : 1.0; // Reduce confidence when vol estimate is uncertain
    const confidence = clampProbability(Math.min(0.70, absDivergence * 3 * timeBoost * volPenalty));

    const direction = divergence > 0 ? 'underpriced (BUY YES)' : 'overpriced (BUY NO)';

    // Flag gamma: price near bracket edge = rapid probability change
    const nearEdge = parsed.contractType === 'BRACKET' && (
      Math.abs(spotPrice - parsed.strike) / spotPrice < 0.005 ||
      Math.abs(spotPrice - (parsed.strike + parsed.bracketWidth)) / spotPrice < 0.005
    );

    return this.makeSignal(
      market.id,
      clampProbability(impliedProb),
      confidence,
      `SPEEDEX: ${parsed.asset} spot $${spotPrice.toLocaleString()} (${priceSource}) | ${contractDesc} | ${hoursToResolution.toFixed(1)}h to expiry. Market ${(marketPrice * 100).toFixed(1)}¢ vs vol-implied ${(impliedProb * 100).toFixed(1)}¢ (vol=${(volForPricing * 100).toFixed(1)}% ${volEst.source.toUpperCase()}, ${volEst.regime}). Edge: ${(absDivergence * 100).toFixed(1)}% — ${direction}.${nearEdge ? ' ⚡ HIGH GAMMA — price near bracket edge.' : ''}`,
      {
        symbol: parsed.asset,
        spotPrice,
        priceSource,
        strike: parsed.strike,
        contractType: parsed.contractType,
        bracketWidth: parsed.bracketWidth,
        hoursToResolution,
        impliedProb,
        marketPrice,
        divergence,
        feeEstimate,
        vol: volForPricing,
        volSource: volEst.source,
        volRegime: volEst.regime,
        volConfidence: volEst.confidence,
        deribitDVOL: volEst.components.deribitDVOL,
        nearBracketEdge: nearEdge,
        moneyness: absDivergence < 0.10 ? 'ATM' : divergence > 0 ? 'OTM' : 'ITM',
      },
      5 // 5 min expiry — crypto pricing signals decay fast
    );
  }
}

export const speedexModule = new SpeedexModule();
