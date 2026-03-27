import { describe, it, expect } from 'vitest';
import { fuseSignals, RawSignal } from '../signal-fusion';

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
