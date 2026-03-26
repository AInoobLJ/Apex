/**
 * SPEED Pipeline — 30-second cycle for latency-sensitive signals.
 *
 * Runs: SPEEDEX, CRYPTEX, ARBEX, FLOWEX
 * Target: markets resolving within 24 hours (crypto hourly, short-duration)
 * No LLM calls — pure math, fast execution.
 */
import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// Import speed modules
import { speedexModule } from '../modules/speedex';
import { flowexModule } from '../modules/flowex';

// Types
import type { SignalOutput } from '@apex/shared';

const MAX_SPEED_MARKETS = 50; // Process top 50 short-duration markets per cycle

export async function handleSpeedPipeline(job: Job): Promise<void> {
  const start = Date.now();

  try {
    // Fetch markets resolving within 24 hours with prices between 5-95%
    const markets = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        closesAt: {
          gt: new Date(),
          lt: new Date(Date.now() + 24 * 3600000), // within 24 hours
        },
      },
      include: {
        contracts: { where: { outcome: 'YES' } },
      },
      orderBy: { closesAt: 'asc' }, // soonest first
      take: MAX_SPEED_MARKETS,
    });

    if (markets.length === 0) {
      logger.debug('Speed pipeline: no short-duration markets found');
      return;
    }

    let signalCount = 0;

    for (const market of markets) {
      const yesContract = market.contracts[0];
      if (!yesContract?.lastPrice) continue;
      if (yesContract.lastPrice < 0.05 || yesContract.lastPrice > 0.95) continue;

      const marketData = {
        id: market.id,
        title: market.title,
        description: market.description,
        category: market.category,
        platform: market.platform,
        platformMarketId: market.platformMarketId,
        closesAt: market.closesAt,
        volume: market.volume,
        liquidity: market.liquidity,
        contracts: market.contracts.map((c: any) => ({
          outcome: c.outcome,
          lastPrice: c.lastPrice,
          bestBid: c.bestBid,
          bestAsk: c.bestAsk,
          volume: c.volume,
        })),
      };

      // Run speed modules in parallel (no LLM, fast)
      const [speedexResult, flowexResult] = await Promise.allSettled([
        speedexModule.run(marketData as any),
        flowexModule.run(marketData as any),
      ]);

      const signals: SignalOutput[] = [];
      if (speedexResult.status === 'fulfilled' && speedexResult.value) signals.push(speedexResult.value);
      if (flowexResult.status === 'fulfilled' && flowexResult.value) signals.push(flowexResult.value);

      // Persist signals
      for (const signal of signals) {
        try {
          await prisma.signal.create({
            data: {
              marketId: signal.marketId,
              moduleId: signal.moduleId,
              probability: signal.probability,
              confidence: signal.confidence,
              reasoning: signal.reasoning || '',
              metadata: signal.metadata as any || {},
              expiresAt: signal.expiresAt ? new Date(signal.expiresAt) : new Date(Date.now() + 300000),
            },
          });
          signalCount++;
        } catch (err: any) {
          logger.debug({ err: err.message, moduleId: signal.moduleId, marketId: market.id }, 'Speed signal persist failed');
        }
      }
    }

    const elapsed = Date.now() - start;
    if (signalCount > 0) {
      logger.info({ markets: markets.length, signals: signalCount, elapsed }, 'Speed pipeline complete');
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Speed pipeline failed');
    throw err;
  }
}
