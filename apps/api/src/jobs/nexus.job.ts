import type { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { buildCausalGraph } from '../modules/nexus/graph-builder';
import { computeCorrelations } from '../modules/nexus/correlation-matrix';
import { checkConsistency } from '../modules/nexus/consistency-checker';
import type { Prisma } from '@apex/db';

/**
 * NEXUS job: builds causal graph between markets, computes correlations,
 * and detects inconsistencies in related market pricing.
 * Runs every 6 hours.
 */
export async function handleNexusJob(_job: Job): Promise<void> {
  logger.info('NEXUS: starting causal graph rebuild');

  try {
    // Step 1: Build/update causal graph relationships via LLM
    const graphCount = await buildCausalGraph().catch((err: Error) => {
      logger.warn({ err: err.message }, 'NEXUS: causal graph building failed');
      return 0;
    });
    logger.info({ relationships: graphCount }, 'NEXUS: causal graph updated');

    // Step 2: Compute correlation matrix from price history
    const correlations = await computeCorrelations().catch((err: Error) => {
      logger.warn({ err: err.message }, 'NEXUS: correlation matrix failed');
      return [];
    });
    logger.info({ correlationPairs: correlations.length }, 'NEXUS: correlation matrix computed');

    // Step 3: Check for inconsistencies (related markets priced inconsistently)
    const inconsistencies = await checkConsistency().catch((err: Error) => {
      logger.warn({ err: err.message }, 'NEXUS: consistency check failed');
      return [];
    });

    // Step 4: Persist inconsistency signals — convert from Inconsistency to Signal
    for (const incon of inconsistencies) {
      if (incon.violation < 0.05) continue; // Only flag significant inconsistencies

      // Create signals on both related markets
      for (const marketId of [incon.fromMarketId, incon.toMarketId]) {
        await prisma.signal.create({
          data: {
            moduleId: 'NEXUS',
            marketId,
            probability: 0.5, // NEXUS flags mispricing, doesn't estimate probability
            confidence: Math.min(0.6, incon.violation * 2),
            reasoning: `NEXUS inconsistency: "${incon.fromTitle}" ↔ "${incon.toTitle}" (${incon.relationType}). Violation magnitude: ${(incon.violation * 100).toFixed(1)}%. ${incon.impliedConstraint}`,
            metadata: JSON.parse(JSON.stringify(incon)) as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          },
        });
      }
    }

    logger.info({
      graph: graphCount,
      correlations: correlations.length,
      inconsistencies: inconsistencies.length,
    }, 'NEXUS: cycle complete');
  } catch (err) {
    logger.error({ err }, 'NEXUS job failed');
    throw err;
  }
}
