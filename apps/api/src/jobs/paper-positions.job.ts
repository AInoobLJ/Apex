import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { updatePaperPositions } from '../services/paper-trader';
import { reconcilePositions } from '../services/position-sync';

/**
 * Every 5 minutes: update paper positions with current market prices.
 * Paper positions must have current prices and P&L updated, not just created and forgotten.
 */
export async function handlePaperPositionUpdate(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Paper position update started');
  const updated = await updatePaperPositions();
  logger.info({ updated }, 'Paper position update complete');
}

/**
 * Every 5 minutes: reconcile positions — close resolved markets, calculate final P&L.
 */
export async function handlePositionReconciliation(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Position reconciliation started');
  const result = await reconcilePositions();
  logger.info({ synced: result.synced, drifts: result.drifts.length, errors: result.errors.length }, 'Position reconciliation complete');
}
