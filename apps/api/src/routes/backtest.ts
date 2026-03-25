import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { runBacktest } from '../services/backtest-engine';
import { runRetroactiveBacktest } from '../services/retroactive-backtest';
import { ingestHistoricalMarkets } from '../jobs/historical-ingest.job';
import { runFreeModuleBacktest, runDeepBacktest, estimateDeepBacktestCost } from '../services/historical-backtest';

export default async function backtestRoutes(fastify: FastifyInstance) {
  // GET /backtest/results — latest backtest results
  fastify.get('/backtest/results', async (request) => {
    const { days = '90' } = request.query as { days?: string };
    return runBacktest(parseInt(days));
  });

  // GET /backtest/retroactive — run against historical resolved markets
  fastify.get('/backtest/retroactive', async () => {
    return runRetroactiveBacktest();
  });

  // GET /backtest/scores — module scores over time
  fastify.get('/backtest/scores', async () => {
    const scores = await prisma.moduleScore.findMany({
      orderBy: { periodEnd: 'desc' },
      take: 100,
    });
    return { data: scores };
  });

  // POST /backtest/ingest-historical — pull resolved markets from APIs
  fastify.post('/backtest/ingest-historical', async () => {
    const counts = await ingestHistoricalMarkets();
    const total = await prisma.market.count({ where: { resolution: { in: ['YES', 'NO'] } } });
    return { status: 'completed', ingested: counts, totalResolved: total };
  });

  // GET /backtest/historical — run free modules (COGEX + FLOWEX) on all resolved markets
  fastify.get('/backtest/historical', async () => {
    return runFreeModuleBacktest();
  });

  // GET /backtest/historical/estimate-deep — cost estimate for LLM backtest
  fastify.get('/backtest/historical/estimate-deep', async (request) => {
    const { sample = '50' } = request.query as { sample?: string };
    return estimateDeepBacktestCost(parseInt(sample));
  });

  // GET /backtest/historical/deep — retrieve cached deep backtest results
  fastify.get('/backtest/historical/deep', async () => {
    const cached = await prisma.systemConfig.findUnique({ where: { key: 'deep_backtest_results' } });
    if (!cached) return { cached: false };
    return { cached: true, ...JSON.parse(cached.value as string) };
  });

  // POST /backtest/historical/deep — run LLM modules on sample (costs money)
  fastify.post('/backtest/historical/deep', async (request) => {
    const { sample = '50' } = request.query as { sample?: string };
    return runDeepBacktest(parseInt(sample));
  });

  // GET /backtest/live-performance — forward-looking paper trade results (no bias)
  fastify.get('/backtest/live-performance', async () => {
    const positions = await prisma.paperPosition.findMany({
      include: { market: { select: { title: true, resolution: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalPositions = positions.length;
    const openPositions = positions.filter(p => p.isOpen).length;
    const closedPositions = positions.filter(p => !p.isOpen);
    const resolvedPositions = closedPositions.filter(p => p.market.resolution != null);

    // Calculate hit rate on resolved positions only
    const hits = resolvedPositions.filter(p => {
      const resolvedYes = p.market.resolution === 'YES';
      return (p.direction === 'BUY_YES' && resolvedYes) || (p.direction === 'BUY_NO' && !resolvedYes);
    });

    const paperPnl = closedPositions.reduce((sum, p) => sum + (p.paperPnl || 0), 0);
    const avgEdge = positions.length > 0
      ? positions.reduce((sum, p) => sum + (p.edgeAtEntry || 0), 0) / positions.length
      : 0;

    // Days since first position
    const firstPosition = positions[positions.length - 1];
    const daysActive = firstPosition
      ? Math.floor((Date.now() - new Date(firstPosition.createdAt).getTime()) / 86400000)
      : 0;

    return {
      totalPositions,
      openPositions,
      resolvedPositions: resolvedPositions.length,
      hitRate: resolvedPositions.length > 0 ? hits.length / resolvedPositions.length : 0,
      paperPnl,
      avgEdge,
      daysActive,
      positions: positions.slice(0, 50).map(p => ({
        title: p.market.title,
        direction: p.direction,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        edge: p.edgeAtEntry,
        pnl: p.paperPnl || 0,
        isOpen: p.isOpen,
        createdAt: p.createdAt,
      })),
    };
  });

  // POST /system/backtest/trigger — manually trigger backtest
  fastify.post('/system/backtest/trigger', async () => {
    const results = await runRetroactiveBacktest();
    return { status: 'completed', results };
  });
}
