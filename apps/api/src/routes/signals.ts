import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function signalRoutes(fastify: FastifyInstance) {
  // GET /markets/:id/signals — signals for a market
  // ?latest=true (default) returns only the most recent signal per module
  // ?latest=false returns all signals (history view)
  fastify.get('/markets/:id/signals', async (request) => {
    const { id } = request.params as { id: string };
    const { latest } = request.query as { latest?: string };
    const showLatestOnly = latest !== 'false'; // default = latest only

    let signals;
    if (showLatestOnly) {
      // Get latest signal per module using a subquery approach
      const allSignals = await prisma.signal.findMany({
        where: { marketId: id },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      // Deduplicate: keep only latest per module
      const seen = new Set<string>();
      signals = allSignals.filter(s => {
        if (seen.has(s.moduleId)) return false;
        seen.add(s.moduleId);
        return true;
      });
    } else {
      signals = await prisma.signal.findMany({
        where: { marketId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    }

    const latestEdge = await prisma.edge.findFirst({
      where: { marketId: id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      marketId: id,
      signals,
      cortex: latestEdge,
      showingLatestOnly: showLatestOnly,
    };
  });

  // GET /signals/modules — module health status
  fastify.get('/signals/modules', async () => {
    const moduleIds = ['COGEX', 'FLOWEX', 'ARBEX', 'LEGEX', 'DOMEX', 'ALTEX', 'REFLEX', 'SPEEDEX', 'SIGINT', 'NEXUS'];
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const modules = await Promise.all(moduleIds.map(async (moduleId) => {
      const [total, recent] = await Promise.all([
        prisma.signal.count({ where: { moduleId, createdAt: { gte: since } } }),
        prisma.signal.findFirst({ where: { moduleId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);

      const lastRunAt = recent?.createdAt?.toISOString() ?? null;
      const ageMinutes = recent ? (Date.now() - recent.createdAt.getTime()) / 60000 : Infinity;

      // Modules that produce fewer signals need wider health thresholds
      const healthyThresholds: Record<string, number> = {
        ARBEX: 15,       // runs every 60s
        COGEX: 120,      // every 15m
        FLOWEX: 120,     // every 15m
        SPEEDEX: 120,    // every 15m (crypto markets)
        LEGEX: 240,      // LLM, may not find ambiguity every run
        DOMEX: 240,      // LLM, category-dependent
        ALTEX: 240,      // LLM, news-dependent
        REFLEX: 240,     // LLM, most markets are NEUTRAL
        SIGINT: 120,     // hourly wallet profiling
        NEXUS: 480,      // every 6 hours
      };
      const healthyThreshold = healthyThresholds[moduleId] ?? 120;
      const degradedThreshold = healthyThreshold * 4;

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
