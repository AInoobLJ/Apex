import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import {
  loadRiskLimits,
  saveRiskLimits,
  SYSTEM_CONFIG_KEY,
  DEFAULT_RISK_LIMITS,
  HARD_CEILINGS,
} from '@apex/tradex';
import type { RiskLimitConfig } from '@apex/tradex';

// SystemConfig helpers for tradex risk-limits module
async function getConfig(key: string): Promise<unknown | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key } });
  return config?.value ?? null;
}

async function setConfig(key: string, value: unknown): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue },
  });
}

export default async function executionRoutes(fastify: FastifyInstance) {
  // GET /execution/log — paginated execution log
  fastify.get('/execution/log', async (request) => {
    const { page = 1, limit = 50 } = request.query as { page?: number; limit?: number };
    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      prisma.executionLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: Number(limit),
        skip,
        include: {
          edge: { select: { cortexProbability: true, edgeMagnitude: true } },
          market: { select: { title: true, platform: true } },
        },
      }),
      prisma.executionLog.count(),
    ]);

    return {
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  });

  // GET /execution/positions — current open positions from execution log
  fastify.get('/execution/positions', async () => {
    const openPositions = await prisma.executionLog.findMany({
      where: { status: 'FILLED' },
      orderBy: { createdAt: 'desc' },
      include: {
        market: { select: { title: true, platform: true } },
      },
    });

    return { data: openPositions };
  });

  // GET /execution/balances — would require live platform queries
  fastify.get('/execution/balances', async () => {
    // Placeholder — actual balance fetching requires executors initialized with keys
    return {
      kalshi: { available: 0, deployed: 0, demo: true },
      polymarket: { available: 0, deployed: 0, demo: true },
    };
  });

  // GET /execution/risk-limits — current risk limits with hard ceilings
  fastify.get('/execution/risk-limits', async () => {
    const limits = await loadRiskLimits(getConfig);
    return {
      limits,
      hardCeilings: HARD_CEILINGS,
      defaults: DEFAULT_RISK_LIMITS,
    };
  });

  // PUT /execution/risk-limits — update risk limits (requires CONFIRM)
  fastify.put('/execution/risk-limits', async (request, reply) => {
    const body = request.body as { limits: Partial<RiskLimitConfig>; confirm?: string };

    if (body.confirm !== 'CONFIRM') {
      return reply.status(400).send({ error: 'Must include confirm: "CONFIRM" to change risk limits' });
    }

    const { limits, changes } = await saveRiskLimits(body.limits, getConfig, setConfig);

    // Log changes to AuditLog
    for (const change of changes) {
      await prisma.auditLog.create({
        data: {
          setting: change.setting,
          previousValue: change.previousValue,
          newValue: change.newValue,
        },
      });
    }

    return { limits, changes };
  });

  // POST /execution/kill-switch — toggle TRADEX_ENABLED
  fastify.post('/execution/kill-switch', async (request) => {
    const body = request.body as { enabled: boolean };
    const previousConfig = await getConfig('tradex_enabled');
    const previousValue = previousConfig != null ? String(previousConfig) : 'false';
    const newValue = String(body.enabled);

    await setConfig('tradex_enabled', body.enabled);

    // Log to AuditLog
    await prisma.auditLog.create({
      data: {
        setting: 'tradex_enabled',
        previousValue,
        newValue,
      },
    });

    return { tradexEnabled: body.enabled };
  });

  // GET /execution/kill-switch — get current kill switch state
  fastify.get('/execution/kill-switch', async () => {
    const config = await getConfig('tradex_enabled');
    return { tradexEnabled: config === true };
  });

  // GET /execution/audit-log — audit log of all settings changes
  fastify.get('/execution/audit-log', async (request) => {
    const { limit = 50 } = request.query as { limit?: number };

    const logs = await prisma.auditLog.findMany({
      orderBy: { changedAt: 'desc' },
      take: Number(limit),
    });

    return { data: logs };
  });

  // GET /execution/analytics — execution performance analytics
  fastify.get('/execution/analytics', async () => {
    const execLogs = await prisma.executionLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const filled = execLogs.filter(l => l.status === 'FILLED');
    const failed = execLogs.filter(l => l.status === 'FAILED');

    const avgLatency = filled.length > 0
      ? filled.reduce((s, l) => s + (l.latencyMs ?? 0), 0) / filled.length
      : 0;

    const fillRate = execLogs.length > 0
      ? filled.length / execLogs.length
      : 0;

    // Slippage: difference between requested and filled price
    const slippages = filled
      .filter(l => l.requestedPrice != null && l.filledPrice != null)
      .map(l => Math.abs((l.filledPrice ?? 0) - (l.requestedPrice ?? 0)));

    const avgSlippage = slippages.length > 0
      ? slippages.reduce((s, v) => s + v, 0) / slippages.length
      : 0;

    // Fee analysis
    const totalFees = filled.reduce((s, l) => s + (l.fee ?? 0), 0);

    return {
      totalExecutions: execLogs.length,
      filled: filled.length,
      failed: failed.length,
      fillRate,
      avgLatencyMs: Math.round(avgLatency),
      avgSlippage,
      totalFees,
      byMode: {
        fast: execLogs.filter(l => l.executionMode === 'FAST_EXEC').length,
        slow: execLogs.filter(l => l.executionMode === 'SLOW_EXEC').length,
      },
      byPlatform: {
        kalshi: execLogs.filter(l => l.platform === 'KALSHI').length,
        polymarket: execLogs.filter(l => l.platform === 'POLYMARKET').length,
      },
      recentExecutions: execLogs.slice(0, 20).map(l => ({
        id: l.id,
        platform: l.platform,
        direction: l.direction,
        status: l.status,
        requestedPrice: l.requestedPrice,
        filledPrice: l.filledPrice,
        fee: l.fee,
        latencyMs: l.latencyMs,
        executionMode: l.executionMode,
        createdAt: l.createdAt,
      })),
    };
  });

  // POST /execution/sync-positions — trigger position reconciliation
  fastify.post('/execution/sync-positions', async () => {
    const { reconcilePositions } = await import('../services/position-sync');
    return reconcilePositions();
  });
}
