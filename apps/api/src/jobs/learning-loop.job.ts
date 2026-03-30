import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { trainModel, serializeModel, getModelInfo, recalibrate, FEATURE_SCHEMA_VERSION } from '@apex/cortex';
import type { FeatureVector } from '@apex/cortex';
import { telegramService } from '../services/telegram';

/**
 * Weekly learning loop: the most critical job in the system.
 *
 * Without this, every LLM credit spent is wasted — the system never learns from mistakes.
 *
 * Steps:
 * 1. Query all resolved markets with their signals and outcomes
 * 2. Build training data: { features: FeatureVector, outcome: 0 | 1 }[]
 * 3. Feed resolved data to trainModel() (gradient descent on logistic regression)
 * 4. Persist updated weights to DB
 * 5. Call recalibrate() using resolved signal data to update calibration table
 * 6. Persist calibration records to DB
 */
export async function handleLearningLoop(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Learning loop started');

  const since = new Date(Date.now() - 180 * 86400000); // 6 months of data

  // Step 1: Get resolved markets with signals, edges, and paper positions
  const resolvedMarkets = await prisma.market.findMany({
    where: {
      status: 'RESOLVED',
      resolution: { not: null },
      resolutionDate: { gte: since },
    },
    include: {
      signals: { where: { createdAt: { gte: since } } },
      edges: { orderBy: { createdAt: 'desc' }, take: 1 },
      contracts: { where: { outcome: 'YES' }, take: 1 },
    },
  });

  if (resolvedMarkets.length < 20) {
    logger.info({ count: resolvedMarkets.length }, 'Learning loop: insufficient resolved markets (<20), skipping training');
    return;
  }

  // Step 2: Build training data for FeatureModel
  const trainingData: { features: FeatureVector; outcome: 0 | 1 }[] = [];

  for (const market of resolvedMarkets) {
    const outcome: 0 | 1 = market.resolution === 'YES' ? 1 : 0;
    const yesPrice = market.contracts[0]?.lastPrice;
    if (!yesPrice) continue;

    // Find the DOMEX signal for this market (has the richest feature vector)
    // Filter by schema version to prevent feature mismatch from old schemas
    const domexSignal = market.signals.find(s => {
      if (s.moduleId !== 'DOMEX') return false;
      try {
        const meta = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
        // Only use signals with current schema version (or no version = legacy, skip)
        return meta?.featureSchemaVersion === FEATURE_SCHEMA_VERSION;
      } catch { return false; }
    });

    // If no DOMEX signal with current schema version, use basic features only
    // (don't mix old schema features into new model)

    // FIX: daysToResolution from SIGNAL creation time (not market.createdAt).
    // At training time we need the same feature value as at inference time —
    // i.e., "how many days until resolution WHEN the signal was first generated."
    const signalTimestamp = domexSignal?.createdAt ?? market.createdAt;
    const daysToRes = market.closesAt
      ? Math.max(1, Math.ceil((market.closesAt.getTime() - signalTimestamp.getTime()) / 86400000))
      : 365;

    // Build feature vector
    const fv: FeatureVector = {
      marketId: market.id,
      marketPrice: yesPrice,
      daysToResolution: daysToRes,
      category: market.category,
      volume: market.volume ?? 0,
      priceLevel: yesPrice, // kept for interface compat, weight=0
      bidAskSpread: 0,
      volumeRank: 0.5,
      timeToResolutionBucket: daysToRes < 1 ? 0 : daysToRes < 7 ? 1 : daysToRes < 30 ? 2 : 3,
    };

    // Reconstruct domain features from stored signal metadata (schema-versioned)
    if (domexSignal) {
      try {
        const meta = typeof domexSignal.metadata === 'string' ? JSON.parse(domexSignal.metadata) : domexSignal.metadata;
        if (meta?.featureVector) {
          Object.assign(fv, meta.featureVector);
        }
      } catch {
        // Continue without enriched features
      }
    } else {
      // Fallback: check TrainingSnapshot for feature vectors (collected since V2.39)
      try {
        const snapshot = await prisma.trainingSnapshot.findFirst({
          where: {
            marketId: market.id,
            featureVector: { not: null },
            featureSchemaVersion: FEATURE_SCHEMA_VERSION,
          },
          orderBy: { createdAt: 'desc' },
          select: { featureVector: true },
        });
        if (snapshot?.featureVector) {
          Object.assign(fv, snapshot.featureVector as object);
        }
      } catch {
        // Continue without enriched features
      }
    }

    trainingData.push({ features: fv, outcome });
  }

  logger.info({ trainingData: trainingData.length, resolvedMarkets: resolvedMarkets.length }, 'Training data prepared');

  // Step 3: Train the model (capture old accuracy first)
  const oldModelInfo = getModelInfo();
  const newModel = trainModel(trainingData);
  logger.info({
    sampleSize: newModel.sampleSize,
    accuracy: newModel.accuracy,
    featureCount: Object.keys(newModel.weights).length,
  }, 'FeatureModel retrained');

  // Step 4: Persist model weights to DB
  const serialized = serializeModel();
  await prisma.systemConfig.upsert({
    where: { key: 'feature_model_weights' },
    update: { value: JSON.stringify(serialized) },
    create: { key: 'feature_model_weights', value: JSON.stringify(serialized) },
  });
  logger.info('FeatureModel weights persisted to DB');

  // Step 5: Build calibration data and recalibrate
  const calibrationData: {
    moduleId: string;
    category: string;
    predictedProb: number;
    actualOutcome: 0 | 1;
    daysToResolution: number;
  }[] = [];

  for (const market of resolvedMarkets) {
    const outcome: 0 | 1 = market.resolution === 'YES' ? 1 : 0;

    for (const signal of market.signals) {
      // FIX: daysToResolution from signal's createdAt (matches inference time)
      const daysToRes = market.closesAt
        ? Math.max(0.01, (market.closesAt.getTime() - signal.createdAt.getTime()) / 86400000)
        : 365;

      calibrationData.push({
        moduleId: signal.moduleId,
        category: market.category,
        predictedProb: signal.probability,
        actualOutcome: outcome,
        daysToResolution: daysToRes,
      });
    }
  }

  const calibrationRecords = recalibrate(calibrationData);
  logger.info({ records: calibrationRecords.length }, 'Calibration table updated');

  // Step 6: Persist calibration records to DB
  await prisma.systemConfig.upsert({
    where: { key: 'calibration_records' },
    update: { value: JSON.stringify(calibrationRecords) },
    create: { key: 'calibration_records', value: JSON.stringify(calibrationRecords) },
  });
  logger.info('Calibration records persisted to DB');

  // Step 6b: Compute and persist decile calibration from training snapshots
  await computeCalibrationDeciles();

  logger.info({
    trainingDataSize: trainingData.length,
    modelAccuracy: newModel.accuracy,
    calibrationRecords: calibrationRecords.length,
  }, 'Learning loop complete');

  // Step 7: Send Telegram summary
  const oldAcc = (oldModelInfo.validationAccuracy * 100).toFixed(1);
  const newAcc = ((newModel as any).validationAccuracy !== undefined ? ((newModel as any).validationAccuracy * 100).toFixed(1) : (newModel.accuracy * 100).toFixed(1));
  // Compute average Brier score from calibration records
  const avgBrier = calibrationRecords.length > 0
    ? calibrationRecords.reduce((s, r) => s + r.brierScore, 0) / calibrationRecords.length
    : 0;

  const telegramMsg = [
    `📊 <b>Weekly Model Update</b>`,
    ``,
    `Accuracy: ${oldAcc}% → ${newAcc}%`,
    `Brier score: ${avgBrier.toFixed(4)}`,
    `Training samples: ${trainingData.length}`,
    `Calibration records: ${calibrationRecords.length}`,
    `Resolved markets: ${resolvedMarkets.length}`,
    `Features: ${Object.keys(newModel.weights).length}`,
  ].join('\n');

  await telegramService.sendMessage(telegramMsg).catch((err: any) => {
    logger.warn({ err: err.message }, 'Failed to send learning loop Telegram summary');
  });
}

/**
 * Compute calibration results by decile bucket from resolved training snapshots.
 * Groups all resolved snapshots by predicted probability decile (0-10%, 10-20%, ..., 90-100%)
 * and compares predicted vs actual outcomes.
 *
 * Can be called from the learning loop (weekly) or on demand via API.
 */
export async function computeCalibrationDeciles(): Promise<void> {
  const resolved = await prisma.trainingSnapshot.findMany({
    where: { outcome: { not: null } },
    select: { cortexProbability: true, outcome: true, edgeDirection: true },
  });

  if (resolved.length < 10) {
    logger.info({ count: resolved.length }, 'Insufficient resolved snapshots for calibration (<10)');
    return;
  }

  const BUCKET_LABELS = [
    '0-10%', '10-20%', '20-30%', '30-40%', '40-50%',
    '50-60%', '60-70%', '70-80%', '80-90%', '90-100%',
  ];

  // Group by predicted probability decile
  const buckets: { predicted: number[]; outcomes: number[] }[] =
    Array.from({ length: 10 }, () => ({ predicted: [], outcomes: [] }));

  for (const snap of resolved) {
    const prob = snap.cortexProbability;
    const bucketIdx = Math.min(9, Math.floor(prob * 10));
    buckets[bucketIdx].predicted.push(prob);
    buckets[bucketIdx].outcomes.push(snap.outcome!);
  }

  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 180 * 86400000); // 6 months

  // Build calibration results
  const results = buckets.map((b, i) => ({
    bucket: i,
    bucketLabel: BUCKET_LABELS[i],
    positionCount: b.predicted.length,
    winCount: b.outcomes.filter(o => o === 1).length,
    predictedAvg: b.predicted.length > 0
      ? b.predicted.reduce((s, v) => s + v, 0) / b.predicted.length
      : (i + 0.5) / 10,
    actualWinRate: b.predicted.length > 0
      ? b.outcomes.filter(o => o === 1).length / b.predicted.length
      : 0,
    calibrationError: 0, // filled below
    periodStart,
    periodEnd,
  }));

  for (const r of results) {
    r.calibrationError = r.predictedAvg - r.actualWinRate;
  }

  // Persist to DB (replace previous calibration results)
  await prisma.calibrationResult.deleteMany({});
  await prisma.calibrationResult.createMany({ data: results });

  // Log calibration report
  const report = results
    .filter(r => r.positionCount > 0)
    .map(r => `  ${r.bucketLabel}: ${r.positionCount} positions, predicted ${(r.predictedAvg * 100).toFixed(1)}%, actual ${(r.actualWinRate * 100).toFixed(1)}%, error ${r.calibrationError > 0 ? '+' : ''}${(r.calibrationError * 100).toFixed(1)}%`)
    .join('\n');

  logger.info({
    totalResolved: resolved.length,
    bucketsWithData: results.filter(r => r.positionCount > 0).length,
  }, `Calibration report:\n${report}`);
}
