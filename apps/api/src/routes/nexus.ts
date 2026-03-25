import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { checkConsistency } from '../modules/nexus/consistency-checker';

export default async function nexusRoutes(fastify: FastifyInstance) {
  // GET /nexus/graph — all causal edges
  fastify.get('/nexus/graph', async () => {
    const edges = await prisma.causalEdge.findMany({
      orderBy: { strength: 'desc' },
      take: 200,
    });

    // Get market titles for the nodes
    const marketIds = new Set([...edges.map(e => e.fromMarketId), ...edges.map(e => e.toMarketId)]);
    const markets = await prisma.market.findMany({
      where: { id: { in: Array.from(marketIds) } },
      select: { id: true, title: true, category: true },
    });
    const marketMap = Object.fromEntries(markets.map(m => [m.id, m]));

    return {
      nodes: markets.map(m => ({ id: m.id, title: m.title, category: m.category })),
      edges: edges.map(e => ({
        from: e.fromMarketId,
        to: e.toMarketId,
        type: e.relationType,
        strength: e.strength,
        correlation: e.correlation,
        description: e.description,
      })),
    };
  });

  // GET /nexus/inconsistencies
  fastify.get('/nexus/inconsistencies', async () => {
    const inconsistencies = await checkConsistency();
    return { data: inconsistencies };
  });

  // GET /nexus/market/:id/related — markets related to a given market
  fastify.get('/nexus/market/:id/related', async (request) => {
    const { id } = request.params as { id: string };

    const edges = await prisma.causalEdge.findMany({
      where: { OR: [{ fromMarketId: id }, { toMarketId: id }] },
      orderBy: { strength: 'desc' },
    });

    const relatedIds = edges.map(e => e.fromMarketId === id ? e.toMarketId : e.fromMarketId);
    const relatedMarkets = await prisma.market.findMany({
      where: { id: { in: relatedIds } },
      select: { id: true, title: true, category: true },
    });

    return {
      marketId: id,
      related: edges.map(e => {
        const otherId = e.fromMarketId === id ? e.toMarketId : e.fromMarketId;
        const market = relatedMarkets.find(m => m.id === otherId);
        return {
          marketId: otherId,
          title: market?.title,
          category: market?.category,
          relationType: e.relationType,
          strength: e.strength,
          description: e.description,
        };
      }),
    };
  });
}
