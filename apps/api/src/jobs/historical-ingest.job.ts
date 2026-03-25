import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { PolymarketClient } from '../services/polymarket-client';
import { KalshiClient } from '../services/kalshi-client';
import type { NormalizedMarket } from '@apex/shared';

/**
 * One-shot job: ingest resolved markets from both platforms for historical backtest.
 * Upserts into Market table with resolution data.
 */
export async function ingestHistoricalMarkets(): Promise<{ polymarket: number; kalshi: number }> {
  const polyClient = new PolymarketClient();
  const kalshiClient = new KalshiClient();

  let polyCount = 0;
  let kalshiCount = 0;

  // Polymarket resolved markets
  try {
    logger.info('Fetching resolved markets from Polymarket...');
    const polyMarkets = await polyClient.fetchResolvedMarkets(2000);
    logger.info({ count: polyMarkets.length }, 'Polymarket resolved markets fetched');
    polyCount = await upsertMarkets(polyMarkets);
  } catch (err) {
    logger.error(err, 'Polymarket historical ingest failed');
  }

  // Kalshi resolved markets
  try {
    logger.info('Fetching resolved markets from Kalshi...');
    const kalshiMarkets = await kalshiClient.fetchResolvedMarkets(1000);
    logger.info({ count: kalshiMarkets.length }, 'Kalshi resolved markets fetched');
    kalshiCount = await upsertMarkets(kalshiMarkets);
  } catch (err) {
    logger.error(err, 'Kalshi historical ingest failed');
  }

  logger.info({ polymarket: polyCount, kalshi: kalshiCount }, 'Historical ingest complete');
  return { polymarket: polyCount, kalshi: kalshiCount };
}

async function upsertMarkets(markets: NormalizedMarket[]): Promise<number> {
  let count = 0;

  for (const m of markets) {
    if (!m.resolution || !m.platformMarketId) continue;

    try {
      const market = await prisma.market.upsert({
        where: {
          platform_platformMarketId: {
            platform: m.platform as 'KALSHI' | 'POLYMARKET',
            platformMarketId: m.platformMarketId,
          },
        },
        create: {
          platform: m.platform as 'KALSHI' | 'POLYMARKET',
          platformMarketId: m.platformMarketId,
          title: m.title,
          description: m.description,
          category: m.category as any,
          status: 'RESOLVED',
          resolution: m.resolution as any,
          resolutionText: m.resolutionText,
          closesAt: m.closesAt,
          volume: m.volume,
          liquidity: m.liquidity,
        },
        update: {
          status: 'RESOLVED',
          resolution: m.resolution as any,
          resolutionText: m.resolutionText,
          volume: m.volume,
        },
      });

      // Upsert YES contract with last traded price
      const yesContract = m.contracts.find(c => c.outcome === 'YES');
      if (yesContract) {
        await prisma.contract.upsert({
          where: {
            marketId_outcome: { marketId: market.id, outcome: 'YES' },
          },
          create: {
            marketId: market.id,
            platformContractId: yesContract.platformContractId,
            outcome: 'YES',
            lastPrice: yesContract.lastPrice,
          },
          update: {
            lastPrice: yesContract.lastPrice,
          },
        });
      }

      const noContract = m.contracts.find(c => c.outcome === 'NO');
      if (noContract) {
        await prisma.contract.upsert({
          where: {
            marketId_outcome: { marketId: market.id, outcome: 'NO' },
          },
          create: {
            marketId: market.id,
            platformContractId: noContract.platformContractId,
            outcome: 'NO',
            lastPrice: noContract.lastPrice,
          },
          update: {
            lastPrice: noContract.lastPrice,
          },
        });
      }

      count++;
    } catch (err) {
      // Skip individual failures (unique constraint, etc.)
      logger.debug({ err: (err as Error).message, title: m.title?.slice(0, 50) }, 'Market upsert skipped');
    }
  }

  return count;
}
