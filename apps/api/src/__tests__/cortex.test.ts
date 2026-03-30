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

describe('CORTEX v3 Synthesis', () => {
  it('produces confidence-weighted average of two signals', () => {
    const signals = [
      makeSignal('COGEX', 0.60, 0.7),
      makeSignal('FLOWEX', 0.70, 0.8),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // Fusion uses module weights × confidence × time decay for weighted average
    expect(edge.cortexProbability).toBeGreaterThan(0.59);
    expect(edge.cortexProbability).toBeLessThan(0.71);
    expect(edge.marketPrice).toBe(0.50);
    expect(edge.edgeMagnitude).toBeGreaterThan(0.09);
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

  it('marks edge as actionable when all 4 gates pass', () => {
    // Large edge: cortex=0.80, market=0.50
    // Uses LLM modules (LEGEX, DOMEX) to satisfy the LLM gate
    // Uses 2+ modules to satisfy the module count gate
    const signals = [
      makeSignal('LEGEX', 0.80, 0.9),
      makeSignal('DOMEX', 0.80, 0.9),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // Edge ~0.30, confidence should be high enough, and both gates satisfied
    expect(edge.edgeMagnitude).toBeGreaterThan(0.20);
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

  it('non-LLM modules alone are not actionable even with large edge', () => {
    // COGEX and FLOWEX are not LLM modules — fails the LLM gate
    const signals = [
      makeSignal('COGEX', 0.80, 0.9),
      makeSignal('FLOWEX', 0.80, 0.9),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    expect(edge.edgeMagnitude).toBeGreaterThan(0.20);
    expect(edge.isActionable).toBe(false); // no LLM module
  });

  it('confidence is penalized by coverage factor when few modules contribute', () => {
    // 1 module contributing: coverageFactor = min(1, 1/4) = 0.25
    // confidence = min(0.9, avgConf × agreementAdj × (0.6 + 0.4 × 0.25))
    // With 1 module, agreement is perfect (1.0), but coverage drags confidence down
    const signals = [makeSignal('COGEX', 0.70, 0.90)];
    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // Should be less than the raw 0.90 confidence due to coverage penalty
    expect(edge.confidence).toBeLessThan(0.90);
    // coverageFactor = 0.25, so (0.6 + 0.4 × 0.25) = 0.7 multiplier on top of agreement adjustment
    expect(edge.confidence).toBeGreaterThan(0);
  });

  it('signal contributions are returned from fusion engine', () => {
    const signals = [
      makeSignal('COGEX', 0.60, 0.7),
      makeSignal('FLOWEX', 0.70, 0.8),
      makeSignal('LEGEX', 0.65, 0.9),
    ];

    const edge = synthesize({ marketId: 'market-1', marketCategory: 'POLITICS', marketPrice: 0.50, signals });

    // Each signal should have a non-zero weight
    expect(edge.signals).toHaveLength(3);
    for (const s of edge.signals) {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.moduleId).toBeDefined();
      expect(s.probability).toBeGreaterThan(0);
    }
  });
});
