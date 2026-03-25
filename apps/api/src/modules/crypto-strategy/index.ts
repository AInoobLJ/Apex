/**
 * CRYPTEX — Composite Crypto Strategy Engine
 *
 * Combines 5 sub-signals into a single CryptoEdgeScore per hourly contract:
 *   - SPEEDEX (latency arb):      weight 0.35
 *   - SpotBookImbalance:          weight 0.25
 *   - FundingRate:                weight 0.20
 *   - VolatilityMismatch:         weight 0.10
 *   - WhaleFlow:                  weight 0.10
 *
 * Runs every 30 seconds for hourly/daily crypto contracts.
 */
import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from '../base';
import { getAllCryptoPrices } from '../../services/crypto-feed';
import { parseKalshiCryptoTicker } from '../../services/crypto-price';
import { getBookImbalance } from './spot-book-imbalance';
import { getFundingSignal } from './funding-rate';
import { analyzeVolMismatch, recordPrice } from './volatility-mismatch';
import { getWhaleFlow } from './whale-flow';
import { logger } from '../../lib/logger';

interface SubSignal {
  name: string;
  weight: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  details: Record<string, unknown>;
}

const WEIGHTS = {
  speedex: 0.35,
  bookImbalance: 0.25,
  fundingRate: 0.20,
  volMismatch: 0.10,
  whaleFlow: 0.10,
};

export class CryptexModule extends SignalModule {
  readonly moduleId = 'CRYPTEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    if (market.category !== 'CRYPTO') return null;

    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    // Parse crypto ticker for strike info
    const parsed = parseKalshiCryptoTicker(market.platformMarketId);

    // Also try to parse from title for Polymarket
    const titleParsed = !parsed ? this.parseCryptoFromTitle(market.title) : null;
    const asset = parsed?.asset || titleParsed?.symbol;
    const strike = parsed?.strike || titleParsed?.threshold;

    if (!asset) return null;

    // Get spot price
    const prices = await getAllCryptoPrices();
    const spotData = prices.find(p => p.symbol === asset);
    if (!spotData) return null;

    const spotPrice = spotData.price;

    // Record for volatility tracking
    recordPrice(asset, spotPrice);

    // Calculate hours to resolution
    const hoursToRes = market.closesAt
      ? Math.max(0, (market.closesAt.getTime() - Date.now()) / 3600000)
      : 24;

    // Collect all sub-signals in parallel
    const [bookSignal, fundingSignal, whaleSignal] = await Promise.allSettled([
      getBookImbalance(asset),
      getFundingSignal(asset),
      getWhaleFlow(asset),
    ]);

    const subSignals: SubSignal[] = [];

    // 1. SPEEDEX — latency arb from spot vs market price
    if (strike) {
      const distance = (spotPrice - strike) / strike;
      const impliedProb = clampProbability(0.5 + distance * 2);
      const divergence = Math.abs(impliedProb - marketPrice);

      if (divergence > 0.02) {
        subSignals.push({
          name: 'SPEEDEX',
          weight: WEIGHTS.speedex,
          direction: impliedProb > marketPrice ? 'BULLISH' : 'BEARISH',
          confidence: Math.min(0.7, divergence * 3),
          details: { spotPrice, strike, impliedProb, divergence },
        });
      }
    }

    // 2. SpotBookImbalance
    if (bookSignal.status === 'fulfilled' && bookSignal.value && bookSignal.value.direction !== 'NEUTRAL') {
      const bs = bookSignal.value;
      subSignals.push({
        name: 'BookImbalance',
        weight: WEIGHTS.bookImbalance,
        direction: bs.direction,
        confidence: bs.confidence,
        details: { ratio: bs.ratio, bidDepth: bs.bidDepth, askDepth: bs.askDepth },
      });
    }

    // 3. FundingRate
    if (fundingSignal.status === 'fulfilled' && fundingSignal.value && fundingSignal.value.direction !== 'NEUTRAL') {
      const fs = fundingSignal.value;
      subSignals.push({
        name: 'FundingRate',
        weight: WEIGHTS.fundingRate,
        direction: fs.direction,
        confidence: fs.confidence,
        details: { rate: fs.fundingRatePct, annualized: fs.annualizedRate },
      });
    }

    // 4. VolatilityMismatch
    if (strike) {
      const volSignal = analyzeVolMismatch(asset, spotPrice, strike, marketPrice, hoursToRes);
      if (volSignal && volSignal.direction !== 'FAIR') {
        subSignals.push({
          name: 'VolMismatch',
          weight: WEIGHTS.volMismatch,
          direction: volSignal.direction === 'UNDERPRICED' ? 'BULLISH' : 'BEARISH',
          confidence: volSignal.confidence,
          details: { realized1h: volSignal.realizedVol1h, implied: volSignal.impliedVol, mismatch: volSignal.mismatch },
        });
      }
    }

    // 5. WhaleFlow
    if (whaleSignal.status === 'fulfilled' && whaleSignal.value && whaleSignal.value.direction !== 'NEUTRAL') {
      const ws = whaleSignal.value;
      subSignals.push({
        name: 'WhaleFlow',
        weight: WEIGHTS.whaleFlow,
        direction: ws.direction,
        confidence: ws.confidence,
        details: { netFlow: ws.netFlow1h, largeTransfers: ws.largeTransfers },
      });
    }

    // Need at least 2 sub-signals for a composite
    if (subSignals.length < 2) return null;

    // Compute weighted composite score
    const { probability, confidence, reasoning } = this.computeComposite(subSignals, marketPrice);

    // Only signal if there's meaningful edge
    const edge = Math.abs(probability - marketPrice);
    if (edge < 0.03) return null;

    return this.makeSignal(
      market.id,
      probability,
      confidence,
      reasoning,
      {
        asset,
        spotPrice,
        strike,
        subSignals: subSignals.map(s => ({ name: s.name, direction: s.direction, confidence: s.confidence })),
        edgeSize: edge,
        hoursToResolution: hoursToRes,
      },
      5 // 5 min expiry — crypto signals are very short-lived
    );
  }

  private computeComposite(
    signals: SubSignal[],
    marketPrice: number
  ): { probability: number; confidence: number; reasoning: string } {
    // Weight the directional signals
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;

    for (const sig of signals) {
      const effectiveWeight = sig.weight * sig.confidence;
      if (sig.direction === 'BULLISH') {
        bullishScore += effectiveWeight;
      } else if (sig.direction === 'BEARISH') {
        bearishScore += effectiveWeight;
      }
      totalWeight += sig.weight;
    }

    // Normalize
    const netBullish = totalWeight > 0 ? (bullishScore - bearishScore) / totalWeight : 0;

    // Adjust market price by net signal strength
    // netBullish of 0.1 = shift probability up by ~5%
    const adjustment = netBullish * 0.5;
    const probability = clampProbability(marketPrice + adjustment);

    // Confidence is higher when signals agree
    const agreement = signals.every(s => s.direction === signals[0].direction) ? 1.5 : 1.0;
    const avgConfidence = signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length;
    const confidence = Math.min(0.8, avgConfidence * agreement);

    // Build reasoning
    const parts = signals.map(s => `${s.name}: ${s.direction} (${(s.confidence * 100).toFixed(0)}%)`);
    const direction = probability > marketPrice ? 'BUY YES' : 'BUY NO';
    const reasoning = `CRYPTEX composite [${direction}]: ${parts.join(', ')}. Net adjustment: ${(adjustment * 100).toFixed(1)}%.`;

    return { probability, confidence, reasoning };
  }

  private parseCryptoFromTitle(title: string): { symbol: string; threshold: number } | null {
    const match = title.match(/\b(BTC|Bitcoin|ETH|Ethereum|SOL|Solana)\b.*?(\$|USD\s*)([\d,]+(?:\.\d+)?K?)/i);
    if (!match) return null;

    const symbolMap: Record<string, string> = {
      btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL',
    };
    const symbol = symbolMap[match[1].toLowerCase()];
    if (!symbol) return null;

    let value = parseFloat(match[3].replace(/,/g, ''));
    if (match[3].endsWith('K') || match[3].endsWith('k')) value *= 1000;

    return { symbol, threshold: value };
  }
}

export const cryptexModule = new CryptexModule();
