import { Queue } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { JOB_SCHEDULES } from '@apex/shared';

// ── Queues ──
export const ingestionQueue = new Queue('ingestion', { connection: bullmqConnection });
export const analysisQueue = new Queue('analysis', { connection: bullmqConnection });
export const arbQueue = new Queue('arb-scan', { connection: bullmqConnection });

// ── Register Repeatable Jobs ──
export async function registerJobs() {
  // Market sync: every 5 min
  await ingestionQueue.upsertJobScheduler(
    'market-sync',
    { every: JOB_SCHEDULES.MARKET_SYNC },
    { name: 'market-sync' }
  );

  // Orderbook sync: every 5 min (offset handled by execution time)
  await ingestionQueue.upsertJobScheduler(
    'orderbook-sync',
    { every: JOB_SCHEDULES.ORDERBOOK_SYNC },
    { name: 'orderbook-sync' }
  );

  // Signal pipeline: every 15 min
  await analysisQueue.upsertJobScheduler(
    'signal-pipeline',
    { every: JOB_SCHEDULES.SIGNAL_PIPELINE },
    { name: 'signal-pipeline' }
  );

  // Arb scan: every 60 seconds
  await arbQueue.upsertJobScheduler(
    'arb-scan',
    { every: JOB_SCHEDULES.ARB_SCAN },
    { name: 'arb-scan' }
  );

  logger.info('Registered repeatable jobs');
}

// ── Get Queue Stats ──
export async function getQueueStats() {
  const queues = [
    { name: 'ingestion', queue: ingestionQueue },
    { name: 'analysis', queue: analysisQueue },
    { name: 'arb-scan', queue: arbQueue },
  ];

  return Promise.all(
    queues.map(async ({ name, queue }) => {
      const [active, waiting, completed, failed, delayed] = await Promise.all([
        queue.getActiveCount(),
        queue.getWaitingCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);
      return { name, active, waiting, completed, failed, delayed };
    })
  );
}
