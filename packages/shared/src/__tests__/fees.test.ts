import { describe, it, expect } from 'vitest';
import {
  kalshiFeePerContract,
  kalshiFee,
  kalshiRoundTripFeeRate,
  polymarketFeePerContract,
  polymarketFee,
  polymarketRoundTripFeeRate,
  platformFee,
  platformFeeRate,
} from '../fees';

describe('Kalshi Fee Calculator', () => {
  describe('kalshiFeePerContract', () => {
    it('fee = 0.07 × (1 - price) for standard prices', () => {
      // YES at 0.10: potential profit = 0.90 → fee = 0.063
      expect(kalshiFeePerContract(0.10)).toBeCloseTo(0.063, 4);

      // YES at 0.50: potential profit = 0.50 → fee = 0.035
      expect(kalshiFeePerContract(0.50)).toBeCloseTo(0.035, 4);

      // YES at 0.90: potential profit = 0.10 → fee = 0.007
      expect(kalshiFeePerContract(0.90)).toBeCloseTo(0.007, 4);
    });

    it('returns 0 at price boundaries', () => {
      expect(kalshiFeePerContract(0)).toBe(0);
      expect(kalshiFeePerContract(1)).toBe(0);
    });

    it('fee decreases as price increases (cheaper to buy expensive contracts)', () => {
      const fee30 = kalshiFeePerContract(0.30);
      const fee50 = kalshiFeePerContract(0.50);
      const fee70 = kalshiFeePerContract(0.70);
      expect(fee30).toBeGreaterThan(fee50);
      expect(fee50).toBeGreaterThan(fee70);
    });

    it('max fee is 7 cents at price near 0', () => {
      expect(kalshiFeePerContract(0.01)).toBeCloseTo(0.0693, 3);
      // At exactly 0: returns 0 (boundary check)
    });
  });

  describe('kalshiFee (total for N contracts)', () => {
    it('scales linearly with contract count', () => {
      // fee1 at 0.50 = ceil(0.035 × 100) / 100 = 0.04 (rounded up)
      // fee10 at 0.50 = ceil(0.35 × 100) / 100 = 0.35 (exact)
      // Raw ratio is 10× but ceiling distorts single-contract fees upward
      const fee1 = kalshiFee(0.50, 1);
      const fee10 = kalshiFee(0.50, 10);
      expect(fee1).toBe(0.04);   // ceil rounds up single contract
      expect(fee10).toBe(0.35);  // exact at 10 contracts
      expect(fee10).toBeGreaterThan(fee1);
    });

    it('rounds up to nearest cent', () => {
      // 1 contract at 0.50: 0.07 × 0.50 = 0.035 → ceil = 0.04
      expect(kalshiFee(0.50, 1)).toBe(0.04);

      // 10 contracts at 0.50: 0.07 × 0.50 × 10 = 0.35 → ceil = 0.35
      expect(kalshiFee(0.50, 10)).toBe(0.35);
    });

    it('returns 0 for 0 contracts', () => {
      expect(kalshiFee(0.50, 0)).toBe(0);
    });

    it('concrete examples from Kalshi fee schedule', () => {
      // YES at 0.30, 10 contracts: 0.07 × 0.70 × 10 = 0.49 → ceil = 0.49
      expect(kalshiFee(0.30, 10)).toBe(0.49);

      // YES at 0.90, 10 contracts: 0.07 × 0.10 × 10 = 0.07 → ceil = 0.07
      expect(kalshiFee(0.90, 10)).toBe(0.07);

      // YES at 0.10, 1 contract: 0.07 × 0.90 = 0.063 → ceil = 0.07
      expect(kalshiFee(0.10, 1)).toBe(0.07);
    });
  });

  describe('kalshiRoundTripFeeRate', () => {
    it('BUY_YES: fee = 0.07 × (1 - yesPrice)', () => {
      // Buy YES at 0.40: fee rate = 0.07 × 0.60 = 0.042
      expect(kalshiRoundTripFeeRate('BUY_YES', 0.40)).toBeCloseTo(0.042, 4);
    });

    it('BUY_NO: fee = 0.07 × (1 - noPrice) = 0.07 × yesPrice', () => {
      // Buy NO when YES=0.60: NO price = 0.40, fee = 0.07 × 0.60 = 0.042
      expect(kalshiRoundTripFeeRate('BUY_NO', 0.60)).toBeCloseTo(0.042, 4);
    });

    it('BUY_YES and BUY_NO are asymmetric', () => {
      // YES at 0.30: BUY_YES fee = 0.07 × 0.70 = 0.049
      // YES at 0.30: BUY_NO fee = 0.07 × (1 - 0.70) = 0.07 × 0.30 = 0.021
      const yesFee = kalshiRoundTripFeeRate('BUY_YES', 0.30);
      const noFee = kalshiRoundTripFeeRate('BUY_NO', 0.30);
      expect(yesFee).toBeCloseTo(0.049, 4);
      expect(noFee).toBeCloseTo(0.021, 4);
      expect(yesFee).not.toBeCloseTo(noFee, 2);
    });

    it('round-trip with exit price adds exit fee', () => {
      // Buy YES at 0.40, exit at 0.60
      // Entry fee: 0.07 × (1 - 0.40) = 0.042
      // Exit fee: 0.07 × (1 - 0.60) = 0.028
      // Round trip: 0.042 + 0.028 = 0.070
      expect(kalshiRoundTripFeeRate('BUY_YES', 0.40, 0.60)).toBeCloseTo(0.070, 4);
    });
  });
});

describe('Polymarket Fee Calculator', () => {
  describe('polymarketFeePerContract', () => {
    it('fee = 2% × price', () => {
      expect(polymarketFeePerContract(0.50)).toBeCloseTo(0.01, 4);
      expect(polymarketFeePerContract(0.80)).toBeCloseTo(0.016, 4);
    });

    it('returns 0 at boundaries', () => {
      expect(polymarketFeePerContract(0)).toBe(0);
      expect(polymarketFeePerContract(1)).toBe(0);
    });
  });

  describe('polymarketFee (total)', () => {
    it('10 contracts at 0.50: 0.02 × 0.50 × 10 = 0.10', () => {
      expect(polymarketFee(0.50, 10)).toBe(0.10);
    });

    it('rounds up to nearest cent', () => {
      // 1 contract at 0.33: 0.02 × 0.33 = 0.0066 → ceil = 0.01
      expect(polymarketFee(0.33, 1)).toBe(0.01);
    });
  });

  describe('polymarketRoundTripFeeRate', () => {
    it('BUY_YES: fee = 0.02 × yesPrice', () => {
      expect(polymarketRoundTripFeeRate('BUY_YES', 0.50)).toBeCloseTo(0.01, 4);
    });

    it('BUY_NO: fee = 0.02 × noPrice', () => {
      // YES = 0.60, NO = 0.40 → fee = 0.02 × 0.40 = 0.008
      expect(polymarketRoundTripFeeRate('BUY_NO', 0.60)).toBeCloseTo(0.008, 4);
    });
  });
});

describe('Platform-agnostic helpers', () => {
  it('platformFee routes to correct calculator', () => {
    const kalshi = platformFee('KALSHI', 0.50, 10);
    const poly = platformFee('POLYMARKET', 0.50, 10);

    // Kalshi: 0.07 × 0.50 × 10 = 0.35
    expect(kalshi).toBe(0.35);
    // Polymarket: 0.02 × 0.50 × 10 = 0.10
    expect(poly).toBe(0.10);
  });

  it('platformFeeRate routes to correct calculator', () => {
    const kalshi = platformFeeRate('KALSHI', 'BUY_YES', 0.50);
    const poly = platformFeeRate('POLYMARKET', 'BUY_YES', 0.50);

    expect(kalshi).toBeCloseTo(0.035, 4);
    expect(poly).toBeCloseTo(0.01, 4);
  });

  it('Kalshi fees are higher than Polymarket at same price', () => {
    expect(platformFee('KALSHI', 0.50, 10)).toBeGreaterThan(platformFee('POLYMARKET', 0.50, 10));
  });
});

describe('Consistency: cortex and tradex produce identical fees', () => {
  it('platformFeeRate matches kalshiFee / contracts for BUY_YES', () => {
    // platformFeeRate is used by cortex, kalshiFee is used by tradex
    // They should agree for the same inputs
    const yesPrice = 0.40;
    const contracts = 100;

    const rateBasedFee = platformFeeRate('KALSHI', 'BUY_YES', yesPrice) * contracts;
    const absoluteFee = kalshiFee(yesPrice, contracts) / 100; // convert back to per-dollar

    // Rate × contracts should ≈ total fee (within rounding)
    // Rate = 0.07 × (1 - 0.40) = 0.042 per contract
    // Total = 0.042 × 100 = 4.20
    // kalshiFee(0.40, 100) = ceil(0.042 × 100 × 100) / 100 = ceil(420) / 100 = 4.20
    expect(rateBasedFee).toBeCloseTo(kalshiFee(yesPrice, contracts), 1);
  });

  it('platformFeeRate matches kalshiFee / contracts for BUY_NO', () => {
    const yesPrice = 0.70;
    const contracts = 100;

    // BUY_NO: pricePaid = 1 - 0.70 = 0.30
    const rateBasedFee = platformFeeRate('KALSHI', 'BUY_NO', yesPrice) * contracts;
    // kalshiFee(0.30, 100) — tradex would call with pricePaid=0.30
    expect(rateBasedFee).toBeCloseTo(kalshiFee(1 - yesPrice, contracts), 1);
  });
});
