import { describe, it, expect } from 'vitest';
import { calculateKalshiFee, calculatePolymarketFee, calculateNetArb } from '../services/fee-calculator';

describe('Fee Calculator', () => {
  describe('calculateKalshiFee', () => {
    it('computes fee for standard trade', () => {
      // ceil(0.07 × 10 × 0.55 × 0.45) = ceil(0.3465) = 0.35 (in dollars with /100 rounding)
      const fee = calculateKalshiFee(0.55, 10);
      expect(fee).toBeGreaterThan(0);
      // Manual: 0.07 * 10 * 0.55 * 0.45 = 0.3465 → ceil at cents = 0.35
      expect(fee).toBe(Math.ceil(0.07 * 10 * 0.55 * 0.45 * 100) / 100);
    });

    it('returns 0 for price at boundaries', () => {
      expect(calculateKalshiFee(0, 10)).toBe(0);
      expect(calculateKalshiFee(1, 10)).toBe(0);
    });

    it('fee is maximized at price=0.50', () => {
      const fee50 = calculateKalshiFee(0.50, 10);
      const fee30 = calculateKalshiFee(0.30, 10);
      const fee70 = calculateKalshiFee(0.70, 10);
      expect(fee50).toBeGreaterThanOrEqual(fee30);
      expect(fee50).toBeGreaterThanOrEqual(fee70);
    });

    it('fee scales with contracts', () => {
      const fee1 = calculateKalshiFee(0.50, 1);
      const fee10 = calculateKalshiFee(0.50, 10);
      expect(fee10).toBeGreaterThan(fee1);
    });
  });

  describe('calculatePolymarketFee', () => {
    it('returns 0 for all inputs', () => {
      expect(calculatePolymarketFee(0.50, 10)).toBe(0);
      expect(calculatePolymarketFee(0.99, 100)).toBe(0);
    });
  });

  describe('calculateNetArb', () => {
    it('computes positive net profit when spread exceeds fees', () => {
      // YES = 0.40, NO = 0.40 → gross spread = 0.20
      const result = calculateNetArb(0.40, 0.40, 'KALSHI', 'KALSHI', 10);
      expect(result.grossSpread).toBeCloseTo(0.20, 10);
      expect(result.netProfit).toBeGreaterThan(0);
      expect(result.totalFees).toBeGreaterThan(0);
    });

    it('computes negative net profit when fees exceed spread', () => {
      // YES = 0.49, NO = 0.49 → gross spread = 0.02, barely any room
      const result = calculateNetArb(0.49, 0.49, 'KALSHI', 'KALSHI', 10);
      expect(result.grossSpread).toBeCloseTo(0.02, 5);
      // Fees are ~ceil(0.07*10*0.49*0.51) ≈ 0.18 per side = 0.36 total, vs 0.20 gross
      expect(result.netProfit).toBeLessThan(0);
    });

    it('cross-platform arb with Polymarket has lower fees', () => {
      // Same prices, but one leg on Polymarket (0 fees)
      const kalshiOnly = calculateNetArb(0.40, 0.40, 'KALSHI', 'KALSHI', 10);
      const crossPlatform = calculateNetArb(0.40, 0.40, 'KALSHI', 'POLYMARKET', 10);
      expect(crossPlatform.totalFees).toBeLessThan(kalshiOnly.totalFees);
      expect(crossPlatform.netProfit).toBeGreaterThan(kalshiOnly.netProfit);
    });
  });
});
