/**
 * SPEED Pipeline — 30-second cycle for latency-sensitive signals.
 *
 * Runs: SPEEDEX + FLOWEX on short-duration crypto markets.
 * Target: markets resolving within 24 hours (crypto hourly/daily brackets + floors)
 * No LLM calls — pure math, fast execution.
 *
 * Signals persist to DB for research pipeline merge (CORTEX fusion).
 * SPEEDEX is included in CORTEX probability fusion and can satisfy the
 * LLM module gate for CRYPTO markets (Black-Scholes is quantitatively rigorous).
 */
import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

// Import speed modules
import { speedexModule } from '../modules/speedex';
import { flowexModule } from '../modules/flowex';

// Types
import type { SignalOutput } from '@apex/shared';

const MAX_SPEED_MARKETS = 50;

export async function handleSpeedPipeline(job: Job): Promise<{ signals: number; positions: number }> {
  const start = Date.now();
  let signalCount = 0;
  const positionCount = 0; // Paper trades disabled — speed pipeline monitoring only

  try {
    const markets = await prisma.market.findMany({
      where: {
        status: 'ACTIVE',
        closesAt: {
          gt: new Date(),
          lt: new Date(Date.now() + 24 * 3600000),
        },
      },
      include: {
        contracts: { where: { outcome: 'YES' } },
      },
      orderBy: { closesAt: 'asc' },
      take: MAX_SPEED_MARKETS,
    });

    if (markets.length === 0) return { signals: 0, positions: 0 };

    let skippedNoContract = 0;
    let skippedPrice = 0;

    for (const market of markets) {
      const yesContract = market.contracts[0];
      // Use lastPrice, fallback to bestBid/bestAsk midpoint, then bestAsk alone
      const contractPrice = yesContract?.lastPrice
        ?? (yesContract?.bestBid && yesContract?.bestAsk ? (yesContract.bestBid + yesContract.bestAsk) / 2 : null)
        ?? yesContract?.bestAsk ?? yesContract?.bestBid ?? null;
      if (!contractPrice) { skippedNoContract++; continue; }
      if (contractPrice < 0.05 || contractPrice > 0.95) { skippedPrice++; continue; }
      // Inject the resolved price so modules can use it
      if (yesContract && !yesContract.lastPrice) (yesContract as any).lastPrice = contractPrice;

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
          platformContractId: c.platformContractId,
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

      // Speed pipeline persists signals to DB. Research pipeline picks them up
      // via mergePreExistingSignals() → CORTEX fusion → trade creation.
    }

    const elapsed = Date.now() - start;
    if (signalCount > 0 || positionCount > 0) {
      logger.info({ markets: markets.length, processed: markets.length - skippedNoContract - skippedPrice, signals: signalCount, positions: positionCount, elapsed }, 'Speed pipeline complete');
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Speed pipeline failed');
    throw err;
  }

  return { signals: signalCount, positions: positionCount };
}
