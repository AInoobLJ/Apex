import { describe, it, expect, beforeEach } from 'vitest';
import { applyCalibration, recalibrate, loadCalibration, getCalibrationTable } from '../calibration-memory';

describe('applyCalibration', () => {
  it('no calibration data → returns input unchanged', () => {
    const result = applyCalibration(0.6, 'UNKNOWN_MODULE', 'UNKNOWN_CAT', 30);
    expect(result.calibrated).toBe(0.6);
    expect(result.correction).toBe(0);
  });

  it('output always in [0.01, 0.99]', () => {
    const resultHigh = applyCalibration(0.99, 'COGEX', 'POLITICS', 30);
    expect(resultHigh.calibrated).toBeLessThanOrEqual(0.99);
    expect(resultHigh.calibrated).toBeGreaterThanOrEqual(0.01);

    const resultLow = applyCalibration(0.01, 'COGEX', 'POLITICS', 30);
    expect(resultLow.calibrated).toBeLessThanOrEqual(0.99);
    expect(resultLow.calibrated).toBeGreaterThanOrEqual(0.01);
  });

  it('NaN probability → returns 0.5', () => {
    const result = applyCalibration(NaN, 'COGEX', 'POLITICS', 30);
    expect(result.calibrated).toBe(0.5);
    expect(result.correction).toBe(0);
  });

  it('probability > 1 → returns 0.5', () => {
    const result = applyCalibration(1.5, 'COGEX', 'POLITICS', 30);
    expect(result.calibrated).toBe(0.5);
  });
});

describe('recalibrate', () => {
  it('calculates overestimate correctly', () => {
    const records = recalibrate([
      { moduleId: 'COGEX', category: 'POLITICS', predictedProb: 0.8, actualOutcome: 0, daysToResolution: 14 },
      { moduleId: 'COGEX', category: 'POLITICS', predictedProb: 0.7, actualOutcome: 0, daysToResolution: 14 },
    ]);
    // Both predicted high but outcome was NO → overestimate
    expect(records).toHaveLength(1);
    expect(records[0].avgOverestimate).toBeGreaterThan(0);
    expect(records[0].sampleSize).toBe(2);
  });

  it('applies calibration after recalibrate', () => {
    // Recalibrate with overestimating data (need >=10 samples)
    const data = Array.from({ length: 12 }, () => ({
      moduleId: 'TESTMOD', category: 'TESTCAT', predictedProb: 0.8, actualOutcome: 0 as 0 | 1, daysToResolution: 14,
    }));
    recalibrate(data);

    // Now applyCalibration should correct downward
    const result = applyCalibration(0.8, 'TESTMOD', 'TESTCAT', 14);
    expect(result.correction).toBeLessThan(0); // correction should be negative (reduce overestimate)
    expect(result.calibrated).toBeLessThan(0.8);
  });
});

describe('loadCalibration — validation', () => {
  it('skips corrupt records', () => {
    loadCalibration([
      { moduleId: 'A', category: 'B', avgOverestimate: NaN, avgAbsError: 0.1, sampleSize: 10, brierScore: 0.2, timeToResolutionBucket: 'days', lastUpdated: new Date() },
      { moduleId: 'C', category: 'D', avgOverestimate: 0.05, avgAbsError: 0.1, sampleSize: 10, brierScore: 0.2, timeToResolutionBucket: 'days', lastUpdated: new Date() },
    ]);
    // Only the second (valid) record should be loaded
    const table = getCalibrationTable();
    const valid = table.find(r => r.moduleId === 'C');
    expect(valid).toBeDefined();
  });

  it('handles non-array input gracefully', () => {
    expect(() => loadCalibration(null as any)).not.toThrow();
    expect(() => loadCalibration(undefined as any)).not.toThrow();
  });
});
