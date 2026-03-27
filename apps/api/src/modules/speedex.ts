import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { getCryptoPrices, parseKalshiCryptoTicker, calculateSpotImpliedProb, calculateBracketImpliedProb } from '../services/crypto-price';
import { logger } from '../lib/logger';

/**
 * SPEEDEX: Detects mispricing between crypto spot prices and Kalshi contract prices.
 *
 * Handles both contract types:
 * - BRACKET: "Will BTC be between $69,000-$69,500?" → P(bracket) = N(d_upper) - N(d_lower)
 * - FLOOR: "Will BTC be above $69,000?" → P(above) = N(d)
 *
 * Uses Black-Scholes-style model with realized volatility. Zero LLM calls.
 * Most Kalshi crypto contracts are BRACKET (~97%), so bracket math is critical.
 */
export class SpeedexModule extends SignalModule {
  readonly moduleId = 'SPEEDEX' as const;
  private _hasLoggedExample = false;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    if (market.category !== 'CRYPTO') return null;
    if (market.platform !== 'KALSHI') return null;

    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;

    // Parse the Kalshi ticker to get contract type, strike, and bracket width
    const platformContractId = (yesContract as any).platformContractId || '';
    const parsed = parseKalshiCryptoTicker(platformContractId);
    if (!parsed) return null;

    // Get current spot price
    const prices = await getCryptoPrices();
    const spotData = prices[parsed.asset];
    if (!spotData) return null;
    const spotPrice = spotData.price;

    // Calculate hours to resolution
    const hoursToResolution = market.closesAt
      ? (new Date(market.closesAt).getTime() - Date.now()) / 3600000
      : 0;
    if (hoursToResolution <= 0 || hoursToResolution > 24) return null;

    // Calculate implied probability from spot price + realized vol
    let impliedProb: number;
    let contractDesc: string;

    if (parsed.contractType === 'BRACKET') {
      impliedProb = calculateBracketImpliedProb(spotPrice, parsed.strike, parsed.bracketWidth, hoursToResolution);
      contractDesc = `BRACKET $${parsed.strike.toLocaleString()}-$${(parsed.strike + parsed.bracketWidth).toLocaleString()}`;
    } else if (parsed.contractType === 'FLOOR') {
      impliedProb = calculateSpotImpliedProb(spotPrice, parsed.strike, hoursToResolution);
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
      const hourlyVol = 0.006;
      const sigma = hourlyVol * Math.sqrt(Math.max(hoursToResolution, 1/60));
      logger.info({
        validation: 'SPEEDEX_VOL_MODEL',
        asset: parsed.asset,
        spotPrice,
        contractType: parsed.contractType,
        bracketLow: parsed.strike,
        bracketHigh: parsed.strike + parsed.bracketWidth,
        bracketWidth: parsed.bracketWidth,
        hoursToExpiry: parseFloat(hoursToResolution.toFixed(2)),
        hourlyVol: hourlyVol,
        periodSigma: parseFloat(sigma.toFixed(6)),
        modelProbability: parseFloat(impliedProb.toFixed(4)),
        marketPrice: parseFloat(marketPrice.toFixed(4)),
        calculatedEdge: parseFloat((impliedProb - marketPrice).toFixed(4)),
        absEdge: parseFloat(absDivergence.toFixed(4)),
        feeEstimate: parseFloat((0.07 * marketPrice * (1 - marketPrice)).toFixed(4)),
      }, 'SPEEDEX vol model validation example');
    }

    // Minimum edge threshold: must exceed Kalshi fees by 1.5x
    const feeEstimate = 0.07 * marketPrice * (1 - marketPrice);
    if (absDivergence < feeEstimate * 1.5) return null;

    // Minimum 3% absolute divergence
    if (absDivergence < 0.03) return null;

    // Confidence: higher for larger divergence and shorter time to expiry
    const timeBoost = hoursToResolution < 1 ? 1.5 : hoursToResolution < 4 ? 1.2 : 1.0;
    const confidence = clampProbability(Math.min(0.70, absDivergence * 3 * timeBoost));

    const direction = divergence > 0 ? 'underpriced (BUY YES)' : 'overpriced (BUY NO)';

    return this.makeSignal(
      market.id,
      clampProbability(impliedProb),
      confidence,
      `SPEEDEX: ${parsed.asset} spot $${spotPrice.toLocaleString()} | ${contractDesc} | ${hoursToResolution.toFixed(1)}h to expiry. Market ${(marketPrice * 100).toFixed(1)}¢ vs vol-implied ${(impliedProb * 100).toFixed(1)}¢. Edge: ${(absDivergence * 100).toFixed(1)}% — ${direction}.`,
      {
        symbol: parsed.asset,
        spotPrice,
        strike: parsed.strike,
        contractType: parsed.contractType,
        bracketWidth: parsed.bracketWidth,
        hoursToResolution,
        impliedProb,
        marketPrice,
        divergence,
        feeEstimate,
        moneyness: absDivergence < 0.10 ? 'ATM' : divergence > 0 ? 'OTM' : 'ITM',
      },
      5 // 5 min expiry — crypto pricing signals decay fast
    );
  }
}

export const speedexModule = new SpeedexModule();
