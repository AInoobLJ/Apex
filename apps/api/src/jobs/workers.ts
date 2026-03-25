import { Worker } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { handleMarketSync } from './market-sync.job';
import { handleOrderBookSync } from './orderbook-sync.job';
import { handleSignalPipeline } from './signal-pipeline.job';
import { handleArbScan } from './arb-scan.job';

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
      // Don't rethrow — BullMQ will mark it as failed but worker stays alive
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

  // Worker-level error handlers (catches BullMQ internal errors)
  for (const [name, worker] of [
    ['ingestion', ingestionWorker],
    ['analysis', analysisWorker],
    ['arb-scan', arbWorker],
  ] as const) {
    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, `${name} job failed`);
    });
    worker.on('error', (err) => {
      logger.error({ err: err.message }, `${name} worker error — will continue`);
    });
  }

  logger.info('BullMQ workers started (with safe error handling)');

  return { ingestionWorker, analysisWorker, arbWorker };
}
