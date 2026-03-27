/**
 * CalibrationMemory — quantitative bias correction based on historical performance.
 *
 * Stores per-module, per-category overestimate/underestimate metrics.
 * Auto-applies corrections to future estimates.
 * Recalculates weekly from resolved markets.
 */

export interface CalibrationRecord {
  moduleId: string;
  category: string;
  avgOverestimate: number;     // positive = overestimates, negative = underestimates
  avgAbsError: number;         // mean absolute error
  sampleSize: number;
  brierScore: number;
  timeToResolutionBucket: string; // 'hours' | 'days' | 'weeks' | 'months'
  lastUpdated: Date;
}

// In-memory calibration table — loaded from DB on startup, updated weekly
const calibrationTable = new Map<string, CalibrationRecord>();

function getKey(moduleId: string, category: string, bucket: string): string {
  return `${moduleId}:${category}:${bucket}`;
}

/**
 * Apply calibration correction to a probability estimate.
 * Validates input probability — NaN/out-of-range returns uncorrected 0.5.
 */
export function applyCalibration(
  probability: number,
  moduleId: string,
  category: string,
  daysToResolution: number
): { calibrated: number; correction: number; sampleSize: number } {
  // Input validation
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    console.warn(`[applyCalibration] Invalid probability ${probability} for ${moduleId}/${category} — returning 0.5`);
    return { calibrated: 0.5, correction: 0, sampleSize: 0 };
  }

  const bucket = daysToResolution < 1 ? 'hours'
    : daysToResolution < 7 ? 'days'
    : daysToResolution < 30 ? 'weeks'
    : 'months';

  const key = getKey(moduleId, category, bucket);
  const record = calibrationTable.get(key);

  if (!record || record.sampleSize < 10) {
    // Not enough data — no correction
    return { calibrated: probability, correction: 0, sampleSize: record?.sampleSize ?? 0 };
  }

  // Validate stored correction is finite
  if (!Number.isFinite(record.avgOverestimate)) {
    console.warn(`[applyCalibration] Corrupt calibration record for ${key} — skipping correction`);
    return { calibrated: probability, correction: 0, sampleSize: record.sampleSize };
  }

  // Apply correction: if module overestimates by 8%, subtract 8%
  const correction = -record.avgOverestimate;
  const calibrated = Math.max(0.01, Math.min(0.99, probability + correction));

  return { calibrated, correction, sampleSize: record.sampleSize };
}

/**
 * Recalculate calibration from resolved market data.
 * Called weekly by the calibration job.
 */
export function recalibrate(resolvedData: {
  moduleId: string;
  category: string;
  predictedProb: number;
  actualOutcome: 0 | 1; // 0=NO, 1=YES
  daysToResolution: number;
}[]): CalibrationRecord[] {
  // Group by module × category × bucket
  const groups = new Map<string, { errors: number[]; absErrors: number[]; brierScores: number[] }>();

  for (const d of resolvedData) {
    const bucket = d.daysToResolution < 1 ? 'hours'
      : d.daysToResolution < 7 ? 'days'
      : d.daysToResolution < 30 ? 'weeks'
      : 'months';

    const key = getKey(d.moduleId, d.category, bucket);
    if (!groups.has(key)) {
      groups.set(key, { errors: [], absErrors: [], brierScores: [] });
    }

    const g = groups.get(key)!;
    const error = d.predictedProb - d.actualOutcome; // positive = overestimate
    g.errors.push(error);
    g.absErrors.push(Math.abs(error));
    g.brierScores.push((d.predictedProb - d.actualOutcome) ** 2);
  }

  const records: CalibrationRecord[] = [];
  for (const [key, g] of groups) {
    const [moduleId, category, bucket] = key.split(':');
    const record: CalibrationRecord = {
      moduleId,
      category,
      avgOverestimate: g.errors.reduce((a, b) => a + b, 0) / g.errors.length,
      avgAbsError: g.absErrors.reduce((a, b) => a + b, 0) / g.absErrors.length,
      sampleSize: g.errors.length,
      brierScore: g.brierScores.reduce((a, b) => a + b, 0) / g.brierScores.length,
      timeToResolutionBucket: bucket,
      lastUpdated: new Date(),
    };

    calibrationTable.set(key, record);
    records.push(record);
  }

  return records;
}

/**
 * Load calibration data from persisted records.
 * Validates each record — skips corrupt entries instead of crashing.
 */
export function loadCalibration(records: CalibrationRecord[]): void {
  if (!Array.isArray(records)) {
    console.warn('[loadCalibration] Expected array, got', typeof records);
    return;
  }
  let loaded = 0;
  let skipped = 0;
  for (const r of records) {
    // Validate required fields
    if (!r.moduleId || !r.category || !r.timeToResolutionBucket) { skipped++; continue; }
    if (!Number.isFinite(r.avgOverestimate) || !Number.isFinite(r.avgAbsError) || !Number.isFinite(r.brierScore)) { skipped++; continue; }
    if (!Number.isFinite(r.sampleSize) || r.sampleSize < 0) { skipped++; continue; }

    const key = getKey(r.moduleId, r.category, r.timeToResolutionBucket);
    calibrationTable.set(key, r);
    loaded++;
  }
  if (skipped > 0) {
    console.warn(`[loadCalibration] Loaded ${loaded} records, skipped ${skipped} corrupt entries`);
  }
}

/**
 * Get all calibration records for dashboard display.
 */
export function getCalibrationTable(): CalibrationRecord[] {
  return Array.from(calibrationTable.values());
}
