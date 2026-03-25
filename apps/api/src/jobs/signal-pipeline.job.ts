import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';
import { SignalOutput } from '@apex/shared';
import { cogexModule } from '../modules/cogex';
import { FlowexModule } from '../modules/flowex';
import { legexModule } from '../modules/legex';
import { domexModule } from '../modules/domex';
import { altexModule } from '../modules/altex';
import { reflexModule } from '../modules/reflex';
import { speedexModule } from '../modules/speedex';
import { synthesize, persistEdge, CortexInput } from '../engine/cortex';
import { fireNewEdgeAlert } from '../engine/alert-engine';
import { enterPaperPosition } from '../services/paper-trader';
import type { MarketWithData } from '../modules/base';

const flowexModule = new FlowexModule();

// Max markets to process per pipeline run (prevents 30-min runs)
const MAX_MARKETS = 100;

// Track pipeline run count for priority scheduling
let pipelineRunCount = 0;

export async function handleSignalPipeline(job: Job): Promise<void> {
  pipelineRunCount++;
  logger.info({ jobId: job.id, runCount: pipelineRunCount }, 'Signal pipeline started');

  try {
    // 1. Check market data freshness
    const latestSync = await prisma.priceSnapshot.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });

    if (!latestSync) {
      logger.warn('No price data available, skipping signal pipeline');
      return;
    }

    const ageMinutes = (Date.now() - latestSync.timestamp.getTime()) / 60000;
    if (ageMinutes > 30) {
      logger.warn({ ageMinutes }, 'Market data is stale, skipping signal pipeline');
      return;
    }

    // 2. Get top active markets by volume (not all 40K)
    const markets = await prisma.market.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { volume: 'desc' },
      take: MAX_MARKETS,
      include: {
        contracts: true,
        priceSnapshots: { orderBy: { timestamp: 'desc' }, take: 200 },
      },
    });

    logger.info({ marketCount: markets.length }, 'Running signal pipeline');

    // 3. Run modules per market
    let totalSignals = 0;
    let totalEdges = 0;

    let marketIndex = 0;
    for (const market of markets) {
      const marketData = market as unknown as MarketWithData;
      const yesContract = market.contracts.find(c => c.outcome === 'YES');
      if (!yesContract?.lastPrice) continue;

      // Flag extreme prices — skip LLM modules but still run COGEX/FLOWEX
      const isExtreme = yesContract.lastPrice < 0.05 || yesContract.lastPrice > 0.95;

      // Priority scheduling by time to resolution
      const daysToClose = market.closesAt
        ? Math.max(0, Math.ceil((market.closesAt.getTime() - Date.now()) / 86400000))
        : 999;
      const isUrgent = daysToClose <= 7;
      const isMedium = daysToClose > 7 && daysToClose <= 30;
      const isLong = daysToClose > 30;

      // LLM modules: urgent = every cycle, medium = every 2nd, long = every 4th
      const skipLLMThisCycle = !isExtreme && (
        (isMedium && pipelineRunCount % 2 !== 0) ||
        (isLong && pipelineRunCount % 4 !== 0)
      );

      // Extend lock to prevent stall detection on long pipeline runs
      if (marketIndex % 10 === 0 && job.extendLock) {
        try { await job.extendLock(job.token!, 300000); } catch { /* ignore */ }
      }
      marketIndex++;

      // Run COGEX + FLOWEX (no LLM, fast)
      const [cogexResult, flowexResult] = await Promise.allSettled([
        cogexModule.run(marketData),
        flowexModule.run(marketData),
      ]);

      const signals: SignalOutput[] = [];
      if (cogexResult.status === 'fulfilled' && cogexResult.value) signals.push(cogexResult.value);
      if (flowexResult.status === 'fulfilled' && flowexResult.value) signals.push(flowexResult.value);

      // Run SPEEDEX (no LLM, fast — crypto latency detection)
      const speedexResult = await speedexModule.run(marketData).catch(() => null);
      if (speedexResult) signals.push(speedexResult);

      // Run LLM modules (LEGEX, DOMEX, ALTEX, REFLEX) — skip extreme/deprioritized markets, limit total calls
      if (!isExtreme && !skipLLMThisCycle && totalSignals < 40) {
        const [legexResult, domexResult, altexResult, reflexResult] = await Promise.allSettled([
          legexModule.run(marketData),
          domexModule.run(marketData),
          altexModule.run(marketData),
          reflexModule.run(marketData),
        ]);

        // Date sanity check: penalize confidence if reasoning references stale years
        const { checkDateStaleness } = require('../lib/date-context');
        const llmResults = [
          legexResult.status === 'fulfilled' ? legexResult.value : null,
          domexResult.status === 'fulfilled' ? domexResult.value : null,
          altexResult.status === 'fulfilled' ? altexResult.value : null,
          reflexResult.status === 'fulfilled' ? reflexResult.value : null,
        ];
        for (const sig of llmResults) {
          if (!sig) continue;
          const { isStale, penalty, staleYears } = checkDateStaleness(sig.reasoning || '');
          if (isStale) {
            sig.confidence *= penalty;
            logger.warn({ moduleId: sig.moduleId, marketId: market.id, staleYears }, 'Stale year reference detected — confidence reduced 50%');
          }
          signals.push(sig);
        }

        // Log LLM failures for debugging
        if (legexResult.status === 'rejected') logger.debug({ err: (legexResult.reason as Error)?.message, marketId: market.id }, 'LEGEX failed');
        if (domexResult.status === 'rejected') logger.debug({ err: (domexResult.reason as Error)?.message, marketId: market.id }, 'DOMEX failed');
        if (altexResult.status === 'rejected') logger.debug({ err: (altexResult.reason as Error)?.message, marketId: market.id }, 'ALTEX failed');
      }

      // Persist signals
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

      totalSignals += signals.length;

      if (signals.length > 0) {
        logger.info({ marketId: market.id, title: market.title.slice(0, 50), signals: signals.map(s => s.moduleId) }, 'Signals produced');
      }

      // 4. CORTEX v2 synthesis
      if (signals.length > 0) {
        const edge = synthesize({
          marketId: market.id,
          marketPrice: yesContract.lastPrice,
          marketCategory: market.category,
          signals,
          closesAt: market.closesAt,
        });

        await persistEdge(edge);
        totalEdges++;

        // Fire alert for significant edges
        if (edge.edgeMagnitude > 0.02) {
          await fireNewEdgeAlert(
            market.title,
            market.id,
            edge.edgeMagnitude,
            edge.expectedValue,
            edge.edgeDirection
          ).catch(() => {}); // Don't fail pipeline on alert error
        }

        // Auto-enter paper position for actionable edges
        if (edge.isActionable) {
          await enterPaperPosition(edge, edge.cortexProbability, edge.daysToResolution).catch(() => {});
        }
      }

      // Yield event loop
      await new Promise(r => setImmediate(r));
    }

    // Count tier distribution
    const tierCounts = { urgent: 0, medium: 0, long: 0 };
    for (const m of markets) {
      const d = m.closesAt ? Math.max(0, Math.ceil((m.closesAt.getTime() - Date.now()) / 86400000)) : 999;
      if (d <= 7) tierCounts.urgent++;
      else if (d <= 30) tierCounts.medium++;
      else tierCounts.long++;
    }
    logger.info({ totalSignals, totalEdges, marketsProcessed: markets.length, runCount: pipelineRunCount, ...tierCounts }, 'Signal pipeline completed');
  } catch (err) {
    logger.error(err, 'Signal pipeline failed');
    throw err;
  }
}
