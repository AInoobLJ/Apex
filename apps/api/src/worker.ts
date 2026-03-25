/**
 * Standalone background worker process.
 * Runs market sync, orderbook sync, arb scan, and signal pipeline
 * in a SEPARATE process from the API server.
 *
 * Start: npx tsx src/worker.ts
 * Or via npm script: npm run worker
 */
import { config } from './config';
import { logger } from './lib/logger';
import { syncPrisma } from './lib/prisma';
import { redis } from './lib/redis';
import { registerJobs } from './jobs/queue';
import { startWorkers } from './jobs/workers';

async function main() {
  logger.info('Starting APEX background worker...');

  const workers = startWorkers();
  await registerJobs();

  logger.info('Worker running — processing sync, arb scan, and signal jobs');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Worker received ${signal}, shutting down...`);
    await workers.ingestionWorker.close();
    await workers.analysisWorker.close();
    await workers.arbWorker.close();
    await syncPrisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
