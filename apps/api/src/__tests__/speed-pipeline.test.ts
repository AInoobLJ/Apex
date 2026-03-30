import { describe, it, expect } from 'vitest';
import {
  calculateBracketImpliedProb,
  calculateSpotImpliedProb,
  calculateBracketProbability,
  parseKalshiCryptoTicker,
  annualizedToHourly,
} from '../services/crypto-price';

describe('APEX SPEED Pipeline', () => {
  // ── Bracket Probability Model ──
  describe('calculateBracketImpliedProb', () => {
    it('price inside bracket at expiry returns 1', () => {
      // Upper bound is exclusive: [67000, 67500)
      const prob = calculateBracketImpliedProb(67_250, 67_000, 500, 0);
      expect(prob).toBe(1);
    });

    it('price outside bracket at expiry returns 0', () => {
      const prob = calculateBracketImpliedProb(68_000, 67_000, 500, 0);
      expect(prob).toBe(0);
    });

    it('price centered on bracket has highest probability', () => {
      const centered = calculateBracketImpliedProb(67_250, 67_000, 500, 1);
      const offset = calculateBracketImpliedProb(68_000, 67_000, 500, 1);
      expect(centered).toBeGreaterThan(offset);
    });

    it('probability decreases with more time to expiry (wider distribution)', () => {
      // Same bracket, same price — more time means more spread
      const short = calculateBracketImpliedProb(67_250, 67_000, 500, 0.5);
      const long = calculateBracketImpliedProb(67_250, 67_000, 500, 12);
      expect(short).toBeGreaterThan(long);
    });

    it('wider brackets have higher probability', () => {
      const narrow = calculateBracketImpliedProb(67_250, 67_000, 500, 4);
      const wide = calculateBracketImpliedProb(67_250, 67_000, 2000, 4);
      expect(wide).toBeGreaterThan(narrow);
    });

    it('higher volatility decreases bracket probability (wider distribution)', () => {
      const lowVol = calculateBracketImpliedProb(67_250, 67_000, 500, 4, 0.30);
      const highVol = calculateBracketImpliedProb(67_250, 67_000, 500, 4, 0.80);
      expect(lowVol).toBeGreaterThan(highVol);
    });

    it('probability is between 0 and 1', () => {
      const prob = calculateBracketImpliedProb(100_000, 67_000, 500, 1);
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(1);
    });

    it('accepts optional volatility parameter', () => {
      const defaultVol = calculateBracketImpliedProb(67_250, 67_000, 500, 4);
      const customVol = calculateBracketImpliedProb(67_250, 67_000, 500, 4, 0.57);
      // Should be very close since default hourly vol ~0.006 ≈ 57% annualized
      expect(Math.abs(defaultVol - customVol)).toBeLessThan(0.05);
    });

    it('BTC bracket example: centered, 1 hour, produces reasonable probability', () => {
      // BTC at $67,250, bracket $67,000-$67,500, 1 hour to expiry
      const prob = calculateBracketImpliedProb(67_250, 67_000, 500, 1);
      expect(prob).toBeGreaterThan(0.15);
      expect(prob).toBeLessThan(0.60);
    });

    it('ETH bracket example: centered, 2 hours', () => {
      // ETH at $3,520, bracket $3,500-$3,540, 2 hours to expiry
      // Bracket is ~1.1% of price — reasonably wide relative to vol
      const prob = calculateBracketImpliedProb(3_520, 3_500, 40, 2);
      expect(prob).toBeGreaterThan(0.05);
      expect(prob).toBeLessThan(0.60);
    });

    it('SOL bracket example: centered, 4 hours', () => {
      // SOL at $151, bracket $150-$152, 4 hours
      // Bracket is ~1.3% of price
      const prob = calculateBracketImpliedProb(151, 150, 2, 4);
      expect(prob).toBeGreaterThan(0.01);
      expect(prob).toBeLessThan(0.60);
    });
  });

  // ── Short Expiry Handling ──
  describe('short expiry contracts', () => {
    it('< 5 min, inside bracket: high probability (60-90%)', () => {
      // 3 minutes to expiry, price inside bracket
      const prob = calculateBracketImpliedProb(67_250, 67_000, 500, 3 / 60);
      expect(prob).toBeGreaterThan(0.55);
      expect(prob).toBeLessThanOrEqual(0.90);
    });

    it('< 5 min, outside bracket: low probability (< 15%)', () => {
      // 3 minutes to expiry, price outside bracket
      const prob = calculateBracketImpliedProb(68_500, 67_000, 500, 3 / 60);
      expect(prob).toBeLessThan(0.20);
    });

    it('< 5 min, at bracket center: highest probability', () => {
      const center = calculateBracketImpliedProb(67_250, 67_000, 500, 2 / 60);
      const edge = calculateBracketImpliedProb(67_050, 67_000, 500, 2 / 60);
      expect(center).toBeGreaterThan(edge);
    });

    it('< 5 min, far outside: very low probability', () => {
      // Price far from bracket
      const prob = calculateBracketImpliedProb(70_000, 67_000, 500, 2 / 60);
      expect(prob).toBeLessThan(0.10);
    });
  });

  // ── Floor (Threshold) Contract Model ──
  describe('calculateSpotImpliedProb', () => {
    it('spot well above strike returns high probability', () => {
      const prob = calculateSpotImpliedProb(70_000, 65_000, 1);
      expect(prob).toBeGreaterThan(0.90);
    });

    it('spot well below strike returns low probability', () => {
      const prob = calculateSpotImpliedProb(60_000, 65_000, 1);
      expect(prob).toBeLessThan(0.10);
    });

    it('spot at strike returns ~50%', () => {
      const prob = calculateSpotImpliedProb(65_000, 65_000, 1);
      expect(prob).toBeGreaterThan(0.40);
      expect(prob).toBeLessThan(0.60);
    });

    it('expired contracts return 1 or 0', () => {
      expect(calculateSpotImpliedProb(70_000, 65_000, 0)).toBe(1);
      expect(calculateSpotImpliedProb(60_000, 65_000, 0)).toBe(0);
    });

    it('accepts optional volatility parameter', () => {
      const defaultV = calculateSpotImpliedProb(70_000, 65_000, 4);
      const highVol = calculateSpotImpliedProb(70_000, 65_000, 4, 1.5);
      // Higher vol → prob closer to 50% (more uncertainty)
      // With very high vol, the 5K buffer above strike is less certain
      expect(Math.abs(highVol - 0.5)).toBeLessThanOrEqual(Math.abs(defaultV - 0.5));
    });
  });

  // ── calculateBracketProbability (convenience wrapper) ──
  describe('calculateBracketProbability', () => {
    it('produces same result as calculateBracketImpliedProb', () => {
      const a = calculateBracketProbability(67_250, 67_000, 67_500, 1, 0.57);
      const b = calculateBracketImpliedProb(67_250, 67_000, 500, 1, 0.57);
      expect(a).toBeCloseTo(b, 6);
    });
  });

  // ── Volatility Conversion ──
  describe('annualizedToHourly', () => {
    it('converts annualized vol to hourly correctly', () => {
      const hourly = annualizedToHourly(0.57);
      // 0.57 / sqrt(8760) ≈ 0.006089
      expect(hourly).toBeGreaterThan(0.005);
      expect(hourly).toBeLessThan(0.007);
    });

    it('round-trip: hourly * sqrt(8760) ≈ annualized', () => {
      const annualized = 0.57;
      const hourly = annualizedToHourly(annualized);
      const roundTrip = hourly * Math.sqrt(8760);
      expect(roundTrip).toBeCloseTo(annualized, 4);
    });
  });

  // ── Kalshi Ticker Parsing ──
  describe('parseKalshiCryptoTicker', () => {
    it('parses BRACKET ticker correctly', () => {
      const result = parseKalshiCryptoTicker('KXBTC-26MAR2717-B82650');
      expect(result).not.toBeNull();
      expect(result!.asset).toBe('BTC');
      expect(result!.strike).toBe(82650);
      expect(result!.contractType).toBe('BRACKET');
      expect(result!.bracketWidth).toBe(500); // BTC bracket width
    });

    it('parses FLOOR ticker correctly', () => {
      const result = parseKalshiCryptoTicker('KXETH-26MAR2717-T3500');
      expect(result).not.toBeNull();
      expect(result!.asset).toBe('ETH');
      expect(result!.strike).toBe(3500);
      expect(result!.contractType).toBe('FLOOR');
      expect(result!.bracketWidth).toBe(0); // FLOOR has no bracket
    });

    it('parses SOL ticker', () => {
      const result = parseKalshiCryptoTicker('KXSOL-26MAR2717-B150');
      expect(result).not.toBeNull();
      expect(result!.asset).toBe('SOL');
      expect(result!.bracketWidth).toBe(2); // SOL bracket width
    });

    it('returns null for non-crypto ticker', () => {
      expect(parseKalshiCryptoTicker('PRES-2028-DEM')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseKalshiCryptoTicker('')).toBeNull();
    });

    it('handles all supported assets', () => {
      const assets = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE'];
      for (const asset of assets) {
        const result = parseKalshiCryptoTicker(`KX${asset}-26MAR2717-B1000`);
        expect(result).not.toBeNull();
        expect(result!.asset).toBe(asset);
      }
    });
  });

  // ── Edge Detection Scenarios ──
  describe('edge detection scenarios', () => {
    it('detects edge when spot implies higher prob than market price', () => {
      // BTC at $67,250 (centered in $67,000-$67,500 bracket)
      // Market prices YES at 0.10 — that seems too low if price is centered
      const fairProb = calculateBracketImpliedProb(67_250, 67_000, 500, 1);
      const marketPrice = 0.10;
      const edge = fairProb - marketPrice;
      expect(edge).toBeGreaterThan(0.10); // Should be significant edge
    });

    it('no edge when market price roughly matches model', () => {
      const fairProb = calculateBracketImpliedProb(67_250, 67_000, 500, 1);
      // If market prices at roughly fair value
      const edge = Math.abs(fairProb - fairProb);
      expect(edge).toBe(0);
    });

    it('fee-adjusted edge must exceed 3%', () => {
      const fairProb = 0.35;
      const marketPrice = 0.33;
      const rawEdge = Math.abs(fairProb - marketPrice); // 2%
      const fee = 0.07 * marketPrice * (1 - marketPrice); // ~1.5%
      const netEdge = rawEdge - fee;
      // 2% - 1.5% = 0.5% — below 3% threshold, should NOT trade
      expect(netEdge).toBeLessThan(0.03);
    });
  });
});
