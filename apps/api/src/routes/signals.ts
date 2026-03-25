import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function signalRoutes(fastify: FastifyInstance) {
  // GET /markets/:id/signals — all signals for a market
  fastify.get('/markets/:id/signals', async (request) => {
    const { id } = request.params as { id: string };

    const signals = await prisma.signal.findMany({
      where: { marketId: id, expiresAt: { gte: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const latestEdge = await prisma.edge.findFirst({
      where: { marketId: id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      marketId: id,
      signals,
      cortex: latestEdge,
    };
  });

  // GET /signals/modules — module health status
  fastify.get('/signals/modules', async () => {
    const moduleIds = ['COGEX', 'FLOWEX', 'ARBEX', 'LEGEX', 'DOMEX', 'ALTEX'];
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const modules = await Promise.all(moduleIds.map(async (moduleId) => {
      const [total, recent] = await Promise.all([
        prisma.signal.count({ where: { moduleId, createdAt: { gte: since } } }),
        prisma.signal.findFirst({ where: { moduleId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);

      const lastRunAt = recent?.createdAt?.toISOString() ?? null;
      const ageMinutes = recent ? (Date.now() - recent.createdAt.getTime()) / 60000 : Infinity;

      // Modules that produce fewer signals need wider health thresholds
      // ARBEX runs every 60s; COGEX/FLOWEX every 15m but may not find biases; LLM modules every 15m but expensive
      const healthyThreshold = moduleId === 'ARBEX' ? 15 : 120; // 15m for ARBEX, 2h for everything else
      const degradedThreshold = moduleId === 'ARBEX' ? 60 : 480; // 1h for ARBEX, 8h for everything else

      return {
        moduleId,
        lastRunAt,
        lastSuccessAt: lastRunAt,
        signalsLast24h: total,
        status: ageMinutes < healthyThreshold ? 'healthy' : ageMinutes < degradedThreshold ? 'degraded' : 'down',
      };
    }));

    return { modules };
  });
}
