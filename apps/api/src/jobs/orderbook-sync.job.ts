import { Job } from 'bullmq';
import { runOrderBookSync } from '../services/orderbook-sync';
import { logger } from '../lib/logger';

export async function handleOrderBookSync(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Order book sync job started');

  try {
    const synced = await runOrderBookSync();
    logger.info({ synced }, 'Order book sync job completed');
  } catch (err) {
    logger.error(err, 'Order book sync job failed');
    throw err;
  }
}
