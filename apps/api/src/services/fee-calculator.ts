import { Platform } from '@apex/db';

/**
 * Kalshi fee: ceil(0.07 × contracts × price × (1 - price))
 * Applied per side (buy or sell), capped at contract value.
 */
export function calculateKalshiFee(price: number, contracts: number): number {
  if (price <= 0 || price >= 1) return 0;
  return Math.ceil(0.07 * contracts * price * (1 - price) * 100) / 100;
}

/**
 * Polymarket: generally 0 fees for most markets (fees on withdrawal only).
 */
export function calculatePolymarketFee(_price: number, _contracts: number): number {
  return 0;
}

/**
 * Calculate net arbitrage profit from buying YES on one platform and NO on another.
 */
export function calculateNetArb(
  yesPrice: number,
  noPrice: number,
  yesPlatform: Platform,
  noPlatform: Platform,
  contracts: number
): { netProfit: number; grossSpread: number; totalFees: number } {
  const grossSpread = 1 - yesPrice - noPrice;

  const yesFee = yesPlatform === 'KALSHI'
    ? calculateKalshiFee(yesPrice, contracts)
    : calculatePolymarketFee(yesPrice, contracts);

  const noFee = noPlatform === 'KALSHI'
    ? calculateKalshiFee(noPrice, contracts)
    : calculatePolymarketFee(noPrice, contracts);

  const totalFees = yesFee + noFee;
  const netProfit = (grossSpread * contracts) - totalFees;

  return { netProfit, grossSpread, totalFees };
}
