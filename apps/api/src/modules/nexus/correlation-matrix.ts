import { syncPrisma as prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

interface CorrelationPair {
  marketId1: string;
  marketId2: string;
  correlation: number;
}

/**
 * Compute rolling 30-day price correlations between active market pairs.
 */
export async function computeCorrelations(): Promise<CorrelationPair[]> {
  const since = new Date(Date.now() - 30 * 86400000);

  // Get markets with enough price history
  const markets = await prisma.market.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { volume: 'desc' },
    take: 30, // Top 30 markets
    select: { id: true },
  });

  // Fetch price histories
  const histories: Map<string, number[]> = new Map();
  for (const market of markets) {
    const snapshots = await prisma.priceSnapshot.findMany({
      where: { marketId: market.id, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
      select: { yesPrice: true },
    });
    if (snapshots.length >= 5) {
      histories.set(market.id, snapshots.map(s => s.yesPrice));
    }
  }

  // Compute pairwise correlations
  const pairs: CorrelationPair[] = [];
  const marketIds = Array.from(histories.keys());

  for (let i = 0; i < marketIds.length; i++) {
    for (let j = i + 1; j < marketIds.length; j++) {
      const prices1 = histories.get(marketIds[i])!;
      const prices2 = histories.get(marketIds[j])!;

      // Align lengths
      const minLen = Math.min(prices1.length, prices2.length);
      const corr = pearsonCorrelation(prices1.slice(-minLen), prices2.slice(-minLen));

      if (Math.abs(corr) > 0.3) { // Only store significant correlations
        pairs.push({
          marketId1: marketIds[i],
          marketId2: marketIds[j],
          correlation: Math.round(corr * 1000) / 1000,
        });

        // Update CausalEdge with statistical correlation
        await prisma.causalEdge.upsert({
          where: { fromMarketId_toMarketId: { fromMarketId: marketIds[i], toMarketId: marketIds[j] } },
          create: {
            fromMarketId: marketIds[i],
            toMarketId: marketIds[j],
            relationType: 'CORRELATES',
            strength: Math.abs(corr),
            correlation: corr,
            description: `Statistical correlation: ${corr.toFixed(3)}`,
          },
          update: { correlation: corr },
        });
      }
    }
  }

  logger.info({ pairs: pairs.length, markets: marketIds.length }, 'Correlation matrix computed');
  return pairs;
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;

  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}
