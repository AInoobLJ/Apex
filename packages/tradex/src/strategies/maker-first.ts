import type { OrderRequest, OrderResult } from '../types';
import type { BaseExecutor } from '../executors/base';

export interface MakerFirstConfig {
  /** Cents below best bid (for buys) or above best ask (for sells) */
  offsetCents: number;
  /** Cancel if not filled within this many ms */
  ttlMs: number;
  /** If not filled, reprice closer to market */
  repriceOnExpiry: boolean;
  /** Max reprice attempts */
  maxRepriceAttempts: number;
}

export const DEFAULT_MAKER_FIRST: MakerFirstConfig = {
  offsetCents: 0.02,   // 2¢ inside the spread
  ttlMs: 30 * 60 * 1000, // 30 minutes
  repriceOnExpiry: true,
  maxRepriceAttempts: 2,
};

/**
 * MakerFirst strategy: place limit orders inside the spread instead of taking.
 * Lower fees (zero on Polymarket maker), better fills, but might not fill.
 */
export async function executeMakerFirst(
  executor: BaseExecutor,
  baseRequest: OrderRequest,
  config: MakerFirstConfig = DEFAULT_MAKER_FIRST,
): Promise<OrderResult> {
  // Adjust price to be maker-friendly
  const makerPrice = baseRequest.action === 'buy'
    ? Math.max(0.01, baseRequest.price - config.offsetCents) // Buy below bid
    : Math.min(0.99, baseRequest.price + config.offsetCents); // Sell above ask

  const request: OrderRequest = {
    ...baseRequest,
    type: 'limit',
    price: Math.round(makerPrice * 100) / 100, // Round to cents
  };

  let result = await executor.placeOrder(request);
  let attempts = 0;

  // Wait for fill or timeout
  if (result.status === 'PENDING' && config.ttlMs > 0) {
    const deadline = Date.now() + config.ttlMs;

    while (Date.now() < deadline && result.status === 'PENDING') {
      // Check every 30 seconds
      await new Promise(r => setTimeout(r, 30000));

      // In demo mode, simulate fill probability
      if (executor.isDemoMode) {
        const elapsed = Date.now() - (deadline - config.ttlMs);
        const fillProb = Math.min(0.8, elapsed / config.ttlMs);
        if (Math.random() < fillProb) {
          result = {
            ...result,
            status: 'FILLED',
            filledPrice: request.price,
            filledSize: request.size,
          };
          break;
        }
      }
    }

    // Reprice if not filled and configured
    if (result.status === 'PENDING' && config.repriceOnExpiry && attempts < config.maxRepriceAttempts) {
      attempts++;
      // Cancel existing order
      if (result.orderId) {
        try { await executor.cancelOrder(result.orderId); } catch { /* best effort */ }
      }

      // Reprice closer to market (halve the offset)
      const repriceConfig = { ...config, offsetCents: config.offsetCents / 2, repriceOnExpiry: attempts < config.maxRepriceAttempts };
      return executeMakerFirst(executor, baseRequest, repriceConfig);
    }

    // Cancel if still pending after TTL
    if (result.status === 'PENDING' && result.orderId) {
      try { await executor.cancelOrder(result.orderId); } catch { /* best effort */ }
      result = { ...result, status: 'EXPIRED' };
    }
  }

  return result;
}
