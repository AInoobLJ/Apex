import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { kalshiClient } from './kalshi-client';
import { polymarketClient } from './polymarket-client';
import type { PredictionMarketAdapter } from '@apex/shared';

const adaptersByPlatform: Record<string, PredictionMarketAdapter> = {
  KALSHI: kalshiClient,
  POLYMARKET: polymarketClient,
};

// Only sync orderbooks for the top N markets by volume per platform
const MAX_ORDERBOOKS_PER_PLATFORM = 50;

export async function runOrderBookSync(): Promise<number> {
  let synced = 0;
  let errors = 0;

  // Get top markets by volume (not all 36K)
  const markets = await prisma.market.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { volume: 'desc' },
    take: MAX_ORDERBOOKS_PER_PLATFORM * 2, // enough for both platforms
    include: { contracts: true },
  });

  for (const market of markets) {
    const adapter = adaptersByPlatform[market.platform];
    if (!adapter) continue;

    try {
      if (market.platform === 'KALSHI') {
        const yesContract = market.contracts.find(c => c.outcome === 'YES');
        if (yesContract) {
          const rawBook = await adapter.getOrderbook(market.platformMarketId);
          const normalized = adapter.normalizeOrderbook(rawBook);

          await prisma.orderBookSnapshot.create({
            data: {
              contractId: yesContract.id,
              bids: normalized.bids,
              asks: normalized.asks,
              spread: normalized.spread,
              midPrice: normalized.midPrice,
              totalBidDepth: normalized.totalBidDepth,
              totalAskDepth: normalized.totalAskDepth,
            },
          });
          synced++;
        }
      } else {
        // Polymarket: fetch orderbook for each contract (YES and NO)
        for (const contract of market.contracts) {
          try {
            const rawBook = await adapter.getOrderbook(contract.platformContractId);
            const normalized = adapter.normalizeOrderbook(rawBook);

            await prisma.orderBookSnapshot.create({
              data: {
                contractId: contract.id,
                bids: normalized.bids,
                asks: normalized.asks,
                spread: normalized.spread,
                midPrice: normalized.midPrice,
                totalBidDepth: normalized.totalBidDepth,
                totalAskDepth: normalized.totalAskDepth,
              },
            });
          } catch {
            errors++;
          }
        }
        synced++;
      }

      // Yield event loop
      if (synced % 10 === 0) await new Promise(r => setImmediate(r));
    } catch (err) {
      errors++;
      logger.error(err, `Failed to sync order book for ${market.platformMarketId}`);
    }
  }

  logger.info({ synced, errors, total: markets.length }, 'Order book sync completed');
  return synced;
}
