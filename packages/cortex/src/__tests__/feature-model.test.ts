import { describe, it, expect, beforeEach } from 'vitest';
import { predict, trainModel, loadModel, getModelInfo, FEATURE_SCHEMA_VERSION } from '../feature-model';
import type { FeatureVector } from '../feature-model';

function makeFV(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    marketId: 'test',
    marketPrice: 0.5,
    daysToResolution: 30,
    category: 'POLITICS',
    volume: 1000,
    priceLevel: 0.5,
    bidAskSpread: 0.02,
    volumeRank: 0.5,
    timeToResolutionBucket: 2,
    ...overrides,
  };
}

describe('predict — default model', () => {
  beforeEach(() => {
    // Reset to default model
    loadModel({
      intercept: 0,
      weights: {},
      trainedAt: new Date().toISOString(),
      sampleSize: 0,
      accuracy: 0.5,
    });
  });

  it('returns probability in [0, 1]', () => {
    const result = predict(makeFV());
    expect(result.probability).toBeGreaterThanOrEqual(0.01);
    expect(result.probability).toBeLessThanOrEqual(0.99);
  });

  it('returns confidence in [0, 1]', () => {
    const result = predict(makeFV());
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('handles NaN in feature vector gracefully', () => {
    const result = predict(makeFV({ bidAskSpread: NaN, volumeRank: NaN }));
    expect(Number.isFinite(result.probability)).toBe(true);
    expect(Number.isFinite(result.confidence)).toBe(true);
  });

  it('handles Infinity in feature vector gracefully', () => {
    const result = predict(makeFV({ volume: Infinity }));
    expect(Number.isFinite(result.probability)).toBe(true);
  });
});

describe('loadModel — validation', () => {
  it('rejects NaN intercept', () => {
    loadModel({
      intercept: NaN,
      weights: { test: 1.0 },
      trainedAt: new Date().toISOString(),
      sampleSize: 100,
      accuracy: 0.8,
    });
    // Should have kept previous model, not used NaN
    const result = predict(makeFV());
    expect(Number.isFinite(result.probability)).toBe(true);
  });

  it('removes NaN weight entries', () => {
    loadModel({
      intercept: 0,
      weights: { good: 1.0, bad: NaN, worse: Infinity },
      trainedAt: new Date().toISOString(),
      sampleSize: 100,
      accuracy: 0.8,
    });
    const result = predict(makeFV());
    expect(Number.isFinite(result.probability)).toBe(true);
  });

  it('backward compat: validationAccuracy defaults to accuracy when missing', () => {
    loadModel({
      intercept: 0,
      weights: {},
      trainedAt: new Date().toISOString(),
      sampleSize: 50,
      accuracy: 0.65,
    });
    const info = getModelInfo();
    expect(info.validationAccuracy).toBe(0.65);
  });
});

describe('trainModel', () => {
  it('refuses to train with < 30 samples', () => {
    // Reset to known state first
    loadModel({ intercept: 0, weights: {}, trainedAt: new Date().toISOString(), sampleSize: 0, accuracy: 0.5 });
    const small = Array.from({ length: 25 }, (_, i) => ({
      features: makeFV(),
      outcome: (i % 2) as 0 | 1,
    }));
    const model = trainModel(small);
    // Should return current model unchanged (sampleSize 0 = defaults)
    expect(model.sampleSize).toBe(0);
  });

  it('reports validation accuracy separately from training accuracy', () => {
    // Create data with a learnable pattern
    const data = Array.from({ length: 50 }, (_, i) => ({
      features: makeFV({ bidAskSpread: i > 25 ? 0.5 : 0.01 }),
      outcome: (i > 25 ? 1 : 0) as 0 | 1,
    }));
    const model = trainModel(data);
    expect(model.validationAccuracy).toBeDefined();
    expect(typeof model.validationAccuracy).toBe('number');
  });

  it('rejects model if validation accuracy < 55%', () => {
    // Reset to known state
    loadModel({ intercept: 0, weights: {}, trainedAt: new Date().toISOString(), sampleSize: 0, accuracy: 0.5 });
    // Random data → model can't learn → validation accuracy ~50%
    const random = Array.from({ length: 50 }, () => ({
      features: makeFV({ bidAskSpread: Math.random() }),
      outcome: (Math.random() > 0.5 ? 1 : 0) as 0 | 1,
    }));
    const model = trainModel(random);
    // With random data, validation accuracy should be ~50%, below 55% threshold
    // Model should be rejected (keeps previous sampleSize = 0)
    if (model.validationAccuracy < 0.55) {
      expect(model.sampleSize).toBe(0);
    }
    // Either way, validationAccuracy should be reported
    expect(typeof model.validationAccuracy).toBe('number');
  });
});

describe('FEATURE_SCHEMA_VERSION', () => {
  it('is exported and is a number', () => {
    expect(typeof FEATURE_SCHEMA_VERSION).toBe('number');
    expect(FEATURE_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });
});
