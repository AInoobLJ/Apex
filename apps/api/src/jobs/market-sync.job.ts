import { Job } from 'bullmq';
import { runMarketSync } from '../services/market-sync';
import { logger } from '../lib/logger';

export async function handleMarketSync(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Market sync job started');

  try {
    const result = await runMarketSync();
    logger.info(result, 'Market sync job completed');
  } catch (err) {
    logger.error(err, 'Market sync job failed');
    throw err;
  }
}
