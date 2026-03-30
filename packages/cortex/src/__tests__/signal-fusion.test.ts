import { describe, it, expect } from 'vitest';
import { fuseSignals, computeAdaptiveWeights, STATIC_MODULE_WEIGHTS, RawSignal, ModuleScoreInput } from '../signal-fusion';

function makeSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    moduleId: 'COGEX',
    probability: 0.6,
    confidence: 0.7,
    reasoning: 'test',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('fuseSignals', () => {
  it('returns 0.5 with no signals', () => {
    const result = fuseSignals([]);
    expect(result.probability).toBe(0.5);
    expect(result.confidence).toBe(0);
    expect(result.contributingModules).toHaveLength(0);
  });

  it('single signal → probability close to input', () => {
    const result = fuseSignals([makeSignal({ probability: 0.7, confidence: 0.8 })]);
    expect(result.probability).toBeCloseTo(0.7, 1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('two agreeing signals → higher confidence', () => {
    const one = fuseSignals([makeSignal({ moduleId: 'COGEX', probability: 0.7, confidence: 0.7 })]);
    const two = fuseSignals([
      makeSignal({ moduleId: 'COGEX', probability: 0.7, confidence: 0.7 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.72, confidence: 0.7 }),
    ]);
    expect(two.confidence).toBeGreaterThan(one.confidence);
    expect(two.agreementScore).toBeGreaterThan(0.5);
  });

  it('two conflicting signals → lower agreement score', () => {
    const result = fuseSignals([
      makeSignal({ moduleId: 'COGEX', probability: 0.9, confidence: 0.7 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.1, confidence: 0.7 }),
    ]);
    expect(result.agreementScore).toBeLessThan(0.5);
  });

  it('excludes signal with NaN probability', () => {
    const result = fuseSignals([
      makeSignal({ moduleId: 'COGEX', probability: NaN, confidence: 0.7 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.6, confidence: 0.8 }),
    ]);
    expect(result.contributingModules).toHaveLength(1);
    expect(result.probability).toBeCloseTo(0.6, 1);
  });

  it('excludes signal with probability > 1', () => {
    const result = fuseSignals([
      makeSignal({ moduleId: 'COGEX', probability: 1.5, confidence: 0.7 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.4, confidence: 0.8 }),
    ]);
    expect(result.contributingModules).toHaveLength(1);
  });

  it('excludes signal with negative confidence', () => {
    const result = fuseSignals([
      makeSignal({ moduleId: 'COGEX', probability: 0.6, confidence: -0.1 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.4, confidence: 0.8 }),
    ]);
    expect(result.contributingModules).toHaveLength(1);
  });

  it('all signals zero confidence → returns default', () => {
    const result = fuseSignals([
      makeSignal({ probability: 0.8, confidence: 0 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.2, confidence: 0 }),
    ]);
    expect(result.probability).toBe(0.5);
    expect(result.confidence).toBe(0);
  });

  it('output probability always in [0.01, 0.99]', () => {
    const resultHigh = fuseSignals([makeSignal({ probability: 0.999, confidence: 0.99 })]);
    expect(resultHigh.probability).toBeLessThanOrEqual(0.99);

    const resultLow = fuseSignals([makeSignal({ probability: 0.001, confidence: 0.99 })]);
    expect(resultLow.probability).toBeGreaterThanOrEqual(0.01);
  });
});

describe('computeAdaptiveWeights', () => {
  it('returns static weights when no scores provided', () => {
    const { weights, adaptive, blendRatio } = computeAdaptiveWeights([]);
    expect(adaptive).toBe(false);
    expect(blendRatio).toBe(0);
    expect(weights.COGEX).toBe(STATIC_MODULE_WEIGHTS.COGEX);
  });

  it('returns static weights when scores have insufficient samples', () => {
    const scores: ModuleScoreInput[] = [
      { moduleId: 'COGEX', brierScore: 0.15, sampleSize: 5 },
    ];
    const { adaptive } = computeAdaptiveWeights(scores);
    expect(adaptive).toBe(false);
  });

  it('activates adaptive weights with sufficient samples', () => {
    const scores: ModuleScoreInput[] = [
      { moduleId: 'COGEX', brierScore: 0.15, sampleSize: 50 },
      { moduleId: 'LEGEX', brierScore: 0.30, sampleSize: 50 },
    ];
    const { adaptive, weights } = computeAdaptiveWeights(scores);
    expect(adaptive).toBe(true);
    // COGEX (lower Brier) should get higher weight than LEGEX
    expect(weights.COGEX).toBeGreaterThan(weights.LEGEX);
  });

  it('respects minimum weight floor', () => {
    const scores: ModuleScoreInput[] = [
      { moduleId: 'COGEX', brierScore: 0.01, sampleSize: 200 },
      { moduleId: 'LEGEX', brierScore: 0.90, sampleSize: 200 },
    ];
    const { weights } = computeAdaptiveWeights(scores);
    // Even the worst performer keeps minimum weight
    expect(weights.LEGEX).toBeGreaterThanOrEqual(0.02);
  });

  it('blend ratio increases with sample count', () => {
    const makeScores = (n: number): ModuleScoreInput[] => [
      { moduleId: 'COGEX', brierScore: 0.15, sampleSize: n },
      { moduleId: 'LEGEX', brierScore: 0.25, sampleSize: n },
    ];
    const low = computeAdaptiveWeights(makeScores(15));
    const mid = computeAdaptiveWeights(makeScores(55));
    const high = computeAdaptiveWeights(makeScores(200));

    expect(low.blendRatio).toBeLessThan(mid.blendRatio);
    expect(mid.blendRatio).toBeLessThan(high.blendRatio);
    expect(high.blendRatio).toBe(1); // fully adaptive at 100+ samples
  });

  it('modules without scores keep static weights', () => {
    const scores: ModuleScoreInput[] = [
      { moduleId: 'COGEX', brierScore: 0.15, sampleSize: 50 },
    ];
    const { weights } = computeAdaptiveWeights(scores);
    // FLOWEX has no score data, keeps its static weight
    expect(weights.FLOWEX).toBe(STATIC_MODULE_WEIGHTS.FLOWEX);
  });
});

describe('fuseSignals with adaptive weights', () => {
  it('uses static weights when no moduleScores provided', () => {
    const signals = [
      makeSignal({ moduleId: 'COGEX', probability: 0.7, confidence: 0.8 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.6, confidence: 0.8 }),
    ];
    const withoutScores = fuseSignals(signals);
    const withEmptyScores = fuseSignals(signals, { moduleScores: [] });

    expect(withoutScores.probability).toBeCloseTo(withEmptyScores.probability, 5);
  });

  it('adapts weights when moduleScores are provided', () => {
    const signals = [
      makeSignal({ moduleId: 'COGEX', probability: 0.9, confidence: 0.8 }),
      makeSignal({ moduleId: 'LEGEX', probability: 0.1, confidence: 0.8 }),
    ];

    // Without adaptive: COGEX has higher static weight (0.15 vs 0.10)
    const staticResult = fuseSignals(signals);

    // With adaptive: give LEGEX much better Brier (lower = better)
    const adaptiveResult = fuseSignals(signals, {
      moduleScores: [
        { moduleId: 'COGEX', brierScore: 0.40, sampleSize: 200 },
        { moduleId: 'LEGEX', brierScore: 0.10, sampleSize: 200 },
      ],
    });

    // Adaptive result should shift probability toward LEGEX's 0.1
    expect(adaptiveResult.probability).toBeLessThan(staticResult.probability);
  });
});
