/**
 * Fee calculator — re-exports from @apex/shared canonical fee module.
 * All fee logic lives in packages/shared/src/fees.ts.
 */
import { kalshiFee, polymarketFee, kalshiFeePerContract } from '@apex/shared';
import type { Platform } from '@apex/shared';

export { kalshiFee, polymarketFee };

/**
 * Legacy alias: calculateKalshiFee(price, contracts)
 * Note: price here is the price you pay for the contract (pricePaid).
 */
export function calculateKalshiFee(price: number, contracts: number): number {
  return kalshiFee(price, contracts);
}

/**
 * Legacy alias: calculatePolymarketFee(price, contracts)
 */
export function calculatePolymarketFee(price: number, contracts: number): number {
  return polymarketFee(price, contracts);
}

/**
 * Calculate net arbitrage profit from buying YES on one platform and NO on another.
 * For arbs: YES buyer pays yesPrice, NO buyer pays noPrice = (1 - yesPrice on that market).
 */
export function calculateNetArb(
  yesPrice: number,
  noPrice: number,
  yesPlatform: Platform,
  noPlatform: Platform,
  contracts: number
): { netProfit: number; grossSpread: number; totalFees: number } {
  const grossSpread = 1 - yesPrice - noPrice;

  // YES buyer pays yesPrice → fee based on (1 - yesPrice) potential profit
  const yesFee = yesPlatform === 'KALSHI'
    ? kalshiFee(yesPrice, contracts)
    : polymarketFee(yesPrice, contracts);

  // NO buyer pays noPrice → fee based on (1 - noPrice) potential profit
  const noFee = noPlatform === 'KALSHI'
    ? kalshiFee(noPrice, contracts)
    : polymarketFee(noPrice, contracts);

  const totalFees = yesFee + noFee;
  const netProfit = (grossSpread * contracts) - totalFees;

  return { netProfit, grossSpread, totalFees };
}
