import { syncPrisma as prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export interface Inconsistency {
  fromMarketId: string;
  fromTitle: string;
  toMarketId: string;
  toTitle: string;
  relationType: string;
  impliedConstraint: string;
  violation: number; // magnitude of inconsistency
}

/**
 * Check for logical inconsistencies in the causal graph.
 * Validates joint probability constraints between related markets.
 */
export async function checkConsistency(): Promise<Inconsistency[]> {
  const inconsistencies: Inconsistency[] = [];

  const edges = await prisma.causalEdge.findMany({
    where: { strength: { gte: 0.5 } }, // Only check strong links
  });

  for (const edge of edges) {
    const [fromContract, toContract] = await Promise.all([
      prisma.contract.findFirst({ where: { marketId: edge.fromMarketId, outcome: 'YES' }, select: { lastPrice: true } }),
      prisma.contract.findFirst({ where: { marketId: edge.toMarketId, outcome: 'YES' }, select: { lastPrice: true } }),
    ]);

    if (!fromContract?.lastPrice || !toContract?.lastPrice) continue;

    const pA = fromContract.lastPrice;
    const pB = toContract.lastPrice;

    // Check constraint based on relationship type
    let violation = 0;
    let constraint = '';

    if (edge.relationType === 'CONDITIONAL_ON') {
      // If B is conditional on A, then P(B) <= P(A)
      if (pB > pA + 0.05) {
        violation = pB - pA;
        constraint = `P(B|A conditional) = ${(pB * 100).toFixed(1)}% > P(A) = ${(pA * 100).toFixed(1)}%`;
      }
    } else if (edge.relationType === 'CAUSES' && edge.directionality > 0.5) {
      // If A causes B positively, they should be correlated
      // A large gap where A is high but B is low suggests mispricing
      if (pA > 0.7 && pB < 0.3) {
        violation = pA - pB;
        constraint = `A causes B but P(A)=${(pA * 100).toFixed(1)}% while P(B)=${(pB * 100).toFixed(1)}%`;
      }
    }

    if (violation > 0.10) {
      const [fromMarket, toMarket] = await Promise.all([
        prisma.market.findUnique({ where: { id: edge.fromMarketId }, select: { title: true } }),
        prisma.market.findUnique({ where: { id: edge.toMarketId }, select: { title: true } }),
      ]);

      inconsistencies.push({
        fromMarketId: edge.fromMarketId,
        fromTitle: fromMarket?.title ?? '',
        toMarketId: edge.toMarketId,
        toTitle: toMarket?.title ?? '',
        relationType: edge.relationType,
        impliedConstraint: constraint,
        violation,
      });
    }
  }

  if (inconsistencies.length > 0) {
    logger.info({ count: inconsistencies.length }, 'Causal inconsistencies detected');
  }

  return inconsistencies;
}
