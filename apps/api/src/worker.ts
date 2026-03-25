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

// ─── Global error handlers — NEVER let the process crash ───
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, '🚨 Uncaught exception — worker survived');
  sendTelegramAlert(`🚨 APEX worker uncaught exception: ${err.message}`).catch(() => {});
});

process.on('unhandledRejection', (reason: any) => {
  const message = reason?.message || String(reason);
  logger.error({ err: message }, '⚠️ Unhandled rejection — worker survived');
  sendTelegramAlert(`⚠️ APEX worker unhandled rejection: ${message.slice(0, 200)}`).catch(() => {});
});

/** Send a Telegram alert (fire-and-forget, never throws) */
async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch {
    // Silently fail — can't crash the worker trying to report a crash
  }
}

async function main() {
  logger.info('Starting APEX background worker...');

  // ─── Redis connection health monitoring ───
  redis.on('error', (err) => {
    logger.error({ err: err.message }, 'Redis connection error — will auto-reconnect');
  });
  redis.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  // ─── Postgres connection health check ───
  try {
    await syncPrisma.$queryRaw`SELECT 1`;
    logger.info('Postgres connection verified');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Postgres connection failed — will retry on first job');
  }

  const workers = startWorkers();
  await registerJobs();

  logger.info('Worker running — processing sync, arb scan, and signal jobs');

  // Send startup Telegram alert
  await sendTelegramAlert('🚀 APEX worker started. All systems operational.');

  // ─── Periodic health check (every 5 minutes) ───
  setInterval(async () => {
    try {
      await syncPrisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Postgres health check failed — attempting reconnect');
      try {
        await syncPrisma.$disconnect();
        await syncPrisma.$connect();
        logger.info('Postgres reconnected successfully');
      } catch {
        logger.error('Postgres reconnect failed — jobs will retry on next cycle');
      }
    }
  }, 300000); // 5 minutes

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Worker received ${signal}, shutting down...`);
    await sendTelegramAlert(`🛑 APEX worker shutting down (${signal})`);
    try {
      await workers.ingestionWorker.close();
      await workers.analysisWorker.close();
      await workers.arbWorker.close();
      await workers.maintenanceWorker.close();
    } catch { /* ignore close errors */ }
    await syncPrisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'Worker failed to start');
  sendTelegramAlert(`🚨 APEX worker failed to start: ${err.message}`).then(() => process.exit(1));
});
