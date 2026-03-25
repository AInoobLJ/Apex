import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Weekly job: recompute module weights based on Brier scores.
 */
export async function handleWeightUpdate(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Weight update job started');

  const since = new Date(Date.now() - 90 * 86400000);

  // Get module scores from recent backtest runs
  const scores = await prisma.moduleScore.findMany({
    where: { periodEnd: { gte: since } },
    orderBy: { periodEnd: 'desc' },
  });

  if (scores.length === 0) {
    logger.info('No module scores available for weight update');
    return;
  }

  // Group by module, compute average Brier
  const moduleAvgs: Record<string, { totalBrier: number; count: number }> = {};
  for (const s of scores) {
    const key = s.moduleId;
    moduleAvgs[key] = moduleAvgs[key] || { totalBrier: 0, count: 0 };
    moduleAvgs[key].totalBrier += s.brierScore;
    moduleAvgs[key].count++;
  }

  const avgBrier = Object.values(moduleAvgs).reduce((s, v) => s + v.totalBrier / v.count, 0) / Object.keys(moduleAvgs).length;
  if (avgBrier === 0) return;

  // Compute accuracy multipliers and update weights
  let updated = 0;
  for (const [moduleId, stats] of Object.entries(moduleAvgs)) {
    const moduleBrier = stats.totalBrier / stats.count;
    const multiplier = moduleBrier > 0 ? avgBrier / moduleBrier : 1; // Lower Brier = higher weight

    const weights = await prisma.moduleWeight.findMany({ where: { moduleId } });
    for (const w of weights) {
      const newWeight = Math.max(0.01, Math.min(0.50, w.weight * multiplier));
      await prisma.moduleWeight.update({
        where: { id: w.id },
        data: { weight: newWeight },
      });
      updated++;
    }
  }

  logger.info({ updated, modules: Object.keys(moduleAvgs).length }, 'Module weights updated');
}
