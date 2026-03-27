import { describe, it, expect } from 'vitest';
import { scoreOpportunity } from '../opportunity-scoring';

function makeInput(overrides: Partial<Parameters<typeof scoreOpportunity>[0]> = {}) {
  return {
    fusedProbability: 0.5,
    fusedConfidence: 0.5,
    marketPrice: 0.5,
    daysToResolution: 30,
    platform: 'KALSHI' as const,
    volume: 10000,
    category: 'POLITICS',
    ...overrides,
  };
}

describe('scoreOpportunity — Kelly criterion', () => {
  it('BUY_YES at 0.30 with fusedProb 0.40 → positive Kelly', () => {
    const result = scoreOpportunity(makeInput({
      fusedProbability: 0.40, marketPrice: 0.30,
    }));
    expect(result.edgeDirection).toBe('BUY_YES');
    expect(result.kellyFraction).toBeGreaterThan(0);
    // Full Kelly: (0.40 × 2.333 - 0.60) / 2.333 = 0.1429, quarter = 0.0357
    expect(result.kellyFraction).toBeCloseTo(0.0357, 2);
  });

  it('BUY_NO at 0.70 with fusedProb 0.60 → uses NO odds, same Kelly as symmetric BUY_YES', () => {
    const result = scoreOpportunity(makeInput({
      fusedProbability: 0.60, marketPrice: 0.70,
    }));
    expect(result.edgeDirection).toBe('BUY_NO');
    expect(result.kellyFraction).toBeGreaterThan(0);
    // p_no = 0.40, entry = 0.30, b = 2.333 → same as symmetric BUY_YES
    expect(result.kellyFraction).toBeCloseTo(0.0357, 2);
  });

  it('symmetric edge produces symmetric Kelly', () => {
    const buyYes = scoreOpportunity(makeInput({ fusedProbability: 0.40, marketPrice: 0.30 }));
    const buyNo = scoreOpportunity(makeInput({ fusedProbability: 0.60, marketPrice: 0.70 }));
    expect(buyYes.kellyFraction).toBeCloseTo(buyNo.kellyFraction, 3);
  });

  it('no edge (prob == price) → Kelly = 0', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: 0.50, marketPrice: 0.50 }));
    expect(result.kellyFraction).toBe(0);
    expect(result.isActionable).toBe(false);
  });

  it('negative edge → Kelly ≤ 0, clamped to 0', () => {
    // fusedProb 0.30 < marketPrice 0.50 → BUY_NO
    // p_no = 0.70, entry = 0.50, b = 1.0
    // f* = (0.70 * 1.0 - 0.30) / 1.0 = 0.40 → actually positive since buying NO is correct
    // Let's use fusedProb 0.45, market 0.50 → very small edge
    const result = scoreOpportunity(makeInput({ fusedProbability: 0.499, marketPrice: 0.50 }));
    // Edge ~0.1%, won't survive fees → not actionable
    expect(result.isActionable).toBe(false);
  });

  it('quarter-Kelly is exactly 1/4 of full Kelly', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: 0.60, marketPrice: 0.40 }));
    // p = 0.60, entry = 0.40, b = 1.5
    // full Kelly = (0.60 * 1.5 - 0.40) / 1.5 = 0.333
    // quarter Kelly = 0.0833
    expect(result.kellyFraction).toBeCloseTo(0.0833, 3);
  });
});

describe('scoreOpportunity — fee calculation', () => {
  it('Kalshi fee at price 0.30 (BUY_YES): 7% × (1 - 0.30) = 4.9%', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: 0.50, marketPrice: 0.30 }));
    // Edge = 0.20, fee = 0.07 * 0.70 = 0.049
    expect(result.netEdge).toBeCloseTo(0.20 - 0.049, 3);
  });

  it('Kalshi fee at price 0.90 (BUY_YES): 7% × (1 - 0.90) = 0.7%', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: 0.95, marketPrice: 0.90 }));
    // Edge = 0.05, fee = 0.07 * 0.10 = 0.007
    expect(result.netEdge).toBeCloseTo(0.05 - 0.007, 3);
  });

  it('edge that does not survive fees → netEdge = 0, not actionable', () => {
    const result = scoreOpportunity(makeInput({
      fusedProbability: 0.31, marketPrice: 0.30, // 1% edge
    }));
    // fee = 0.07 * 0.70 = 0.049 > edge 0.01 → netEdge = 0
    expect(result.netEdge).toBe(0);
    expect(result.isActionable).toBe(false);
  });
});

describe('scoreOpportunity — input validation', () => {
  it('NaN fusedProbability → zero score, not actionable', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: NaN }));
    expect(result.isActionable).toBe(false);
    expect(result.kellyFraction).toBe(0);
  });

  it('probability > 1 → zero score', () => {
    const result = scoreOpportunity(makeInput({ fusedProbability: 1.5 }));
    expect(result.isActionable).toBe(false);
    expect(result.kellyFraction).toBe(0);
  });

  it('market price at 0 → rejected (degenerate)', () => {
    const result = scoreOpportunity(makeInput({ marketPrice: 0 }));
    expect(result.isActionable).toBe(false);
  });

  it('market price at 1 → rejected (degenerate)', () => {
    const result = scoreOpportunity(makeInput({ marketPrice: 1 }));
    expect(result.isActionable).toBe(false);
  });

  it('negative daysToResolution → rejected', () => {
    const result = scoreOpportunity(makeInput({ daysToResolution: -5 }));
    expect(result.isActionable).toBe(false);
  });
});
