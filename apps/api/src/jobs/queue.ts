import { Queue } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { JOB_SCHEDULES } from '@apex/shared';

// ── Queues ──
export const ingestionQueue = new Queue('ingestion', { connection: bullmqConnection });
export const analysisQueue = new Queue('analysis', { connection: bullmqConnection });  // RESEARCH mode (15 min)
export const speedQueue = new Queue('speed', { connection: bullmqConnection });        // SPEED mode (30 sec)
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

  // ─ SPEED mode: 30-second cycle for latency-sensitive signals ─
  // Runs SPEEDEX, CRYPTEX, ARBEX, FLOWEX on short-duration markets
  await speedQueue.upsertJobScheduler(
    'speed-pipeline',
    { every: 30000 }, // 30 seconds
    { name: 'speed-pipeline' }
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

  // ─ Learning Loop: weekly model retraining + calibration ─
  // Runs Sunday 2 AM UTC — processes all resolved markets, retrains FeatureModel,
  // updates calibration table. Without this, every LLM credit is wasted.
  await maintenanceQueue.upsertJobScheduler(
    'learning-loop',
    { pattern: '0 2 * * 0' }, // Sunday 2 AM UTC
    { name: 'learning-loop' }
  );

  // ─ Weekly backtest: populates ModuleScore records for weight-update ─
  await maintenanceQueue.upsertJobScheduler(
    'backtest',
    { pattern: '0 4 * * 0' }, // Sunday 4 AM UTC (after learning loop)
    { name: 'backtest' }
  );

  // ─ Paper position updates: every 5 min ─
  // Keeps paper P&L current with live market prices
  await maintenanceQueue.upsertJobScheduler(
    'paper-position-update',
    { every: 300000 }, // 5 minutes
    { name: 'paper-position-update' }
  );

  // ─ Position reconciliation: every 5 min ─
  // Closes resolved positions, calculates final P&L
  await maintenanceQueue.upsertJobScheduler(
    'position-reconciliation',
    { every: 300000 }, // 5 minutes
    { name: 'position-reconciliation' }
  );

  // Nightly Postgres backup: 3 AM UTC (11 PM ET)
  await maintenanceQueue.upsertJobScheduler(
    'backup',
    { pattern: '0 3 * * *' },
    { name: 'backup' }
  );

  // ─ Intelligence ─
  // SIGINT wallet profiling: every 1 hour
  await analysisQueue.upsertJobScheduler(
    'sigint-profiling',
    { every: 3600000 }, // 1 hour
    { name: 'sigint-profiling' }
  );

  // NEXUS causal graph: every 6 hours
  await analysisQueue.upsertJobScheduler(
    'nexus-graph',
    { every: 21600000 }, // 6 hours
    { name: 'nexus-graph' }
  );

  logger.info({
    jobs: [
      'market-sync (5m)', 'orderbook-sync (5m)', 'news-ingest (5m)',
      'signal-pipeline/RESEARCH (15m)', 'speed-pipeline/SPEED (30s)', 'arb-scan (60s)',
      'sigint-profiling (1h)', 'nexus-graph (6h)',
      'learning-loop (weekly Sun 2AM)', 'backtest (weekly Sun 4AM)',
      'paper-position-update (5m)', 'position-reconciliation (5m)',
      'daily-digest (8AM ET)', 'data-retention (24h)', 'weight-update (1h)', 'backup (3AM UTC)',
    ],
  }, 'Registered all repeatable jobs (RESEARCH + SPEED dual mode + learning loop)');
}

// ── Get Queue Stats ──
export async function getQueueStats() {
  const queues = [
    { name: 'ingestion', queue: ingestionQueue },
    { name: 'analysis (RESEARCH)', queue: analysisQueue },
    { name: 'speed (SPEED)', queue: speedQueue },
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
