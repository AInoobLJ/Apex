import { Job } from 'bullmq';
import { Prisma } from '@apex/db';
import { runArbScan, arbToSignals } from '../modules/arbex';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export async function handleArbScan(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Arb scan job started');

  try {
    const opportunities = await runArbScan();

    if (opportunities.length === 0) {
      logger.info('No arb opportunities found');
      return;
    }

    // Convert to signals and persist
    const signals = arbToSignals(opportunities);

    for (const signal of signals) {
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

    logger.info({
      opportunities: opportunities.length,
      urgent: opportunities.filter(a => a.urgency === 'URGENT').length,
      intra: opportunities.filter(a => a.type === 'INTRA_PLATFORM').length,
      cross: opportunities.filter(a => a.type === 'CROSS_PLATFORM').length,
    }, 'Arb scan job completed');
  } catch (err) {
    logger.error(err, 'Arb scan job failed');
    throw err;
  }
}
