import { describe, it, expect } from 'vitest';
import { synthesize } from '../engine/cortex';
import type { SignalOutput } from '@apex/shared';

function makeSignal(moduleId: string, probability: number, confidence: number): SignalOutput {
  return {
    moduleId: moduleId as any,
    marketId: 'market-1',
    probability,
    confidence,
    reasoning: `${moduleId} analysis`,
    metadata: {},
    timestamp: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

describe('CORTEX v2 Synthesis', () => {
  it('produces confidence-weighted average of two signals', () => {
    const signals = [
      makeSignal('COGEX', 0.60, 0.7),
      makeSignal('FLOWEX', 0.70, 0.8),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // v2 uses confidence-weighted average, so result is between 0.60 and 0.70
    expect(edge.cortexProbability).toBeGreaterThan(0.60);
    expect(edge.cortexProbability).toBeLessThan(0.70);
    expect(edge.marketPrice).toBe(0.50);
    expect(edge.edgeMagnitude).toBeGreaterThan(0.10);
    expect(edge.edgeDirection).toBe('BUY_YES');
    expect(edge.signals).toHaveLength(2);
  });

  it('returns null edge for empty signals', () => {
    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals: [] });

    expect(edge.cortexProbability).toBe(0.50);
    expect(edge.edgeMagnitude).toBe(0);
    expect(edge.isActionable).toBe(false);
    expect(edge.confidence).toBe(0);
  });

  it('detects BUY_NO when cortex prob < market price', () => {
    const signals = [
      makeSignal('COGEX', 0.30, 0.8),
      makeSignal('FLOWEX', 0.35, 0.7),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.60, signals });

    expect(edge.cortexProbability).toBeLessThan(0.60);
    expect(edge.edgeDirection).toBe('BUY_NO');
  });

  it('marks edge as actionable when expectedValue >= threshold', () => {
    // Large edge: cortex=0.80, market=0.50
    const signals = [
      makeSignal('COGEX', 0.80, 0.9),
      makeSignal('FLOWEX', 0.80, 0.9),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    expect(edge.edgeMagnitude).toBeCloseTo(0.30, 2);
    expect(edge.isActionable).toBe(true);
  });

  it('marks small edges as not actionable', () => {
    // Tiny edge: cortex=0.51, market=0.50
    const signals = [
      makeSignal('COGEX', 0.51, 0.3),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    expect(edge.edgeMagnitude).toBeCloseTo(0.01, 2);
    expect(edge.isActionable).toBe(false);
  });

  it('adjusts confidence by coverage factor', () => {
    // 1 out of 10 modules = 10% coverage
    const signals = [makeSignal('COGEX', 0.70, 0.90)];
    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // Coverage = 1/10 = 0.1, confidence = min(0.90, 0.1) = 0.1
    expect(edge.confidence).toBeLessThanOrEqual(0.10);
  });

  it('signal contributions sum to 1.0 in weights', () => {
    const signals = [
      makeSignal('COGEX', 0.60, 0.7),
      makeSignal('FLOWEX', 0.70, 0.8),
      makeSignal('ARBEX', 0.65, 0.9),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });
    const totalWeight = edge.signals.reduce((sum, s) => sum + s.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });
});
