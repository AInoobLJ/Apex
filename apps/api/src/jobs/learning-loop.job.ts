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
