import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getQueueStats } from '../jobs/queue';

const startTime = Date.now();

export default async function systemRoutes(fastify: FastifyInstance) {
  // GET /system/health — unauthenticated
  fastify.get('/system/health', async () => {
    const checks = {
      postgres: await checkPostgres(),
      redis: await checkRedis(),
      kalshi: await checkExternalApi('kalshi'),
      polymarket: await checkExternalApi('polymarket'),
    };

    const allUp = checks.postgres.status === 'up' && checks.redis.status === 'up';
    const anyDown = checks.postgres.status === 'down' || checks.redis.status === 'down';

    return {
      status: anyDown ? 'unhealthy' : allUp ? 'healthy' : 'degraded',
      checks,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });

  // GET /system/jobs
  fastify.get('/system/jobs', async () => {
    const queues = await getQueueStats();
    return { queues };
  });

  // POST /system/recategorize-markets — re-run category detection on all markets
  fastify.post('/system/recategorize-markets', async () => {
    const { detectCategory } = await import('../services/category-detector');
    const { reclassifyMarket } = await import('../services/category-classifier');

    const markets = await prisma.market.findMany({
      select: { id: true, title: true, description: true, category: true },
    });

    const changes: Record<string, { from: string; to: string; count: number }> = {};
    let updated = 0;

    for (const m of markets) {
      const detected = detectCategory(m.title, m.description);
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
      budget: parseFloat(process.env.LLM_DAILY_BUDGET || '25'),
      optimization: (() => {
        try {
          const { getCostOptimizationStats } = require('../services/claude-client');
          return getCostOptimizationStats();
        } catch { return null; }
      })(),
    };
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

    const budget = parseFloat(process.env.LLM_DAILY_BUDGET || '25');

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

    const sources: Record<string, any> = {
      binance_ws: {
        name: 'Binance WebSocket',
        type: 'real-time',
        ...binanceWs.getStatus(),
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
