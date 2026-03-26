import type { OrderRequest, OrderResult } from '../types';
import type { BaseExecutor } from '../executors/base';
import type { Platform } from '@apex/shared';

export interface MarketMakerConfig {
  /** Minimum spread in cents between bid and ask */
  minSpreadCents: number;
  /** Max exposure per market in dollars */
  maxExposure: number;
  /** Minimum daily volume to market-make on */
  minDailyVolume: number;
  /** Cancel if price moves this much from entry */
  circuitBreakerPct: number;
  /** Order size per side in dollars */
  orderSize: number;
  /** Refresh interval for quotes in ms */
  refreshIntervalMs: number;
}

export const DEFAULT_MM_CONFIG: MarketMakerConfig = {
  minSpreadCents: 0.03,      // 3¢ spread
  maxExposure: 50,            // $50 per market
  minDailyVolume: 10000,     // $10K daily volume
  circuitBreakerPct: 0.05,   // 5% move = cancel all
  orderSize: 10,             // $10 per side
  refreshIntervalMs: 60000,  // 1 minute
};

export interface MarketMakerQuotes {
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
}

/**
 * Calculate market-making quotes centered around fair value.
 * Uses FLOWEX order book imbalance to skew the spread.
 */
export function calculateQuotes(
  fairValue: number,
  config: MarketMakerConfig,
  orderBookImbalance?: number, // -1 (sell pressure) to +1 (buy pressure)
): MarketMakerQuotes {
  const halfSpread = config.minSpreadCents / 2;
  const imbalance = orderBookImbalance ?? 0;

  // Skew quotes based on order book imbalance
  // If buy pressure: tighten ask (more aggressive sell), widen bid
  // If sell pressure: tighten bid (more aggressive buy), widen ask
  const skewFactor = imbalance * halfSpread * 0.5; // Up to 50% of half-spread as skew

  const bidPrice = Math.max(0.01, Math.round((fairValue - halfSpread - skewFactor) * 100) / 100);
  const askPrice = Math.min(0.99, Math.round((fairValue + halfSpread + skewFactor) * 100) / 100);

  return {
    bidPrice,
    askPrice,
    bidSize: config.orderSize,
    askSize: config.orderSize,
  };
}

/**
 * Place market-making orders on both sides of a market.
 */
export async function placeMMOrders(
  executor: BaseExecutor,
  ticker: string,
  quotes: MarketMakerQuotes,
): Promise<{ bid: OrderResult; ask: OrderResult }> {
  const bidRequest: OrderRequest = {
    platform: executor.platform,
    ticker,
    side: 'yes',
    action: 'buy',
    type: 'limit',
    price: quotes.bidPrice,
    size: quotes.bidSize,
  };

  const askRequest: OrderRequest = {
    platform: executor.platform,
    ticker,
    side: 'yes',
    action: 'sell',
    type: 'limit',
    price: quotes.askPrice,
    size: quotes.askSize,
  };

  const [bid, ask] = await Promise.all([
    executor.placeOrder(bidRequest),
    executor.placeOrder(askRequest),
  ]);

  return { bid, ask };
}

/**
 * Check if circuit breaker should fire (price moved too much).
 */
export function shouldCancelAll(
  currentPrice: number,
  entryMidPrice: number,
  config: MarketMakerConfig,
): boolean {
  return Math.abs(currentPrice - entryMidPrice) / entryMidPrice > config.circuitBreakerPct;
}
