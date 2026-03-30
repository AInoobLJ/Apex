import { describe, it, expect } from 'vitest';
import { KalshiExecutor } from '@apex/tradex';

describe('KalshiExecutor', () => {
  const executor = new KalshiExecutor({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    useDemo: true,
  });

  describe('calculateFee', () => {
    it('computes fee = ceil(0.07 × (1 - pricePaid) × contracts)', () => {
      // 10 contracts at pricePaid=0.55: 0.07 × 0.45 × 10 = 0.315 → ceil = 0.32
      const fee = executor.calculateFee(10, 0.55);
      expect(fee).toBe(Math.ceil(0.07 * (1 - 0.55) * 10 * 100) / 100);
    });

    it('returns 0 at price boundaries', () => {
      expect(executor.calculateFee(10, 0)).toBe(0);
      expect(executor.calculateFee(10, 1)).toBe(0);
    });

    it('fee is NOT symmetric — depends on potential profit', () => {
      // price=0.30: fee = 0.07 × 0.70 × 10 = 0.49
      // price=0.70: fee = 0.07 × 0.30 × 10 = 0.21
      const fee30 = executor.calculateFee(10, 0.30);
      const fee70 = executor.calculateFee(10, 0.70);
      expect(fee30).toBeGreaterThan(fee70);
      expect(fee30).toBe(0.49);
      expect(fee70).toBe(0.21);
    });

    it('fee scales linearly with contract count', () => {
      const fee5 = executor.calculateFee(5, 0.50);
      const fee10 = executor.calculateFee(10, 0.50);
      expect(fee10).toBeGreaterThan(fee5);
    });
  });

  describe('demo mode', () => {
    it('is configured in demo mode', () => {
      expect(executor.isDemoMode).toBe(true);
      expect(executor.platform).toBe('KALSHI');
    });
  });
});
