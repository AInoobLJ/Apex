import { Job } from 'bullmq';
import { runOrderBookSync } from '../services/orderbook-sync';
import { logger } from '../lib/logger';

export async function handleOrderBookSync(job: Job): Promise<{ synced: number }> {
  logger.info({ jobId: job.id }, 'Order book sync job started');

  const synced = await runOrderBookSync();
  if (synced === 0) {
    logger.warn({ jobId: job.id }, 'Order book sync completed with 0 snapshots — check platform API connectivity');
  } else {
    logger.info({ synced }, 'Order book sync job completed');
  }
  return { synced };
}
