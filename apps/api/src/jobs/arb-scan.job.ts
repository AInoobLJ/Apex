import { Job } from 'bullmq';
import { Prisma } from '@apex/db';
import { runArbScan, arbToSignals } from '../modules/arbex';
import type { ArbOpportunity } from '../modules/arbex';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { getTradingService } from '../services/trading-service';
import { loadRiskLimits } from '@apex/tradex';
import { kalshiFee } from '@apex/shared';
import type { ArbSignal } from '@apex/tradex';

export async function handleArbScan(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Arb scan job started');

  try {
    const opportunities = await runArbScan();

    if (opportunities.length === 0) {
      logger.info('No arb opportunities found');
      return;
    }

    // Convert to signals and persist
    const signals = arbToSignals(opportunities);

    for (const signal of signals) {
      await prisma.signal.create({
        data: {
          moduleId: signal.moduleId,
          marketId: signal.marketId,
          probability: signal.probability,
          confidence: signal.confidence,
          reasoning: signal.reasoning,
          metadata: JSON.parse(JSON.stringify(signal.metadata)) as Prisma.InputJsonValue,
          expiresAt: signal.expiresAt,
        },
      });
    }

    // Route URGENT arbs through ExecutionManager for preflight validation
    const urgentArbs = opportunities.filter(a => a.urgency === 'URGENT');
    let arbsAttempted = 0;
    let arbsPassed = 0;

    for (const arb of urgentArbs) {
      const result = await routeArbThroughManager(arb).catch((err) => {
        logger.error({ marketId: arb.marketId, err: err?.message }, 'Arb execution failed');
        return null;
      });
      arbsAttempted++;
      if (result?.preflightPassed) arbsPassed++;
    }

    logger.info({
      opportunities: opportunities.length,
      urgent: urgentArbs.length,
      arbsAttempted,
      arbsPassed,
      intra: opportunities.filter(a => a.type === 'INTRA_PLATFORM').length,
      cross: opportunities.filter(a => a.type === 'CROSS_PLATFORM').length,
    }, 'Arb scan job completed');
  } catch (err) {
    logger.error(err, 'Arb scan job failed');
    throw err;
  }
}

/**
 * Route an arb opportunity through ExecutionManager.
 * In PAPER mode: validates via preflight, logs result.
 * In LIVE mode: would execute both legs via executeArb().
 */
async function routeArbThroughManager(arb: ArbOpportunity) {
  const service = getTradingService();
  const manager = service.getManager();

  // Check circuit breakers for arb platforms
  const yesPlatform = arb.yesPlatform ?? arb.platform;
  const noPlatform = arb.noPlatform ?? arb.platform;

  if (manager.isCircuitOpen(yesPlatform)) {
    logger.info({ platform: yesPlatform, marketId: arb.marketId }, 'Arb skipped: circuit breaker open for YES platform');
    return { preflightPassed: false, reason: `Circuit breaker open: ${yesPlatform}` };
  }
  if (manager.isCircuitOpen(noPlatform)) {
    logger.info({ platform: noPlatform, marketId: arb.marketId }, 'Arb skipped: circuit breaker open for NO platform');
    return { preflightPassed: false, reason: `Circuit breaker open: ${noPlatform}` };
  }

  // Build preflight context for the arb
  const tradeSize = arb.contracts * arb.yesPrice; // approximate dollar size
  const fee = kalshiFee(arb.yesPrice, arb.contracts) + kalshiFee(arb.noPrice, arb.contracts);

  const [dailyVolume, openCount] = await Promise.all([
    getDailyTradeVolume(),
    getOpenPositionCount(),
  ]);

  const limits = await loadRiskLimits(async (key) => {
    const config = await prisma.systemConfig.findUnique({ where: { key } });
    return config?.value ?? null;
  });

  // Log arb validation through preflight (in PAPER mode, we just validate)
  const preflightPassed = tradeSize <= limits.maxPerTrade
    && dailyVolume + tradeSize <= limits.maxDailyNewTrades
    && openCount < limits.maxSimultaneousPositions
    && arb.netProfit > 0;

  logger.info({
    marketId: arb.marketId,
    type: arb.type,
    grossSpread: (arb.grossSpread * 100).toFixed(1) + '%',
    netProfit: (arb.netProfit * 100).toFixed(1) + '¢/contract',
    tradeSize: tradeSize.toFixed(2),
    fee: fee.toFixed(3),
    preflightPassed,
    mode: service.getMode(),
  }, preflightPassed ? 'Arb passed preflight validation' : 'Arb rejected by preflight');

  return { preflightPassed, reason: preflightPassed ? 'passed' : 'preflight failed' };
}

async function getDailyTradeVolume(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const positions = await prisma.paperPosition.findMany({
    where: { createdAt: { gte: today } },
  });
  return positions.reduce((sum, p) => sum + p.kellySize * p.entryPrice, 0);
}

async function getOpenPositionCount(): Promise<number> {
  return prisma.paperPosition.count({ where: { isOpen: true } });
}
