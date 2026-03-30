import { describe, it, expect } from 'vitest';
import { calculateKalshiFee, calculatePolymarketFee, calculateNetArb } from '../services/fee-calculator';

describe('Fee Calculator', () => {
  describe('calculateKalshiFee', () => {
    it('computes fee = ceil(0.07 × (1 - price) × contracts)', () => {
      // 10 contracts at 0.30: 0.07 × 0.70 × 10 = 0.49
      const fee = calculateKalshiFee(0.30, 10);
      expect(fee).toBe(0.49);
    });

    it('returns 0 for price at boundaries', () => {
      expect(calculateKalshiFee(0, 10)).toBe(0);
      expect(calculateKalshiFee(1, 10)).toBe(0);
    });

    it('fee decreases as price increases (less profit potential)', () => {
      const fee30 = calculateKalshiFee(0.30, 10);
      const fee50 = calculateKalshiFee(0.50, 10);
      const fee70 = calculateKalshiFee(0.70, 10);
      expect(fee30).toBeGreaterThan(fee50);
      expect(fee50).toBeGreaterThan(fee70);
    });

    it('fee scales with contracts', () => {
      const fee1 = calculateKalshiFee(0.50, 1);
      const fee10 = calculateKalshiFee(0.50, 10);
      expect(fee10).toBeGreaterThan(fee1);
    });
  });

  describe('calculatePolymarketFee', () => {
    it('returns ~2% taker fee', () => {
      // 10 contracts at 0.50: 0.02 × 0.50 × 10 = 0.10
      expect(calculatePolymarketFee(0.50, 10)).toBe(0.10);
    });

    it('fee scales with price and contracts', () => {
      expect(calculatePolymarketFee(0.80, 10)).toBeGreaterThan(calculatePolymarketFee(0.20, 10));
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
      // YES = 0.49, NO = 0.49 → gross spread = 0.02
      // YES fee: ceil(0.07 × 0.51 × 10) = ceil(0.357 × 100) / 100 = 0.36
      // NO fee: ceil(0.07 × 0.51 × 10) = 0.36
      // Total fees = 0.72, gross profit = 0.02 × 10 = 0.20
      const result = calculateNetArb(0.49, 0.49, 'KALSHI', 'KALSHI', 10);
      expect(result.grossSpread).toBeCloseTo(0.02, 5);
      expect(result.netProfit).toBeLessThan(0);
    });

    it('cross-platform arb with Polymarket has lower fees', () => {
      const kalshiOnly = calculateNetArb(0.40, 0.40, 'KALSHI', 'KALSHI', 10);
      const crossPlatform = calculateNetArb(0.40, 0.40, 'KALSHI', 'POLYMARKET', 10);
      expect(crossPlatform.totalFees).toBeLessThan(kalshiOnly.totalFees);
      expect(crossPlatform.netProfit).toBeGreaterThan(kalshiOnly.netProfit);
    });
  });
});
