/**
 * CalibrationEngine — adjusts probabilities based on historical module accuracy.
 * Uses MNEMEX memory (ModuleScore, MistakeMemory) to correct systematic biases.
 */
import { prisma } from '../../lib/prisma';

interface CalibrationResult {
  originalProbability: number;
  calibratedProbability: number;
  adjustments: { factor: string; delta: number }[];
}

/**
 * Calibrate a fused probability based on historical performance data.
 * Corrections applied:
 * 1. Module-specific bias correction (if a module consistently over/under-predicts)
 * 2. Category base rate adjustment
 * 3. Confidence-scaled mean reversion toward market price
 */
export async function calibrate(params: {
  fusedProbability: number;
  confidence: number;
  marketPrice: number;
  category: string;
  dominantModule: string;
}): Promise<CalibrationResult> {
  const { fusedProbability, confidence, marketPrice, category, dominantModule } = params;
  let calibrated = fusedProbability;
  const adjustments: CalibrationResult['adjustments'] = [];

  // 1. Check module bias from historical ModuleScores
  const moduleScore = await prisma.moduleScore.findFirst({
    where: { moduleId: dominantModule, category },
    orderBy: { periodEnd: 'desc' },
  });

  if (moduleScore && moduleScore.sampleSize >= 10) {
    // If module's Brier score > 0.25, it's poorly calibrated — pull toward market price
    if (moduleScore.brierScore > 0.25) {
      const biasCorrection = (marketPrice - calibrated) * 0.3; // 30% pull toward market
      calibrated += biasCorrection;
      adjustments.push({ factor: `${dominantModule} bias correction`, delta: biasCorrection });
    }
  }

  // 2. Category base rate: check MarketMemory for base rates
  const memories = await prisma.marketMemory.findMany({
    where: { category: category as any },
  });
  if (memories.length > 0) {
    const avgBaseRate = memories.reduce((s, m) => s + m.baseRate, 0) / memories.length;
    // Pull 10% toward base rate for low-confidence estimates
    if (confidence < 0.3) {
      const baseRatePull = (avgBaseRate - calibrated) * 0.1;
      calibrated += baseRatePull;
      adjustments.push({ factor: 'Base rate anchor', delta: baseRatePull });
    }
  }

  // 3. Confidence-scaled mean reversion toward market
  // Low confidence → trust market more; high confidence → trust our estimate
  if (confidence < 0.5) {
    const marketPull = (marketPrice - calibrated) * (0.5 - confidence);
    calibrated += marketPull;
    adjustments.push({ factor: 'Market mean reversion', delta: marketPull });
  }

  // Clamp
  calibrated = Math.max(0.01, Math.min(0.99, calibrated));

  return {
    originalProbability: fusedProbability,
    calibratedProbability: calibrated,
    adjustments,
  };
}
