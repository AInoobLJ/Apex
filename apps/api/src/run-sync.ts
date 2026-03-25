/**
 * Standalone market + orderbook sync runner.
 * Run separately from the API: npx tsx src/run-sync.ts
 */
import { logger } from './lib/logger';
import { runMarketSync } from './services/market-sync';
import { runOrderBookSync } from './services/orderbook-sync';
import { syncPrisma } from './lib/prisma';

async function main() {
  const start = Date.now();

  // Market sync
  logger.info('Starting market sync...');
  try {
    const result = await runMarketSync();
    logger.info({ result }, 'Market sync completed');
  } catch (err) {
    logger.error(err, 'Market sync failed');
  }

  // Orderbook sync (top markets only)
  logger.info('Starting orderbook sync...');
  try {
    const synced = await runOrderBookSync();
    logger.info({ synced }, 'Orderbook sync completed');
  } catch (err) {
    logger.error(err, 'Orderbook sync failed');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info({ elapsed: `${elapsed}s` }, 'Full sync completed');

  await syncPrisma.$disconnect();
  process.exit(0);
}

main();
