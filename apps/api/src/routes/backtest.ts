import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { runBacktest } from '../services/backtest-engine';
import { runRetroactiveBacktest } from '../services/retroactive-backtest';
import { ingestHistoricalMarkets } from '../jobs/historical-ingest.job';
import { runFreeModuleBacktest, runDeepBacktest, estimateDeepBacktestCost } from '../services/historical-backtest';
import { buildPositionDisplayName } from '../services/paper-trader';
import { kalshiFeePerContract, EDGE_ACTIONABILITY_THRESHOLD, MIN_CONFIDENCE_FOR_ACTIONABLE } from '@apex/shared';

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
      include: {
        market: {
          include: { contracts: { where: { outcome: 'YES' }, take: 1 } },
        },
      },
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

    const realizedPnl = closedPositions.reduce((sum, p) => sum + (p.paperPnl || 0), 0);
    const unrealizedPnl = positions.filter(p => p.isOpen).reduce((sum, p) => sum + (p.paperPnl || 0), 0);
    const totalPnl = realizedPnl + unrealizedPnl;
    const avgEdge = positions.length > 0
      ? positions.reduce((sum, p) => sum + (p.edgeAtEntry || 0), 0) / positions.length
      : 0;

    // Win/loss from closed positions (by P&L, not resolution — includes expired/take_profit)
    const wins = closedPositions.filter(p => (p.paperPnl || 0) > 0).length;
    const losses = closedPositions.filter(p => (p.paperPnl || 0) <= 0).length;
    const winRate = closedPositions.length > 0 ? wins / closedPositions.length : 0;

    // Total deployed (notional value of open positions)
    const totalDeployed = positions.filter(p => p.isOpen).reduce((sum, p) => sum + p.kellySize * p.entryPrice, 0);

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
      paperPnl: realizedPnl,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      wins,
      losses,
      winRate,
      totalDeployed,
      avgEdge,
      daysActive,
      positions: positions.slice(0, 50).map(p => ({
        id: p.id,
        marketId: p.marketId,
        title: buildPositionDisplayName(p.market.title, (p.market as any).contracts?.[0]?.platformContractId),
        direction: p.direction,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        edge: p.edgeAtEntry,
        pnl: p.paperPnl || 0,
        isOpen: p.isOpen,
        needsReview: p.needsReview,
        reviewReason: p.reviewReason,
        createdAt: p.createdAt,
        closedAt: p.closedAt,
      })),
    };
  });

  // GET /paper-positions/:id/details — full trade detail for a paper position
  fastify.get('/paper-positions/:id/details', async (request, reply) => {
    const { id } = request.params as { id: string };

    const position = await prisma.paperPosition.findUnique({
      where: { id },
      include: {
        market: {
          include: {
            contracts: { where: { outcome: 'YES' }, take: 1 },
          },
        },
      },
    });

    if (!position) {
      return reply.code(404).send({ error: 'Paper position not found' });
    }

    const market = position.market;
    const yesContract = (market as any).contracts?.[0];

    // Get the edge closest to position creation time (the edge that triggered this trade)
    const entryEdge = await prisma.edge.findFirst({
      where: {
        marketId: position.marketId,
        createdAt: {
          gte: new Date(new Date(position.createdAt).getTime() - 5 * 60 * 1000), // 5 min before
          lte: new Date(new Date(position.createdAt).getTime() + 5 * 60 * 1000), // 5 min after
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get the most recent edge for this market (current edge)
    const currentEdge = await prisma.edge.findFirst({
      where: { marketId: position.marketId },
      orderBy: { createdAt: 'desc' },
    });

    // Get all signals for this market around the time the position was entered
    // Look for signals within 20 minutes of position creation (signal pipeline runs every 15 min)
    const entrySignals = await prisma.signal.findMany({
      where: {
        marketId: position.marketId,
        createdAt: {
          gte: new Date(new Date(position.createdAt).getTime() - 20 * 60 * 1000),
          lte: new Date(new Date(position.createdAt).getTime() + 5 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Deduplicate: keep only the most recent signal per module
    const signalsByModule = new Map<string, typeof entrySignals[0]>();
    for (const sig of entrySignals) {
      if (!signalsByModule.has(sig.moduleId)) {
        signalsByModule.set(sig.moduleId, sig);
      }
    }
    const deduplicatedSignals = Array.from(signalsByModule.values());

    // Calculate fee details
    const pricePaid = position.direction === 'BUY_YES' ? position.entryPrice : (1 - position.entryPrice);
    const entryFee = kalshiFeePerContract(pricePaid);
    const exitFee = position.currentPrice != null
      ? kalshiFeePerContract(position.direction === 'BUY_YES' ? position.currentPrice : (1 - position.currentPrice))
      : entryFee; // estimate

    // Determine resolution correctness for closed positions
    let directionCorrect: boolean | null = null;
    if (market.resolution) {
      const resolvedYes = market.resolution === 'YES';
      directionCorrect = (position.direction === 'BUY_YES' && resolvedYes) || (position.direction === 'BUY_NO' && !resolvedYes);
    }

    // Build actionability gates
    const moduleCount = deduplicatedSignals.length;
    const llmModules = ['LEGEX', 'DOMEX', 'ALTEX'];
    const llmModuleCount = deduplicatedSignals.filter(s => llmModules.includes(s.moduleId)).length;

    const gates = [
      { gate: `Net edge >= ${(EDGE_ACTIONABILITY_THRESHOLD * 100).toFixed(1)}%`, passed: (position.edgeAtEntry || 0) >= EDGE_ACTIONABILITY_THRESHOLD, actual: `${((position.edgeAtEntry || 0) * 100).toFixed(1)}%` },
      { gate: 'Confidence >= 20%', passed: (position.confidenceAtEntry || 0) >= MIN_CONFIDENCE_FOR_ACTIONABLE, actual: `${((position.confidenceAtEntry || 0) * 100).toFixed(1)}%` },
      { gate: '2+ modules', passed: moduleCount >= 2, actual: `${moduleCount} modules` },
      { gate: '1+ LLM module', passed: llmModuleCount >= 1, actual: `${llmModuleCount} LLM modules` },
      { gate: 'Fee check', passed: (position.edgeAtEntry || 0) > entryFee + exitFee, actual: `edge ${((position.edgeAtEntry || 0) * 100).toFixed(1)}% > fees ${((entryFee + exitFee) * 100).toFixed(1)}%` },
    ];

    // Time held
    const entryTime = new Date(position.createdAt).getTime();
    const endTime = position.closedAt ? new Date(position.closedAt).getTime() : Date.now();
    const hoursHeld = (endTime - entryTime) / 3600000;

    return {
      position: {
        id: position.id,
        direction: position.direction,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        kellySize: position.kellySize,
        paperPnl: position.paperPnl,
        edgeAtEntry: position.edgeAtEntry,
        confidenceAtEntry: position.confidenceAtEntry,
        fairValueAtEntry: position.fairValueAtEntry,
        daysToResolutionAtEntry: position.daysToResolutionAtEntry,
        isOpen: position.isOpen,
        closeReason: position.closeReason,
        needsReview: position.needsReview,
        reviewReason: position.reviewReason,
        createdAt: position.createdAt,
        closedAt: position.closedAt,
        hoursHeld,
      },
      market: {
        id: market.id,
        title: market.title,
        displayTitle: buildPositionDisplayName(market.title, yesContract?.platformContractId),
        platform: market.platform,
        category: market.category,
        status: market.status,
        resolution: market.resolution,
        resolutionDate: market.resolutionDate,
        closesAt: market.closesAt,
        volume: market.volume,
        liquidity: market.liquidity,
        platformContractId: yesContract?.platformContractId || null,
      },
      entryEdge: entryEdge ? {
        cortexProbability: entryEdge.cortexProbability,
        marketPrice: entryEdge.marketPrice,
        edgeMagnitude: entryEdge.edgeMagnitude,
        edgeDirection: entryEdge.edgeDirection,
        confidence: entryEdge.confidence,
        expectedValue: entryEdge.expectedValue,
        kellySize: entryEdge.kellySize,
        isActionable: entryEdge.isActionable,
        conflictFlag: entryEdge.conflictFlag,
        signals: entryEdge.signals,
        actionabilitySummary: entryEdge.actionabilitySummary,
        createdAt: entryEdge.createdAt,
      } : null,
      currentEdge: currentEdge ? {
        cortexProbability: currentEdge.cortexProbability,
        marketPrice: currentEdge.marketPrice,
        edgeMagnitude: currentEdge.edgeMagnitude,
        edgeDirection: currentEdge.edgeDirection,
        confidence: currentEdge.confidence,
        expectedValue: currentEdge.expectedValue,
        isActionable: currentEdge.isActionable,
        createdAt: currentEdge.createdAt,
      } : null,
      signals: deduplicatedSignals.map(s => ({
        moduleId: s.moduleId,
        probability: s.probability,
        confidence: s.confidence,
        reasoning: s.reasoning,
        metadata: s.metadata,
        createdAt: s.createdAt,
      })),
      fees: {
        entryFee,
        exitFee,
        totalFees: entryFee + exitFee,
        netEvAfterFees: (position.edgeAtEntry || 0) - entryFee - exitFee,
      },
      gates,
      outcome: {
        directionCorrect,
        resolution: market.resolution,
        exitPrice: position.isOpen ? null : position.currentPrice,
        grossPnl: position.paperPnl,
        netPnl: position.paperPnl, // already fee-adjusted in paper-trader
      },
    };
  });

  // POST /system/backtest/trigger — manually trigger backtest
  fastify.post('/system/backtest/trigger', async () => {
    const results = await runRetroactiveBacktest();
    return { status: 'completed', results };
  });
}
