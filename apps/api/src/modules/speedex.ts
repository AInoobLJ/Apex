import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { getAllCryptoPrices } from '../services/crypto-feed';
import { logger } from '../lib/logger';

/**
 * SPEEDEX: Detects latency between crypto spot prices and prediction market repricing.
 * When crypto moves but the prediction market hasn't repriced yet (2-15s lag typical),
 * SPEEDEX identifies the edge.
 */
export class SpeedexModule extends SignalModule {
  readonly moduleId = 'SPEEDEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    // Only analyze crypto-related markets
    if (market.category !== 'CRYPTO') return null;

    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;

    // Check if this is a price threshold market (e.g., "BTC > $100K")
    const threshold = this.parseThreshold(market.title);
    if (!threshold) return null;

    // Get current crypto price
    const prices = await getAllCryptoPrices();
    const cryptoPrice = prices.find(p => p.symbol === threshold.symbol);
    if (!cryptoPrice) return null;

    // Calculate distance from strike — only analyze near-the-money contracts (within 3%)
    const distanceFromStrike = Math.abs(cryptoPrice.price - threshold.value) / cryptoPrice.price;
    if (distanceFromStrike > 0.03) return null; // Skip deep ITM/OTM — correctly priced, no edge

    const distance = (cryptoPrice.price - threshold.value) / threshold.value;
    const impliedDirection = distance > 0 ? 'above' : 'below';

    // For near-the-money: probability tracks closely with spot/strike distance
    let impliedProb: number;
    if (threshold.above) {
      impliedProb = clampProbability(0.5 + distance * 2);
    } else {
      impliedProb = clampProbability(0.5 - distance * 2);
    }

    const divergence = Math.abs(impliedProb - yesContract.lastPrice);
    if (divergence < 0.03) return null; // Not enough divergence after near-ATM filter

    // Fee check: edge must exceed Kalshi fee (~7% of price*(1-price))
    const feeEstimate = 0.07 * yesContract.lastPrice * (1 - yesContract.lastPrice);
    if (divergence < feeEstimate * 1.5) return null; // Edge doesn't survive fees

    return this.makeSignal(
      market.id,
      impliedProb,
      Math.min(0.6, divergence * 3),
      `SPEEDEX: ${threshold.symbol} spot $${cryptoPrice.price.toLocaleString()} is ${(distanceFromStrike * 100).toFixed(1)}% from $${threshold.value.toLocaleString()} strike. Market ${(yesContract.lastPrice * 100).toFixed(1)}¢ vs implied ${(impliedProb * 100).toFixed(1)}%. Edge: ${(divergence * 100).toFixed(1)}% after fees.`,
      {
        symbol: threshold.symbol,
        spotPrice: cryptoPrice.price,
        threshold: threshold.value,
        divergence,
        distanceFromStrike,
        impliedDirection,
        moneyness: 'ATM',
      },
      5 // 5 min expiry — ATM latency signals decay very fast
    );
  }

  private parseThreshold(title: string): { symbol: 'BTC' | 'ETH' | 'SOL'; value: number; above: boolean } | null {
    const match = title.match(/\b(BTC|Bitcoin|ETH|Ethereum|SOL|Solana)\b.*?(\$|USD\s*)([\d,]+(?:\.\d+)?K?)/i);
    if (!match) return null;

    const symbolMap: Record<string, 'BTC' | 'ETH' | 'SOL'> = {
      btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL',
    };
    const symbol = symbolMap[match[1].toLowerCase()];
    if (!symbol) return null;

    let value = parseFloat(match[3].replace(/,/g, ''));
    if (match[3].endsWith('K') || match[3].endsWith('k')) value *= 1000;

    const above = /above|over|exceed|reach|hit/i.test(title);

    return { symbol, value, above };
  }
}

export const speedexModule = new SpeedexModule();
