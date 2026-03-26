import type { OrderRequest, OrderResult } from '../types';
import type { BaseExecutor } from '../executors/base';

export interface IcebergConfig {
  /** Max visible chunk size in dollars */
  chunkSize: number;
  /** Threshold to trigger iceberg splitting */
  icebergThreshold: number;
  /** Delay between chunks in ms */
  chunkDelayMs: number;
}

export const DEFAULT_ICEBERG: IcebergConfig = {
  chunkSize: 10,        // $10 visible at a time
  icebergThreshold: 25, // Split orders >$25
  chunkDelayMs: 5000,   // 5 seconds between chunks
};

/**
 * Split a large order into smaller iceberg chunks.
 * Each chunk auto-fills before the next is placed.
 */
export async function executeIceberg(
  executor: BaseExecutor,
  baseRequest: OrderRequest,
  config: IcebergConfig = DEFAULT_ICEBERG,
): Promise<OrderResult> {
  // Don't iceberg small orders
  if (baseRequest.size <= config.icebergThreshold) {
    return executor.placeOrder(baseRequest);
  }

  const totalSize = baseRequest.size;
  let filledTotal = 0;
  let totalFee = 0;
  let lastOrderId = '';
  let weightedPrice = 0;
  const results: OrderResult[] = [];

  while (filledTotal < totalSize) {
    const remaining = totalSize - filledTotal;
    const chunkSize = Math.min(config.chunkSize, remaining);

    const chunkRequest: OrderRequest = {
      ...baseRequest,
      size: chunkSize,
    };

    const result = await executor.placeOrder(chunkRequest);
    results.push(result);

    if (result.status === 'FILLED' || result.status === 'PARTIAL') {
      const filled = result.filledSize ?? 0;
      filledTotal += filled;
      totalFee += result.fee;
      lastOrderId = result.orderId;
      if (result.filledPrice) {
        weightedPrice += result.filledPrice * filled;
      }
    } else {
      // Chunk failed — stop iceberg
      break;
    }

    // Wait between chunks to avoid detection and let book refresh
    if (filledTotal < totalSize) {
      await new Promise(r => setTimeout(r, config.chunkDelayMs));
    }
  }

  const avgPrice = filledTotal > 0 ? weightedPrice / filledTotal : null;

  return {
    orderId: lastOrderId,
    platform: baseRequest.platform,
    status: filledTotal >= totalSize ? 'FILLED' : filledTotal > 0 ? 'PARTIAL' : 'FAILED',
    filledPrice: avgPrice,
    filledSize: filledTotal,
    fee: totalFee,
    latencyMs: results.reduce((s, r) => s + r.latencyMs, 0),
    errorMessage: filledTotal < totalSize ? `Iceberg partially filled: ${filledTotal}/${totalSize}` : undefined,
  };
}
