import { Queue } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { JOB_SCHEDULES } from '@apex/shared';

// ── Queues ──
export const ingestionQueue = new Queue('ingestion', { connection: bullmqConnection });
export const analysisQueue = new Queue('analysis', { connection: bullmqConnection });
export const arbQueue = new Queue('arb-scan', { connection: bullmqConnection });
export const maintenanceQueue = new Queue('maintenance', { connection: bullmqConnection });

// ── Register Repeatable Jobs ──
export async function registerJobs() {
  // ─ Ingestion ─
  // Market sync: every 5 min
  await ingestionQueue.upsertJobScheduler(
    'market-sync',
    { every: JOB_SCHEDULES.MARKET_SYNC },
    { name: 'market-sync' }
  );

  // Orderbook sync: every 5 min
  await ingestionQueue.upsertJobScheduler(
    'orderbook-sync',
    { every: JOB_SCHEDULES.ORDERBOOK_SYNC },
    { name: 'orderbook-sync' }
  );

  // News ingest: every 5 min
  await ingestionQueue.upsertJobScheduler(
    'news-ingest',
    { every: JOB_SCHEDULES.NEWS_INGEST },
    { name: 'news-ingest' }
  );

  // ─ Analysis ─
  // Signal pipeline: every 15 min
  await analysisQueue.upsertJobScheduler(
    'signal-pipeline',
    { every: JOB_SCHEDULES.SIGNAL_PIPELINE },
    { name: 'signal-pipeline' }
  );

  // ─ Arb scan: every 60 seconds ─
  await arbQueue.upsertJobScheduler(
    'arb-scan',
    { every: JOB_SCHEDULES.ARB_SCAN },
    { name: 'arb-scan' }
  );

  // ─ Maintenance ─
  // Daily digest Telegram: 8 AM ET (13:00 UTC)
  await maintenanceQueue.upsertJobScheduler(
    'daily-digest',
    { pattern: JOB_SCHEDULES.DAILY_DIGEST as string },
    { name: 'daily-digest' }
  );

  // Data retention: daily cleanup
  await maintenanceQueue.upsertJobScheduler(
    'data-retention',
    { every: JOB_SCHEDULES.DATA_RETENTION },
    { name: 'data-retention' }
  );

  // Weight update: hourly module weight recalculation
  await maintenanceQueue.upsertJobScheduler(
    'weight-update',
    { every: JOB_SCHEDULES.WEIGHT_UPDATE },
    { name: 'weight-update' }
  );

  logger.info({
    jobs: [
      'market-sync (5m)', 'orderbook-sync (5m)', 'news-ingest (5m)',
      'signal-pipeline (15m)', 'arb-scan (60s)',
      'daily-digest (8AM ET)', 'data-retention (24h)', 'weight-update (1h)',
    ],
  }, 'Registered all repeatable jobs');
}

// ── Get Queue Stats ──
export async function getQueueStats() {
  const queues = [
    { name: 'ingestion', queue: ingestionQueue },
    { name: 'analysis', queue: analysisQueue },
    { name: 'arb-scan', queue: arbQueue },
    { name: 'maintenance', queue: maintenanceQueue },
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
