import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getQueueStats } from '../jobs/queue';
import type { HealthResponse } from '@apex/shared';

const startTime = Date.now();

export default async function systemRoutes(fastify: FastifyInstance) {
  // GET /system/health — comprehensive system health (unauthenticated)
  fastify.get('/system/health', async () => {
    const [
      dbCheck,
      redisCheck,
      kalshiCheck,
      polymarketCheck,
      workerStatus,
      moduleHealth,
      circuitBreakers,
      budgetStatus,
      portfolioStatus,
    ] = await Promise.all([
      checkPostgres(),
      checkRedis(),
      checkExternalApi('kalshi'),
      checkExternalApi('polymarket'),
      getWorkerStatus(),
      getModuleHealth(),
      getCircuitBreakerStatus(),
      getBudgetStatus(),
      getPortfolioStatus(),
    ]);

    // Determine overall status
    const coreDown = dbCheck.status === 'down' || redisCheck.status === 'down';
    const workerDown = workerStatus.status === 'down';
    const budgetExceeded = budgetStatus.percentUsed >= 100;
    const anyBreakerOpen = Object.values(circuitBreakers).some(cb => cb.state === 'OPEN');
    const anyModuleStale = Object.values(moduleHealth).some(m => m.status === 'stale');

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (coreDown || workerDown || budgetExceeded) {
      status = 'unhealthy';
    } else if (anyBreakerOpen || anyModuleStale) {
      status = 'degraded';
    }

    const response: HealthResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      services: {
        database: dbCheck,
        redis: redisCheck,
        worker: workerStatus,
      },
      platforms: {
        kalshi: kalshiCheck,
        polymarket: polymarketCheck,
      },
      modules: moduleHealth,
      circuitBreakers,
      budget: budgetStatus,
      portfolio: portfolioStatus,
      // Backward-compatible legacy field
      checks: {
        postgres: dbCheck,
        redis: redisCheck,
        kalshi: kalshiCheck,
        polymarket: polymarketCheck,
      },
    };

    return response;
  });

  // GET /system/ready — lightweight readiness probe for load balancers
  fastify.get('/system/ready', async (_request, reply) => {
    const [dbCheck, redisCheck] = await Promise.all([
      checkPostgres(),
      checkRedis(),
    ]);

    const ready = dbCheck.status === 'up' && redisCheck.status === 'up';

    reply.code(ready ? 200 : 503);
    return {
      ready,
      database: dbCheck.status,
      redis: redisCheck.status,
    };
  });

  // GET /system/jobs
  fastify.get('/system/jobs', async () => {
    const queues = await getQueueStats();
    return { queues };
  });

  // POST /system/recategorize-markets — full re-detection using stored rawPlatformCategory
  // Uses rawPlatformCategory (stored from Kalshi/Polymarket API) as the primary signal,
  // then applies keyword overrides and fallback patterns via detectCategory + reclassifyMarket.
  fastify.post('/system/recategorize-markets', async () => {
    const { detectCategory } = await import('../services/category-detector');
    const { reclassifyMarket } = await import('../services/category-classifier');

    const markets = await prisma.market.findMany({
      select: { id: true, title: true, description: true, category: true, rawPlatformCategory: true },
    });

    const changes: Record<string, { from: string; to: string; count: number }> = {};
    let updated = 0;

    for (const m of markets) {
      // Full re-detection: rawPlatformCategory → keyword overrides → fallback
      const detected = detectCategory(m.title, m.description, m.rawPlatformCategory ?? undefined);
      const newCategory = reclassifyMarket(m.title, detected);

      if (newCategory !== m.category) {
        const key = `${m.category} → ${newCategory}`;
        changes[key] = changes[key] || { from: m.category, to: newCategory, count: 0 };
        changes[key].count++;

        await prisma.market.update({
          where: { id: m.id },
          data: { category: newCategory },
        });
        updated++;
      }

      if (updated % 100 === 0 && updated > 0) await new Promise(r => setImmediate(r));
    }

    return { total: markets.length, updated, changes: Object.values(changes) };
  });

  // POST /system/trigger-orderbook-sync — manually trigger orderbook sync
  fastify.post('/system/trigger-orderbook-sync', async () => {
    const { runOrderBookSync } = await import('../services/orderbook-sync');
    const start = Date.now();
    const synced = await runOrderBookSync();
    return { synced, durationMs: Date.now() - start };
  });

  // POST /system/trigger-resolution-sync — manually trigger resolution sync for settled markets
  // This fetches recently-settled markets from Kalshi and updates their resolution outcomes.
  // Critical for: FeatureModel training, hit rate tracking, calibration, P&L finalization.
  fastify.post('/system/trigger-resolution-sync', async () => {
    const { syncResolutions, syncPositionResolutions } = await import('../services/market-sync');
    const { reconcilePositions } = await import('../services/position-sync');
    const start = Date.now();

    // Step 1: Fetch resolution outcomes from Kalshi (broad sweep)
    const resolutions = await syncResolutions();

    // Step 1b: Targeted sync for markets we hold positions on
    const targeted = await syncPositionResolutions();

    // Step 2: Run position reconciliation to close positions + link training snapshots
    const reconciled = await reconcilePositions();

    // Step 3: Count how many training snapshots now have outcomes
    const labeledSnapshots = await prisma.trainingSnapshot.count({ where: { outcome: { not: null } } });
    const unlabeledSnapshots = await prisma.trainingSnapshot.count({ where: { outcome: null } });

    // Step 4: Count resolved markets and positions
    const resolvedMarkets = await prisma.market.count({ where: { resolution: { not: null } } });
    const resolvedPositions = await prisma.paperPosition.count({ where: { closeReason: 'RESOLVED' } });

    return {
      durationMs: Date.now() - start,
      resolutionsFound: resolutions,
      targetedResolutions: targeted,
      positionsReconciled: reconciled.synced,
      resolvedMarkets,
      resolvedPositions,
      trainingData: {
        labeled: labeledSnapshots,
        unlabeled: unlabeledSnapshots,
        readyForTraining: labeledSnapshots >= 50,
      },
    };
  });

  // GET /system/circuit-breakers — status of all circuit breakers
  fastify.get('/system/circuit-breakers', async () => {
    const { getAllCircuitBreakers } = await import('../lib/circuit-breaker');
    return { breakers: getAllCircuitBreakers() };
  });

  // GET /system/graduation — graduation status for all strategies
  fastify.get('/system/graduation', async () => {
    const { getAllGraduationStatuses, evaluateAllGraduations } = await import('../engine/graduation-engine');
    // Re-evaluate if requested
    const fresh = await evaluateAllGraduations();
    return { strategies: fresh };
  });

  // GET /system/api-usage — Claude API costs
  fastify.get('/system/api-usage', async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usage = await prisma.apiUsageLog.findMany({
      where: { service: 'claude', createdAt: { gte: today } },
      select: { endpoint: true, cost: true, tokensIn: true, tokensOut: true },
    });

    const totalCost = usage.reduce((sum, u) => sum + (u.cost ?? 0), 0);
    const totalTokensIn = usage.reduce((sum, u) => sum + (u.tokensIn ?? 0), 0);
    const totalTokensOut = usage.reduce((sum, u) => sum + (u.tokensOut ?? 0), 0);

    // Group by tier/endpoint
    const byEndpoint: Record<string, { calls: number; cost: number }> = {};
    for (const u of usage) {
      const key = u.endpoint || 'unknown';
      byEndpoint[key] = byEndpoint[key] || { calls: 0, cost: 0 };
      byEndpoint[key].calls++;
      byEndpoint[key].cost += u.cost ?? 0;
    }

    return {
      today: {
        totalCost: Math.round(totalCost * 10000) / 10000,
        totalCalls: usage.length,
        totalTokensIn,
        totalTokensOut,
        byEndpoint,
      },
      budget: parseFloat(process.env.LLM_DAILY_BUDGET || '10'),
      optimization: (() => {
        try {
          const { getCostOptimizationStats } = require('../services/claude-client');
          return getCostOptimizationStats();
        } catch { return null; }
      })(),
    };
  });

  // GET /system/odds-api-usage — The Odds API monthly usage tracking
  fastify.get('/system/odds-api-usage', async () => {
    const { getOddsApiUsage } = await import('../services/data-sources/odds-api');
    return getOddsApiUsage();
  });

  // GET /system/job-errors — recent failed jobs with error details
  fastify.get('/system/job-errors', async (req) => {
    const { queue: queueName, limit: limitParam } = req.query as { queue?: string; limit?: string };
    const limit = Math.min(parseInt(limitParam || '50', 10), 200);
    const { ingestionQueue, analysisQueue, speedQueue, arbQueue, maintenanceQueue } = await import('../jobs/queue');

    const queues = queueName
      ? [{ name: queueName, q: { ingestion: ingestionQueue, analysis: analysisQueue, speed: speedQueue, 'arb-scan': arbQueue, maintenance: maintenanceQueue }[queueName]! }]
      : [
          { name: 'ingestion', q: ingestionQueue },
          { name: 'analysis', q: analysisQueue },
          { name: 'speed', q: speedQueue },
          { name: 'arb-scan', q: arbQueue },
          { name: 'maintenance', q: maintenanceQueue },
        ];

    const errors: { queue: string; jobName: string; failedAt: string; error: string; attemptsMade: number }[] = [];

    for (const { name, q } of queues) {
      if (!q) continue;
      const failed = await q.getFailed(0, Math.floor(limit / queues.length));
      for (const job of failed) {
        errors.push({
          queue: name,
          jobName: job.name,
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : '',
          error: job.failedReason || 'Unknown error',
          attemptsMade: job.attemptsMade,
        });
      }
    }

    // Sort by most recent first
    errors.sort((a, b) => b.failedAt.localeCompare(a.failedAt));

    return { errors: errors.slice(0, limit) };
  });

  // GET /system/cost-forecast — project LLM costs for next 7 days
  fastify.get('/system/cost-forecast', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const dailyCosts = await prisma.apiUsageLog.groupBy({
      by: ['createdAt'],
      where: { service: 'claude', createdAt: { gte: sevenDaysAgo } },
      _sum: { cost: true },
      _count: true,
    });

    // Aggregate by date
    const costByDay: Record<string, { cost: number; calls: number }> = {};
    for (const row of dailyCosts) {
      const day = row.createdAt.toISOString().slice(0, 10);
      costByDay[day] = costByDay[day] || { cost: 0, calls: 0 };
      costByDay[day].cost += row._sum.cost ?? 0;
      costByDay[day].calls += row._count;
    }

    const days = Object.entries(costByDay).sort(([a], [b]) => a.localeCompare(b));
    const avgDailyCost = days.length > 0
      ? days.reduce((sum, [, d]) => sum + d.cost, 0) / days.length
      : 0;

    // Simple linear trend
    const recentDays = days.slice(-3);
    const recentAvg = recentDays.length > 0
      ? recentDays.reduce((sum, [, d]) => sum + d.cost, 0) / recentDays.length
      : 0;

    const budget = parseFloat(process.env.LLM_DAILY_BUDGET || '10');

    // Project next 7 days
    const forecast = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
      forecast.push({ date, projectedCost: Math.round(recentAvg * 10000) / 10000 });
    }

    return {
      history: days.map(([date, data]) => ({ date, cost: Math.round(data.cost * 10000) / 10000, calls: data.calls })),
      avgDailyCost: Math.round(avgDailyCost * 10000) / 10000,
      recentTrend: Math.round(recentAvg * 10000) / 10000,
      forecast,
      budget,
      daysUntilBudgetExceeded: recentAvg > 0 ? Math.ceil(budget / recentAvg) : null,
    };
  });

  // GET /system/data-sources — status of all external data feeds
  fastify.get('/system/data-sources', async () => {
    const { binanceWs } = await import('../services/data-sources/binance-ws');
    const { deribit } = await import('../services/data-sources/deribit');

    const sources: Record<string, any> = {
      binance_ws: {
        name: 'Coinbase WebSocket',
        type: 'real-time',
        ...binanceWs.getStatus(),
      },
      deribit: {
        name: 'Deribit Options (DVOL)',
        type: 'polling',
        ...deribit.getStatus(),
      },
      coingecko: {
        name: 'CoinGecko',
        type: 'polling',
        ...(await checkExternalApi('coingecko')),
      },
      fred: {
        name: 'FRED Economic Data',
        type: 'polling',
        ...(await checkExternalApi('fred')),
      },
      cme_fedwatch: {
        name: 'CME FedWatch',
        type: 'polling',
        ...(await checkExternalApi('cme_fedwatch')),
      },
      realclearpolling: {
        name: 'RealClearPolling',
        type: 'polling',
        ...(await checkExternalApi('realclearpolling')),
      },
      congress_gov: {
        name: 'Congress.gov',
        type: 'polling',
        ...(await checkExternalApi('congress_gov')),
      },
    };

    return { dataSources: sources };
  });

  // GET /system/training-status — training data collection + model + calibration status
  fastify.get('/system/training-status', async () => {
    const [
      totalSnapshots,
      resolvedSnapshots,
      unresolvedSnapshots,
      snapshotsByCategory,
      calibrationResults,
      modelConfig,
      directionCounts,
    ] = await Promise.all([
      prisma.trainingSnapshot.count(),
      prisma.trainingSnapshot.count({ where: { outcome: { not: null } } }),
      prisma.trainingSnapshot.count({ where: { outcome: null } }),
      prisma.trainingSnapshot.groupBy({
        by: ['marketCategory'],
        _count: true,
        where: { outcome: { not: null } },
      }),
      prisma.calibrationResult.findMany({ orderBy: { bucket: 'asc' } }),
      prisma.systemConfig.findUnique({ where: { key: 'feature_model_weights' } }),
      prisma.trainingSnapshot.groupBy({
        by: ['edgeDirection'],
        _count: true,
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
    ]);

    // Parse model info
    let modelStatus: { status: string; sampleSize: number; validationAccuracy: number; trainedAt: string | null } = {
      status: 'untrained',
      sampleSize: 0,
      validationAccuracy: 0,
      trainedAt: null,
    };
    if (modelConfig?.value) {
      try {
        const weights = typeof modelConfig.value === 'string'
          ? JSON.parse(modelConfig.value)
          : modelConfig.value;
        modelStatus = {
          status: weights.sampleSize > 0 ? 'trained' : 'untrained',
          sampleSize: weights.sampleSize || 0,
          validationAccuracy: weights.validationAccuracy || 0,
          trainedAt: weights.trainedAt || null,
        };
      } catch { /* keep defaults */ }
    }

    // BUY_YES vs BUY_NO ratio (last 7 days)
    const buyYes = directionCounts.find(d => d.edgeDirection === 'BUY_YES')?._count ?? 0;
    const buyNo = directionCounts.find(d => d.edgeDirection === 'BUY_NO')?._count ?? 0;
    const totalDirectional = buyYes + buyNo;

    return {
      trainingData: {
        totalSnapshots,
        resolvedSnapshots,
        unresolvedSnapshots,
        byCategory: snapshotsByCategory.map(s => ({
          category: s.marketCategory,
          count: s._count,
        })),
      },
      featureModel: modelStatus,
      calibration: calibrationResults.map(r => ({
        bucket: r.bucketLabel,
        positions: r.positionCount,
        wins: r.winCount,
        predictedAvg: Math.round(r.predictedAvg * 1000) / 10,
        actualWinRate: Math.round(r.actualWinRate * 1000) / 10,
        calibrationError: Math.round(r.calibrationError * 1000) / 10,
      })),
      directionalBalance: {
        buyYes,
        buyNo,
        total: totalDirectional,
        yesRatio: totalDirectional > 0 ? Math.round((buyYes / totalDirectional) * 100) : 0,
      },
    };
  });
}

async function checkPostgres(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'up', latencyMs: Date.now() - start };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<{ status: 'up' | 'down'; latencyMs: number }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { status: 'up', latencyMs: Date.now() - start };
  } catch {
    return { status: 'down', latencyMs: Date.now() - start };
  }
}

async function checkExternalApi(service: string): Promise<{ status: 'up' | 'down' | 'syncing' | 'unknown'; lastSuccessAt: string | null }> {
  try {
    // Check if ingestion jobs are currently active
    const stats = await getQueueStats();
    const ingestionStats = stats.find(s => s.name === 'ingestion');
    const isActivelyIngesting = ingestionStats && ingestionStats.active > 0;

    const lastSuccess = await prisma.apiUsageLog.findFirst({
      where: { service, statusCode: { gte: 200, lt: 300 } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    // Check for recent failures
    const lastFailure = await prisma.apiUsageLog.findFirst({
      where: { service, statusCode: { gte: 400 } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, statusCode: true },
    });

    if (!lastSuccess) {
      // No successes ever — syncing if jobs are queued, unknown otherwise
      return { status: isActivelyIngesting ? 'syncing' : 'unknown', lastSuccessAt: null };
    }

    const ageMinutes = (Date.now() - lastSuccess.createdAt.getTime()) / 60000;

    if (ageMinutes < 15) {
      return { status: 'up', lastSuccessAt: lastSuccess.createdAt.toISOString() };
    }

    // Stale but jobs are running — syncing, not down
    if (isActivelyIngesting || (ingestionStats && ingestionStats.waiting > 0)) {
      return { status: 'syncing', lastSuccessAt: lastSuccess.createdAt.toISOString() };
    }

    // Recent failure + stale success = down
    if (lastFailure && lastFailure.createdAt > lastSuccess.createdAt) {
      return { status: 'down', lastSuccessAt: lastSuccess.createdAt.toISOString() };
    }

    // Stale but no recent failure — likely just waiting for next cycle
    return { status: ageMinutes < 30 ? 'syncing' : 'down', lastSuccessAt: lastSuccess.createdAt.toISOString() };
  } catch {
    return { status: 'unknown', lastSuccessAt: null };
  }
}

// ── Worker Status ──

async function getWorkerStatus(): Promise<{
  status: 'up' | 'down' | 'idle';
  activeJobs: number;
  lastJobCompleted: string | null;
  failedJobs24h: number;
}> {
  try {
    const stats = await getQueueStats();
    const totalActive = stats.reduce((sum, q) => sum + q.active, 0);
    const totalFailed = stats.reduce((sum, q) => sum + q.failed, 0);
    const totalCompleted = stats.reduce((sum, q) => sum + q.completed, 0);

    // Check if any jobs have completed (worker is processing)
    const isProcessing = totalActive > 0 || totalCompleted > 0;

    return {
      status: isProcessing ? 'up' : (totalFailed > 0 ? 'down' : 'idle'),
      activeJobs: totalActive,
      lastJobCompleted: null, // BullMQ doesn't expose this directly without job scanning
      failedJobs24h: totalFailed,
    };
  } catch {
    return { status: 'down', activeJobs: 0, lastJobCompleted: null, failedJobs24h: 0 };
  }
}

// ── Module Health ──

const ALL_MODULES = ['COGEX', 'FLOWEX', 'LEGEX', 'DOMEX', 'ALTEX', 'REFLEX', 'SPEEDEX', 'ARBEX', 'SIGINT', 'NEXUS'] as const;

async function getModuleHealth(): Promise<Record<string, { status: 'healthy' | 'stale' | 'inactive'; signalsLast24h: number; lastActive: string | null }>> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Single query: count signals per module in last 24h and get latest timestamp
  const moduleStats = await prisma.signal.groupBy({
    by: ['moduleId'],
    where: { createdAt: { gte: oneDayAgo } },
    _count: true,
    _max: { createdAt: true },
  });

  const statsMap = new Map(
    moduleStats.map(s => [s.moduleId, { count: s._count, lastActive: s._max.createdAt }])
  );

  const result: Record<string, { status: 'healthy' | 'stale' | 'inactive'; signalsLast24h: number; lastActive: string | null }> = {};

  for (const moduleId of ALL_MODULES) {
    const stat = statsMap.get(moduleId);
    if (!stat || stat.count === 0) {
      result[moduleId] = { status: 'inactive', signalsLast24h: 0, lastActive: null };
    } else {
      const minutesSince = stat.lastActive
        ? (Date.now() - stat.lastActive.getTime()) / 60000
        : Infinity;
      // Stale if last signal > 2 hours ago (modules should produce signals each 15min cycle)
      const status = minutesSince < 120 ? 'healthy' : 'stale';
      result[moduleId] = {
        status,
        signalsLast24h: stat.count,
        lastActive: stat.lastActive?.toISOString() ?? null,
      };
    }
  }

  return result;
}

// ── Circuit Breaker Status ──

async function getCircuitBreakerStatus(): Promise<Record<string, { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failures: number; totalFailures: number; totalSuccesses: number }>> {
  try {
    const { getAllCircuitBreakers } = await import('../lib/circuit-breaker');
    const breakers = getAllCircuitBreakers();
    const result: Record<string, { state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'; failures: number; totalFailures: number; totalSuccesses: number }> = {};
    for (const [name, info] of Object.entries(breakers)) {
      result[name] = {
        state: info.state as 'CLOSED' | 'OPEN' | 'HALF_OPEN',
        failures: info.failures,
        totalFailures: info.totalFailures,
        totalSuccesses: info.totalSuccesses,
      };
    }
    return result;
  } catch {
    return {};
  }
}

// ── Budget Status ──

async function getBudgetStatus(): Promise<{ dailySpent: number; dailyLimit: number; percentUsed: number; hardLimit: number }> {
  try {
    const { getLLMBudgetStatus } = await import('../services/llm-budget-tracker');
    const budget = await getLLMBudgetStatus();
    return {
      dailySpent: Math.round(budget.todaySpend * 100) / 100,
      dailyLimit: budget.dailyBudget,
      percentUsed: budget.percentUsed,
      hardLimit: budget.hardLimit,
    };
  } catch {
    return { dailySpent: 0, dailyLimit: 10, percentUsed: 0, hardLimit: 10 };
  }
}

// ── Portfolio Status ──

async function getPortfolioStatus(): Promise<{ paperPositions: number; totalDeployed: number; unrealizedPnl: number; tradesToday: number }> {
  try {
    const positions = await prisma.paperPosition.findMany({
      where: { isOpen: true },
    });

    const totalDeployed = positions.reduce((sum, p) => sum + p.kellySize * p.entryPrice, 0);
    const unrealizedPnl = positions.reduce((sum, p) => {
      const currentValue = p.kellySize * p.currentPrice;
      const entryValue = p.kellySize * p.entryPrice;
      return sum + (currentValue - entryValue);
    }, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tradesToday = await prisma.paperPosition.count({ where: { createdAt: { gte: today } } });

    return {
      paperPositions: positions.length,
      totalDeployed: Math.round(totalDeployed * 100) / 100,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
      tradesToday,
    };
  } catch {
    return { paperPositions: 0, totalDeployed: 0, unrealizedPnl: 0, tradesToday: 0 };
  }
}
