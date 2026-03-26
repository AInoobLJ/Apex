import type { Platform } from '@apex/shared';
import type { OrderRequest } from '../types';
import type { BaseExecutor } from '../executors/base';

export interface RouteDecision {
  platform: Platform;
  effectivePrice: number;  // price + fees + slippage
  fee: number;
  reasoning: string;
}

/**
 * Smart Order Router: compare execution cost across platforms before placing.
 * Considers: price, fees, available liquidity, and expected slippage.
 */
export function routeOrder(
  executors: Map<Platform, BaseExecutor>,
  request: Omit<OrderRequest, 'platform'>,
  platformPrices: { platform: Platform; price: number; liquidity: number }[],
): RouteDecision {
  if (platformPrices.length === 0) {
    return {
      platform: 'KALSHI',
      effectivePrice: request.price,
      fee: 0,
      reasoning: 'No platform data available — defaulting to KALSHI',
    };
  }

  const decisions: RouteDecision[] = [];

  for (const pp of platformPrices) {
    const executor = executors.get(pp.platform);
    if (!executor) continue;

    const fee = executor.calculateFee(Math.ceil(request.size / request.price), request.price);
    const feePerDollar = fee / request.size;

    // Slippage estimate: more slippage on thin books
    const slippageEstimate = pp.liquidity > 0
      ? Math.min(0.02, request.size / pp.liquidity * 0.1) // ~0.1% slippage per 1% of liquidity taken
      : 0.01; // default 1% slippage if unknown

    // Effective price = market price + fee impact + slippage
    const effectivePrice = request.action === 'buy'
      ? pp.price + feePerDollar + slippageEstimate
      : pp.price - feePerDollar - slippageEstimate;

    decisions.push({
      platform: pp.platform,
      effectivePrice,
      fee,
      reasoning: `${pp.platform}: price=${(pp.price * 100).toFixed(1)}¢ fee=$${fee.toFixed(3)} slippage=${(slippageEstimate * 100).toFixed(1)}% liq=$${pp.liquidity.toFixed(0)} → eff=${(effectivePrice * 100).toFixed(1)}¢`,
    });
  }

  if (decisions.length === 0) {
    return {
      platform: platformPrices[0].platform,
      effectivePrice: request.price,
      fee: 0,
      reasoning: 'No executors available — using first platform',
    };
  }

  // For buys: lowest effective price is best
  // For sells: highest effective price is best
  decisions.sort((a, b) =>
    request.action === 'buy'
      ? a.effectivePrice - b.effectivePrice
      : b.effectivePrice - a.effectivePrice
  );

  const best = decisions[0];
  const allReasons = decisions.map(d =>
    `${d.platform === best.platform ? '✓' : ' '} ${d.reasoning}`
  ).join('\n');

  return {
    ...best,
    reasoning: `Best: ${best.platform} (eff ${(best.effectivePrice * 100).toFixed(1)}¢)\n${allReasons}`,
  };
}
