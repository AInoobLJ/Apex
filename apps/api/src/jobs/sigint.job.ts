import type { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { detectSmartMoneyDivergence } from '../modules/sigint/divergence-detector';
import { indexWallets } from '../modules/sigint/wallet-indexer';
import type { Prisma } from '@apex/db';

/**
 * SIGINT job: indexes wallet activity, classifies wallets, and detects smart money divergence.
 * Runs every hour.
 */
export async function handleSigintJob(_job: Job): Promise<void> {
  logger.info('SIGINT: starting wallet profiling cycle');

  try {
    // Step 1: Index new wallet activity from both platforms
    const indexedCount = await indexWallets().catch((err: Error) => {
      logger.warn({ err: err.message }, 'SIGINT: wallet indexing failed — continuing with existing data');
      return 0;
    });
    logger.info({ walletsProcessed: indexedCount }, 'SIGINT: wallet indexing complete');

    // Step 2: Detect smart money divergence signals
    const signals = await detectSmartMoneyDivergence().catch((err: Error) => {
      logger.warn({ err: err.message }, 'SIGINT: divergence detection failed');
      return [];
    });

    // Step 3: Persist signals
    for (const signal of signals) {
      // Deduplication: check if same signal exists recently
      const existing = await prisma.signal.findFirst({
        where: {
          moduleId: 'SIGINT',
          marketId: signal.marketId,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // within last hour
        },
        select: { probability: true },
      });

      if (existing && Math.abs(existing.probability - signal.probability) < 0.01) continue;

      await prisma.signal.create({
        data: {
          moduleId: signal.moduleId,
          marketId: signal.marketId,
          probability: signal.probability,
          confidence: signal.confidence,
          reasoning: signal.reasoning,
          metadata: JSON.parse(JSON.stringify(signal.metadata)) as Prisma.InputJsonValue,
          expiresAt: signal.expiresAt,
        },
      });
    }

    logger.info({ walletsIndexed: indexedCount, signals: signals.length }, 'SIGINT: cycle complete');
  } catch (err) {
    logger.error({ err }, 'SIGINT job failed');
    throw err;
  }
}
