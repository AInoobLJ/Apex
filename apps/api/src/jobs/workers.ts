import { Worker } from 'bullmq';
import { bullmqConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { handleMarketSync } from './market-sync.job';
import { handleOrderBookSync } from './orderbook-sync.job';
import { handleSignalPipeline } from './signal-pipeline.job';
import { handleArbScan } from './arb-scan.job';

export function startWorkers() {
  const ingestionWorker = new Worker(
    'ingestion',
    async (job) => {
      switch (job.name) {
        case 'market-sync':
          return handleMarketSync(job);
        case 'orderbook-sync':
          return handleOrderBookSync(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown ingestion job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 300000, // 5 min lock — market sync can take a while
      stalledInterval: 120000, // Check for stalled jobs every 2 min
    }
  );

  const analysisWorker = new Worker(
    'analysis',
    async (job) => {
      switch (job.name) {
        case 'signal-pipeline':
          return handleSignalPipeline(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown analysis job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 600000, // 10 min lock — signal pipeline with LLM calls takes time
      stalledInterval: 300000, // Check stalled every 5 min
    }
  );

  const arbWorker = new Worker(
    'arb-scan',
    async (job) => {
      switch (job.name) {
        case 'arb-scan':
          return handleArbScan(job);
        default:
          logger.warn({ jobName: job.name }, 'Unknown arb-scan job');
      }
    },
    {
      connection: bullmqConnection,
      concurrency: 1,
      lockDuration: 120000, // 2 min lock — arb scan is fast
      stalledInterval: 60000,
    }
  );

  ingestionWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Ingestion job failed');
  });

  analysisWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Analysis job failed');
  });

  arbWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Arb scan job failed');
  });

  logger.info('BullMQ workers started');

  return { ingestionWorker, analysisWorker, arbWorker };
}
