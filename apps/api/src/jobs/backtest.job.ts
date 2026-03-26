import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { runBacktest } from '../services/backtest-engine';

/**
 * Weekly backtest: run on resolved markets and populate ModuleScore records.
 * These scores feed the weight-update job for module weight recalculation.
 */
export async function handleBacktest(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Weekly backtest started');

  const results = await runBacktest(90); // 90-day rolling window

  logger.info({
    totalMarkets: results.overall.totalMarkets,
    brierScore: results.overall.brierScore.toFixed(4),
    hitRate: (results.overall.hitRate * 100).toFixed(1) + '%',
    modules: results.byModule.length,
    pnlReturn: (results.pnlSimulation.totalReturn * 100).toFixed(1) + '%',
    maxDrawdown: (results.pnlSimulation.maxDrawdown * 100).toFixed(1) + '%',
  }, 'Weekly backtest complete');
}
