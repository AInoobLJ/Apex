import { Worker } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { handleMarketSync } from './market-sync.job';
import { handleOrderBookSync } from './orderbook-sync.job';
import { handleSignalPipeline } from './signal-pipeline.job';
import { handleArbScan } from './arb-scan.job';
import { handleNewsIngest } from './news-ingest.job';
import { handleDailyDigest } from './daily-digest.job';
import { handleDataRetention } from './data-retention.job';
import { handleWeightUpdate } from './weight-update.job';
import { handleSigintJob } from './sigint.job';
import { handleNexusJob } from './nexus.job';
import { handleSpeedPipeline } from './speed-pipeline.job';
import { handleBackup } from './backup.job';

/**
 * Wrap any job handler in try/catch so a single job failure
 * never crashes the worker process.
 */
function safeHandler(name: string, handler: (job: any) => Promise<any>) {
  return async (job: any) => {
    try {
      return await handler(job);
    } catch (err: any) {
      logger.error({ jobName: name, jobId: job?.id, err: err.message, stack: err.stack?.slice(0, 500) },
        `Job ${name} failed — worker survived`);
      // Rethrow so BullMQ properly marks as failed (worker process won't crash
      // because BullMQ catches this internally and triggers the 'failed' event)
      throw err;
    }
  };
}

export function startWorkers() {
  const ingestionWorker = new Worker(
    'ingestion',
    async (job) => {
      switch (job.name) {
        case 'market-sync':
          return safeHandler('market-sync', handleMarketSync)(job);
        case 'orderbook-sync':
          return safeHandler('orderbook-sync', handleOrderBookSync)(job);
        case 'news-ingest':
          return safeHandler('news-ingest', handleNewsIngest)(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown ingestion job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 300000,
      stalledInterval: 120000,
    }
  );

  const analysisWorker = new Worker(
    'analysis',
    async (job) => {
      switch (job.name) {
        case 'signal-pipeline':
          return safeHandler('signal-pipeline', handleSignalPipeline)(job);
        case 'sigint-profiling':
          return safeHandler('sigint-profiling', handleSigintJob)(job);
        case 'nexus-graph':
          return safeHandler('nexus-graph', handleNexusJob)(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown analysis job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 600000,
      stalledInterval: 300000,
    }
  );

  // ── SPEED queue: 30-second cycle for latency-sensitive signals ──
  const speedWorker = new Worker(
    'speed',
    async (job) => {
      switch (job.name) {
        case 'speed-pipeline':
          return safeHandler('speed-pipeline', handleSpeedPipeline)(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown speed job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 30000,   // 30 sec lock — must complete fast
      stalledInterval: 15000,
    }
  );

  const arbWorker = new Worker(
    'arb-scan',
    async (job) => {
      switch (job.name) {
        case 'arb-scan':
          return safeHandler('arb-scan', handleArbScan)(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown arb-scan job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 120000,
      stalledInterval: 60000,
    }
  );

  const maintenanceWorker = new Worker(
    'maintenance',
    async (job) => {
      switch (job.name) {
        case 'daily-digest':
          return safeHandler('daily-digest', handleDailyDigest)(job);
        case 'data-retention':
          return safeHandler('data-retention', handleDataRetention)(job);
        case 'weight-update':
          return safeHandler('weight-update', handleWeightUpdate)(job);
        case 'backup':
          return safeHandler('backup', handleBackup)(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown maintenance job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 300000,
      stalledInterval: 120000,
    }
  );

  // Worker-level error handlers
  for (const [name, worker] of [
    ['ingestion', ingestionWorker],
    ['analysis/RESEARCH', analysisWorker],
    ['speed/SPEED', speedWorker],
    ['arb-scan', arbWorker],
    ['maintenance', maintenanceWorker],
  ] as const) {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, `${name} job failed`);
    });
    worker.on('error', (err) => {
      logger.error({ err: err.message }, `${name} worker error — will continue`);
    });
  }

  logger.info('BullMQ workers started: ingestion, analysis/RESEARCH, speed/SPEED, arb-scan, maintenance');

  return { ingestionWorker, analysisWorker, speedWorker, arbWorker, maintenanceWorker };
}
