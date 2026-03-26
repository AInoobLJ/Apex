import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getOpportunityPipeline } from '../services/opportunity-machine';
import { getAllocationSummary } from '../services/cortex/portfolio-allocator';

export default async function opportunityRoutes(fastify: FastifyInstance) {
  // GET /opportunities/pipeline — full pipeline view
  fastify.get('/opportunities/pipeline', async () => {
    return getOpportunityPipeline();
  });

  // GET /opportunities/attribution — resolved opportunities with attribution scores
  fastify.get('/opportunities/attribution', async () => {
    const resolved = await prisma.opportunity.findMany({
      where: { status: 'RESOLVED' },
      include: {
        market: { select: { title: true, category: true } },
        transitions: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { resolvedAt: 'desc' },
      take: 100,
    });

    // Aggregate attribution metrics
    const total = resolved.length;
    if (total === 0) {
      return {
        summary: { total: 0, thesisCorrectRate: 0, avgExecutionQuality: 0, avgFeeDrag: 0, avgTimingScore: 0, totalRealizedPnl: 0 },
        opportunities: [],
      };
    }

    const withThesis = resolved.filter(o => o.thesisCorrect !== null);
    const thesisCorrectRate = withThesis.length > 0
      ? withThesis.filter(o => o.thesisCorrect).length / withThesis.length
      : 0;

    const avgExecQuality = resolved.reduce((s, o) => s + (o.executionQuality ?? 0), 0) / total;
    const avgFeeDrag = resolved.reduce((s, o) => s + (o.feeDrag ?? 0), 0) / total;
    const avgTimingScore = resolved.reduce((s, o) => s + (o.timingScore ?? 0), 0) / total;
    const totalPnl = resolved.reduce((s, o) => s + (o.realizedPnl ?? 0), 0);

    // Alpha decomposition
    const thesisAlpha = resolved.reduce((s, o) => {
      if (o.thesisCorrect && o.edgeMagnitude) return s + o.edgeMagnitude;
      if (!o.thesisCorrect && o.edgeMagnitude) return s - o.edgeMagnitude;
      return s;
    }, 0) / total;

    return {
      summary: {
        total,
        thesisCorrectRate,
        avgExecutionQuality: avgExecQuality,
        avgFeeDrag,
        avgTimingScore,
        totalRealizedPnl: totalPnl,
        thesisAlpha,
      },
      opportunities: resolved.map(o => ({
        id: o.id,
        title: o.market.title,
        category: o.market.category,
        mode: o.mode,
        edge: o.edgeMagnitude,
        realizedPnl: o.realizedPnl,
        thesisCorrect: o.thesisCorrect,
        executionQuality: o.executionQuality,
        feeDrag: o.feeDrag,
        timingScore: o.timingScore,
        noFillRegret: o.noFillRegret,
        discoveredBy: o.discoveredBy,
        resolvedAt: o.resolvedAt,
        stateTimeline: o.transitions.map(t => ({
          from: t.fromStatus,
          to: t.toStatus,
          reason: t.reason,
          at: t.createdAt,
        })),
      })),
    };
  });

  // GET /opportunities/allocation — portfolio allocation summary
  fastify.get('/opportunities/allocation', async () => {
    // Get total bankroll from SystemConfig
    const config = await prisma.systemConfig.findUnique({ where: { key: 'tradex_risk_limits' } });
    const limits = config?.value as Record<string, number> | null;
    const totalBankroll = limits?.maxTotalDeployed ?? 100;

    return getAllocationSummary(totalBankroll);
  });

  // GET /opportunities/stats — summary counts by status and mode
  fastify.get('/opportunities/stats', async () => {
    const [byStatus, byMode, recentTransitions] = await Promise.all([
      prisma.opportunity.groupBy({ by: ['status'], _count: true }),
      prisma.opportunity.groupBy({ by: ['mode'], _count: true }),
      prisma.opportunityTransition.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { opportunity: { select: { market: { select: { title: true } } } } },
      }),
    ]);

    return { byStatus, byMode, recentTransitions };
  });
}
