/**
 * Unified fee calculators for Kalshi and Polymarket.
 *
 * Kalshi fee schedule (as of 2025):
 *   Fee per contract = min($0.07, 7% × potential_profit)
 *   Where potential_profit = $1.00 - price_paid.
 *   Since (1 - price) ≤ 1, the 7% formula always ≤ $0.07, so:
 *     fee_per_contract = 0.07 × (1 - pricePaid)
 *
 *   pricePaid is the price you actually pay:
 *     BUY_YES at market YES price p → pricePaid = p
 *     BUY_NO  at market YES price p → pricePaid = 1 - p
 *
 *   Fee applies on BOTH entry and exit, charged per-contract.
 *
 * Polymarket fee schedule:
 *   ~2% taker fee on the notional amount (price × contracts).
 *   Maker orders are generally free.
 */

// ── Kalshi ──

/**
 * Kalshi fee for a single contract.
 * @param pricePaid - price you pay per contract [0, 1]. For YES, this is the YES price.
 *                    For NO, this is (1 - yesPrice).
 * @returns fee in dollars per contract
 */
export function kalshiFeePerContract(pricePaid: number): number {
  if (pricePaid <= 0 || pricePaid >= 1) return 0;
  // min($0.07, 7% × potential profit). Since (1-price) ≤ 1, this always equals 0.07 × (1 - price).
  return 0.07 * (1 - pricePaid);
}

/**
 * Total Kalshi fee for a trade.
 * @param pricePaid - price per contract [0, 1]
 * @param contracts - number of contracts
 * @returns total fee in dollars, rounded up to nearest cent
 */
export function kalshiFee(pricePaid: number, contracts: number): number {
  if (contracts <= 0) return 0;
  const raw = kalshiFeePerContract(pricePaid) * contracts;
  // Convert to cents, round to eliminate float artifacts, then ceil.
  // Without rounding first, 7.000000000000001 cents → ceil → 8 cents (wrong).
  const rawCents = Math.round(raw * 1e8) / 1e6; // round to sub-cent precision
  return Math.ceil(rawCents) / 100;
}

/**
 * Estimated Kalshi round-trip fee rate (entry + exit) as a fraction of contract value.
 * Used by cortex for Kelly sizing when exact contract count isn't known yet.
 *
 * @param side - 'BUY_YES' or 'BUY_NO'
 * @param marketYesPrice - the YES price on the market [0, 1]
 * @param exitPrice - estimated exit YES price (defaults to same as entry for conservative estimate)
 * @returns fee rate as a decimal (e.g., 0.049 = 4.9%)
 */
export function kalshiRoundTripFeeRate(
  side: 'BUY_YES' | 'BUY_NO',
  marketYesPrice: number,
  exitPrice?: number,
): number {
  const entryPricePaid = side === 'BUY_YES' ? marketYesPrice : (1 - marketYesPrice);
  const entryFee = kalshiFeePerContract(entryPricePaid);

  // Exit: if we bought YES, we sell YES (profit = exitPrice - 0 for the buyer of our contract).
  // The exit fee is on the OTHER side of our trade — the person buying from us pays the fee,
  // but in practice Kalshi charges both sides. Conservative: use same formula.
  if (exitPrice !== undefined) {
    const exitPricePaid = side === 'BUY_YES' ? exitPrice : (1 - exitPrice);
    const exitFee = kalshiFeePerContract(exitPricePaid);
    return entryFee + exitFee;
  }

  // Default: assume exit at same price (worst-case single-side estimate)
  return entryFee;
}

// ── Polymarket ──

/**
 * Polymarket fee for a single contract.
 * ~2% taker fee on notional amount.
 * @param pricePaid - price per contract [0, 1]
 * @returns fee in dollars per contract
 */
export function polymarketFeePerContract(pricePaid: number): number {
  if (pricePaid <= 0 || pricePaid >= 1) return 0;
  return 0.02 * pricePaid;
}

/**
 * Total Polymarket fee for a trade.
 * @param pricePaid - price per contract [0, 1]
 * @param contracts - number of contracts
 * @returns total fee in dollars, rounded up to nearest cent
 */
export function polymarketFee(pricePaid: number, contracts: number): number {
  if (contracts <= 0) return 0;
  const raw = polymarketFeePerContract(pricePaid) * contracts;
  const rawCents = Math.round(raw * 1e8) / 1e6;
  return Math.ceil(rawCents) / 100;
}

/**
 * Estimated Polymarket round-trip fee rate as a fraction of contract value.
 * @param side - 'BUY_YES' or 'BUY_NO'
 * @param marketYesPrice - the YES price on the market [0, 1]
 * @returns fee rate as a decimal
 */
export function polymarketRoundTripFeeRate(
  side: 'BUY_YES' | 'BUY_NO',
  marketYesPrice: number,
): number {
  const pricePaid = side === 'BUY_YES' ? marketYesPrice : (1 - marketYesPrice);
  return polymarketFeePerContract(pricePaid);
}

// ── Platform-agnostic helpers ──

import type { Platform } from './types';

/**
 * Calculate fee for any platform.
 */
export function platformFee(platform: Platform, pricePaid: number, contracts: number): number {
  return platform === 'KALSHI'
    ? kalshiFee(pricePaid, contracts)
    : polymarketFee(pricePaid, contracts);
}

/**
 * Estimate fee rate for any platform (for sizing, before contract count is known).
 */
export function platformFeeRate(
  platform: Platform,
  side: 'BUY_YES' | 'BUY_NO',
  marketYesPrice: number,
): number {
  return platform === 'KALSHI'
    ? kalshiRoundTripFeeRate(side, marketYesPrice)
    : polymarketRoundTripFeeRate(side, marketYesPrice);
}
