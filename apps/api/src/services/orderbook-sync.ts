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
  let skippedNoAdapter = 0;

  // Get top markets by volume (not all 36K)
  const markets = await prisma.market.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { volume: 'desc' },
    take: MAX_ORDERBOOKS_PER_PLATFORM * 2, // enough for both platforms
    include: { contracts: true },
  });

  logger.info({ marketCount: markets.length, platforms: [...new Set(markets.map(m => m.platform))] }, 'Order book sync: fetched markets');

  for (const market of markets) {
    const adapter = adaptersByPlatform[market.platform];
    if (!adapter) { skippedNoAdapter++; continue; }

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
        let contractsSynced = 0;
        for (const contract of market.contracts) {
          try {
            const rawBook = await adapter.getOrderbook(contract.platformContractId);
            const normalized = adapter.normalizeOrderbook(rawBook);

            const snap = await prisma.orderBookSnapshot.create({
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
            contractsSynced++;
            if (synced === 0 && contractsSynced === 1) {
              logger.info({ snapId: snap.id, contractId: contract.id, spread: normalized.spread, midPrice: normalized.midPrice }, 'Order book sync: first snapshot created');
            }
          } catch (contractErr) {
            errors++;
            if (errors <= 3) {
              logger.error({ contractId: contract.id, platform: market.platform, errMsg: (contractErr as Error).message }, 'Order book sync: contract-level error');
            }
          }
        }
        synced++;
      }

      // Yield event loop
      if (synced % 10 === 0) await new Promise(r => setImmediate(r));
    } catch (err) {
      errors++;
      logger.error({ err, platform: market.platform, marketId: market.platformMarketId, errMsg: (err as Error).message }, `Failed to sync order book for ${market.platform}:${market.platformMarketId}`);
    }
  }

  if (errors > 0) {
    logger.warn({ synced, errors, skippedNoAdapter, total: markets.length }, 'Order book sync completed with errors — platform API may be failing');
  } else {
    logger.info({ synced, errors, skippedNoAdapter, total: markets.length }, 'Order book sync completed');
  }
  return synced;
}
