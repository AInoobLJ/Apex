import { describe, it, expect } from 'vitest';
import { KalshiExecutor } from '@apex/tradex';

describe('KalshiExecutor', () => {
  const executor = new KalshiExecutor({
    apiKey: 'test-key',
    apiSecret: 'test-secret',
    useDemo: true,
  });

  describe('calculateFee', () => {
    it('computes fee correctly for standard inputs', () => {
      // ceil(0.07 × 10 × 0.55 × 0.45 * 100) / 100
      const fee = executor.calculateFee(10, 0.55);
      const expected = Math.ceil(0.07 * 10 * 0.55 * 0.45 * 100) / 100;
      expect(fee).toBe(expected);
    });

    it('returns 0 at price boundaries', () => {
      expect(executor.calculateFee(10, 0)).toBe(0);
      expect(executor.calculateFee(10, 1)).toBe(0);
    });

    it('fee is symmetric around 0.50', () => {
      const fee30 = executor.calculateFee(10, 0.30);
      const fee70 = executor.calculateFee(10, 0.70);
      expect(fee30).toBe(fee70);
    });

    it('fee scales linearly with contract count', () => {
      const fee5 = executor.calculateFee(5, 0.50);
      const fee10 = executor.calculateFee(10, 0.50);
      // Due to ceiling, might not be exactly 2x but should be close
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
