import { config } from './config';
import { buildServer } from './server';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { registerJobs } from './jobs/queue';
import { startWorkers } from './jobs/workers';

async function main() {
  const server = await buildServer();

  // Start server FIRST so it can respond immediately
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    logger.info(`APEX API running on http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    logger.fatal(err, 'Failed to start server');
    process.exit(1);
  }

  // Start Binance WebSocket for real-time crypto prices (SPEEDEX)
  if (config.BINANCE_WS_ENABLED) {
    const { binanceWs } = await import('./services/data-sources/binance-ws');
    binanceWs.start();
  }

  // Workers disabled in main process — sync blocks the API event loop.
  // Run sync separately: npx tsx src/run-sync.ts
  logger.info('API-only mode — run "npx tsx src/run-sync.ts" to sync markets');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    await server.close();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
