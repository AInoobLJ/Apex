import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';
import { SignalOutput } from '@apex/shared';
import { cogexModule } from '../modules/cogex';
import { flowexModule } from '../modules/flowex';
import { legexModule } from '../modules/legex';
import { domexModule } from '../modules/domex';
import { altexModule } from '../modules/altex';
// REFLEX disabled — V3 review Grade D: unfalsifiable LLM analysis, no real data source, $1-2/day cost.
// Code retained in modules/reflex.ts for potential re-enablement if calibration data shows value.
// import { reflexModule } from '../modules/reflex';
import { speedexModule } from '../modules/speedex';
import { synthesize, persistEdge, persistTrainingSnapshot, CortexInput } from '../engine/cortex';
import { fireNewEdgeAlert } from '../engine/alert-engine';
import { getTradingService } from '../services/trading-service';
import { buildScanPool, scanMarkets, calculateDeepAnalysisBudget, ScanResult } from '../services/market-scanner';
import { getLLMBudgetStatus } from '../services/llm-budget-tracker';
import { shouldSkipModule, createSkipTracker } from '../services/module-skip-rules';
import type { MarketWithData } from '../modules/base';

// ── Phase 2 Limits ──
const MIN_DEEP_MARKETS = 10;
const MAX_DEEP_MARKETS = 30;
const MIN_SCREENING_SCORE = 5; // Below this, not worth deep analysis
const SPORTS_CATEGORIES = new Set(['SPORTS']);

/**
 * Fetch recent, non-expired signals from the DB for a market and merge
 * with freshly-generated signals. Prefers fresh signals when the same
 * module appears in both sets (dedup by moduleId, keep the newer one).
 *
 * This allows SPEEDEX/FLOWEX signals produced by the speed pipeline to
 * contribute to research pipeline edges, increasing module count for
 * the "2+ modules" actionability gate.
 */
async function mergePreExistingSignals(
  marketId: string,
  freshSignals: SignalOutput[],
): Promise<SignalOutput[]> {
  const freshModuleIds = new Set(freshSignals.map(s => s.moduleId));

  // Fetch the most recent non-expired signal per module for this market
  const dbSignals = await prisma.signal.findMany({
    where: {
      marketId,
      expiresAt: { gt: new Date() },
      // Only fetch modules NOT already in fresh signals (they'd be older)
      moduleId: { notIn: [...freshModuleIds] },
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['moduleId'],
  });

  if (dbSignals.length === 0) return freshSignals;

  // Convert DB signals to SignalOutput format
  const merged = [...freshSignals];
  for (const dbSig of dbSignals) {
    merged.push({
      moduleId: dbSig.moduleId,
      marketId: dbSig.marketId,
      probability: dbSig.probability,
      confidence: dbSig.confidence,
      reasoning: dbSig.reasoning ?? '',
      metadata: (dbSig.metadata as Record<string, unknown>) ?? {},
      timestamp: dbSig.createdAt,
      expiresAt: dbSig.expiresAt ?? new Date(Date.now() + 3600000),
    });
  }

  return merged;
}

// Track pipeline run count for metrics
let pipelineRunCount = 0;

/**
 * Two-Phase Signal Pipeline
 *
 * Phase 0: BUILD SCAN POOL — filter to tradeable markets (DB query)
 * Phase 1: SCAN — score all scan pool markets with cheap modules (no LLM)
 * Phase 2: DEEP ANALYZE — run LLM modules on top-N candidates only
 *
 * This replaces the old approach of randomly sampling ~50 markets.
 * Now we scan 500-1000+ markets cheaply, then focus LLM budget on the best candidates.
 */
export async function handleSignalPipeline(job: Job): Promise<void> {
  pipelineRunCount++;
  const cycleStart = Date.now();
  if (pipelineRunCount === 1) {
    logger.info('REFLEX module disabled — insufficient signal quality (V3 review: Grade D)');
  }
  logger.info({ jobId: job.id, runCount: pipelineRunCount }, 'Signal pipeline started (two-phase)');

  try {
    // ── Freshness check ──
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

    // ── Fetch adaptive fusion weights from ModuleScore (once per cycle) ──
    const recentScores = await prisma.moduleScore.findMany({
      where: { periodEnd: { gte: new Date(Date.now() - 90 * 86400000) } },
      orderBy: { periodEnd: 'desc' },
    });
    // Aggregate per module: average Brier, total samples
    const scoreMap: Record<string, { totalBrier: number; totalSamples: number; count: number }> = {};
    for (const s of recentScores) {
      scoreMap[s.moduleId] = scoreMap[s.moduleId] || { totalBrier: 0, totalSamples: 0, count: 0 };
      scoreMap[s.moduleId].totalBrier += s.brierScore;
      scoreMap[s.moduleId].totalSamples += s.sampleSize;
      scoreMap[s.moduleId].count++;
    }
    const moduleScoresForFusion = Object.entries(scoreMap).map(([moduleId, v]) => ({
      moduleId,
      brierScore: v.totalBrier / v.count,
      sampleSize: v.totalSamples,
    }));
    if (moduleScoresForFusion.length > 0) {
      logger.info({ modules: moduleScoresForFusion.length, scores: moduleScoresForFusion.map(s => `${s.moduleId}=${s.brierScore.toFixed(3)}`) }, 'Adaptive fusion weights loaded');
    }

    // ════════════════════════════════════════════════════════════
    // PHASE 0: BUILD SCAN POOL
    // ════════════════════════════════════════════════════════════
    const phase0Start = Date.now();
    const { markets: scanPool, stats: poolStats } = await buildScanPool();
    const phase0Ms = Date.now() - phase0Start;

    if (scanPool.length === 0) {
      logger.warn('Scan pool empty — no tradeable markets found');
      return;
    }

    // ════════════════════════════════════════════════════════════
    // PHASE 1: SCAN (cheap, broad — no LLM)
    // ════════════════════════════════════════════════════════════
    const phase1Start = Date.now();
    const scanResults = await scanMarkets(scanPool);
    const phase1Ms = Date.now() - phase1Start;

    // Separate candidates by type
    const candidates = scanResults.filter(r => r.screeningScore >= MIN_SCREENING_SCORE);
    const sportsCandidates = candidates.filter(r => r.isSports);
    const nonSportsCandidates = candidates.filter(r => !r.isSports);

    logger.info({
      phase0Ms,
      phase1Ms,
      scanPoolSize: scanPool.length,
      candidatesAboveThreshold: candidates.length,
      sportsCandidates: sportsCandidates.length,
      nonSportsCandidates: nonSportsCandidates.length,
      topScore: candidates[0]?.screeningScore ?? 0,
      topMarket: candidates[0]?.title?.slice(0, 50),
    }, `[SCAN] Phase 1 complete: ${candidates.length} candidates from ${scanPool.length} scanned`);

    // ════════════════════════════════════════════════════════════
    // PHASE 2: DEEP ANALYZE (LLM, selective)
    // ════════════════════════════════════════════════════════════
    const phase2Start = Date.now();

    // Calculate LLM budget for this cycle
    const budgetStatus = await getLLMBudgetStatus();
    const deepBudget = calculateDeepAnalysisBudget(budgetStatus.remaining);

    // Sports markets: NO CAP — Fuku is $0, analyze every single one
    // Non-sports markets: budget-gated by LLM cost, ranked by Phase 1 score
    // Merit-based: top N candidates get LLM analysis regardless of market type.
    // Module skip rules handle relevance (LEGEX skips brackets, etc.)
    const sportsToAnalyze = sportsCandidates; // ALL sports — Fuku is free
    const nonSportsToAnalyze = nonSportsCandidates.slice(0, deepBudget);

    const allToAnalyze = [...sportsToAnalyze, ...nonSportsToAnalyze];

    logger.info({
      llmBudgetRemaining: `$${budgetStatus.remaining.toFixed(2)}`,
      deepBudgetSlots: deepBudget,
      sportsToAnalyze: sportsToAnalyze.length,
      nonSportsToAnalyze: nonSportsToAnalyze.length,
      totalToAnalyze: allToAnalyze.length,
    }, `[DEEP] Analyzing ${allToAnalyze.length} markets (budget: $${budgetStatus.remaining.toFixed(2)} remaining)`);

    // Fetch full market data for selected candidates
    const marketIds = allToAnalyze.map(r => r.marketId);
    const fullMarkets = await prisma.market.findMany({
      where: { id: { in: marketIds } },
      include: {
        contracts: true,
        priceSnapshots: { orderBy: { timestamp: 'desc' }, take: 200 },
      },
    });

    // Index by ID for lookup
    const marketById = new Map(fullMarkets.map(m => [m.id, m]));

    // ── Process each market ──
    let totalSignals = 0;
    let totalEdges = 0;
    let llmMarketsThisCycle = 0;
    let actionableEdges = 0;
    let paperTradesCreated = 0;
    let paperTradesRejected = 0;
    const signalsByModule: Record<string, number> = {};
    const llmCallCounts: Record<string, number> = { ALTEX: 0, LEGEX: 0, DOMEX: 0 };
    const skipTracker = createSkipTracker();

    // ── Directional bias tracking ──
    let buyYesCount = 0;
    let buyNoCount = 0;
    const edgeDirectionsByModule: Record<string, { yes: number; no: number }> = {};

    for (const candidate of allToAnalyze) {
      try {
        const market = marketById.get(candidate.marketId);
        if (!market) continue;

        const marketData = market as unknown as MarketWithData;
        const yesContract = market.contracts.find(c => c.outcome === 'YES');
        if (!yesContract?.lastPrice) continue;

        // Extend lock to prevent stall detection
        if (job.extendLock) {
          try { await job.extendLock(job.token!, 1800000); } catch { /* ignore */ }
        }

        const isSports = SPORTS_CATEGORIES.has(market.category);
        const isExtreme = yesContract.lastPrice < 0.05 || yesContract.lastPrice > 0.95;

        // ── Run cheap modules (always) ──
        const [cogexResult, flowexResult] = await Promise.allSettled([
          cogexModule.run(marketData),
          flowexModule.run(marketData),
        ]);

        const signals: SignalOutput[] = [];
        if (cogexResult.status === 'fulfilled' && cogexResult.value) signals.push(cogexResult.value);
        if (flowexResult.status === 'fulfilled' && flowexResult.value) signals.push(flowexResult.value);

        // SPEEDEX (no LLM — crypto latency detection)
        const speedexResult = await speedexModule.run(marketData).catch(() => null);
        if (speedexResult) signals.push(speedexResult);

        // ── Run LLM modules (Phase 2 deep analysis) ──
        if (isSports && !isExtreme) {
          // Sports: DOMEX only (Fuku passthrough, $0 cost)
          const domexResult = await domexModule.run(marketData).catch(() => null);
          if (domexResult) {
            signals.push(domexResult);
            llmCallCounts.DOMEX++;
          }
        } else if (!isExtreme) {
          // Non-sports: LLM suite with skip rules
          llmMarketsThisCycle++;

          const marketCtx = { title: market.title, category: market.category, closesAt: market.closesAt };

          // Check skip rules
          const legexSkip = shouldSkipModule('LEGEX', marketCtx);
          const altexSkip = shouldSkipModule('ALTEX', marketCtx);

          if (legexSkip.skipped) skipTracker.recordSkip('LEGEX', market.id, legexSkip.reason!);
          if (altexSkip.skipped) skipTracker.recordSkip('ALTEX', market.id, altexSkip.reason!);

          const skippedModules = [
            ...(legexSkip.skipped ? ['LEGEX'] : []),
            ...(altexSkip.skipped ? ['ALTEX'] : []),
          ];

          logger.info({
            marketId: market.id,
            title: market.title.slice(0, 40),
            screeningScore: candidate.screeningScore,
            reasons: candidate.reasons,
            llmCount: llmMarketsThisCycle,
            skipped: skippedModules.length > 0 ? skippedModules : undefined,
          }, '[DEEP] Running LLM modules');

          // Run non-skipped modules in parallel
          const modulePromises: Promise<PromiseSettledResult<SignalOutput | null>>[] = [];
          const moduleNames: string[] = [];

          if (!legexSkip.skipped) {
            modulePromises.push(legexModule.run(marketData).then(v => ({ status: 'fulfilled' as const, value: v })).catch(reason => ({ status: 'rejected' as const, reason })));
            moduleNames.push('LEGEX');
          }
          // DOMEX: always run. ALTEX: skip on short-duration brackets. REFLEX disabled (V3 review: Grade D).
          modulePromises.push(domexModule.run(marketData).then(v => ({ status: 'fulfilled' as const, value: v })).catch(reason => ({ status: 'rejected' as const, reason })));
          moduleNames.push('DOMEX');
          if (!altexSkip.skipped) {
            modulePromises.push(altexModule.run(marketData).then(v => ({ status: 'fulfilled' as const, value: v })).catch(reason => ({ status: 'rejected' as const, reason })));
            moduleNames.push('ALTEX');
          }

          const results = await Promise.all(modulePromises);

          // Date sanity check
          const { checkDateStaleness } = require('../lib/date-context');

          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const name = moduleNames[i];
            if (result.status === 'fulfilled' && result.value) {
              const sig = result.value;
              const { isStale, penalty, staleYears } = checkDateStaleness(sig.reasoning || '');
              if (isStale) {
                sig.confidence *= penalty;
                logger.warn({ moduleId: sig.moduleId, marketId: market.id, staleYears },
                  'Stale year reference detected — confidence reduced 50%');
              }
              signals.push(sig);
              llmCallCounts[name]++;
            } else if (result.status === 'rejected') {
              logger.debug({
                err: (result.reason as Error)?.message,
                marketId: market.id,
              }, `${name} failed`);
            }
          }
        }

        // ── Merge pre-existing signals from DB (e.g., SPEEDEX from speed pipeline) ──
        const mergedSignals = await mergePreExistingSignals(market.id, signals);

        // ── Persist signals with deduplication ──
        for (const signal of signals) {
          const lastSignal = await prisma.signal.findFirst({
            where: { moduleId: signal.moduleId, marketId: signal.marketId },
            orderBy: { createdAt: 'desc' },
            select: { probability: true, reasoning: true },
          });

          if (lastSignal
            && Math.abs(lastSignal.probability - signal.probability) < 0.001
            && lastSignal.reasoning?.slice(0, 80) === signal.reasoning?.slice(0, 80)
          ) {
            continue; // Duplicate
          }

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
        for (const sig of signals) {
          signalsByModule[sig.moduleId] = (signalsByModule[sig.moduleId] || 0) + 1;
        }

        // ── CORTEX synthesis (uses merged signals — includes DB signals from speed pipeline) ──
        if (mergedSignals.length > 0) {
          const edge = synthesize({
            marketId: market.id,
            marketPrice: yesContract.lastPrice,
            marketCategory: market.category,
            signals: mergedSignals,
            closesAt: market.closesAt,
            moduleScores: moduleScoresForFusion,
          });

          await persistEdge(edge);
          await persistTrainingSnapshot(edge, signals);
          totalEdges++;
          if (edge.isActionable) actionableEdges++;

          // Track directional bias
          if (edge.edgeDirection === 'BUY_YES') buyYesCount++;
          else buyNoCount++;

          // Track direction by contributing module for diagnostics
          for (const sig of edge.signals) {
            if (!edgeDirectionsByModule[sig.moduleId]) {
              edgeDirectionsByModule[sig.moduleId] = { yes: 0, no: 0 };
            }
            if (sig.probability > edge.marketPrice) {
              edgeDirectionsByModule[sig.moduleId].yes++;
            } else {
              edgeDirectionsByModule[sig.moduleId].no++;
            }
          }

          // Alert for significant edges
          if (edge.edgeMagnitude > 0.02) {
            await fireNewEdgeAlert(
              market.title,
              market.id,
              edge.edgeMagnitude,
              edge.expectedValue,
              edge.edgeDirection,
            ).catch(() => {});
          }

          // Execute through TradingService
          if (edge.isActionable) {
            const tradeResult = await getTradingService().executeEdge(edge).catch((err) => {
              logger.error({ marketId: market.id, err: err?.message }, 'TradingService.executeEdge failed');
              return null;
            });
            if (tradeResult) {
              if (tradeResult.executed) {
                paperTradesCreated++;
              } else {
                paperTradesRejected++;
                logger.info({ marketId: market.id, reason: tradeResult.reason }, 'Paper trade skipped by preflight');
              }
            }
          }
        }

        // Yield event loop
        await new Promise(r => setImmediate(r));
      } catch (marketErr: any) {
        logger.error({ marketId: candidate.marketId, err: marketErr.message },
          'Market analysis failed — skipping, continuing pipeline');
      }
    }

    const phase2Ms = Date.now() - phase2Start;
    const totalMs = Date.now() - cycleStart;

    // ════════════════════════════════════════════════════════════
    // CYCLE SUMMARY
    // ════════════════════════════════════════════════════════════
    const sportsProcessed = allToAnalyze.filter(r => r.isSports).length;
    const nonSportsProcessed = allToAnalyze.filter(r => !r.isSports).length;
    const skipMetrics = skipTracker.getMetrics();

    if (skipMetrics.totalSkips > 0) {
      logger.info({
        modulesSkipped: skipMetrics.totalSkips,
        byModule: skipMetrics.byModule,
        estimatedLLMCallsSaved: skipMetrics.estimatedLLMCallsSaved,
      }, `Modules skipped this cycle: ${skipMetrics.totalSkips}, estimated LLM calls saved: ${skipMetrics.estimatedLLMCallsSaved}`);
    }

    logger.info({
      // Timing
      phase0Ms,
      phase1Ms,
      phase2Ms,
      totalMs,
      // Scan pool
      totalActiveMarkets: poolStats.totalActive,
      scanPoolSize: poolStats.scanPoolSize,
      // Scan results
      marketsScanned: scanResults.length,
      candidatesAboveThreshold: candidates.length,
      // Deep analysis
      marketsAnalyzed: allToAnalyze.length,
      sportsProcessed,
      nonSportsProcessed,
      llmMarketsThisCycle,
      llmCallCounts,
      // Module skip metrics
      moduleSkips: skipMetrics.byModule,
      llmCallsSaved: skipMetrics.estimatedLLMCallsSaved,
      // Output
      totalSignals,
      totalEdges,
      actionableEdges,
      signalsByModule,
      // Trading
      paperTradesCreated,
      paperTradesRejected,
      // Directional bias monitoring — should be roughly 50/50 over time
      buyYesCount,
      buyNoCount,
      buyYesRatio: totalEdges > 0 ? (buyYesCount / totalEdges).toFixed(2) : 'N/A',
      edgeDirectionsByModule,
      // Meta
      runCount: pipelineRunCount,
    }, `Signal pipeline completed: scanned ${scanResults.length}, deep-analyzed ${allToAnalyze.length}, ${actionableEdges} actionable edges, ${paperTradesCreated} trades, direction: ${buyYesCount}Y/${buyNoCount}N`);

    // ── Directional bias alert ──
    if (totalEdges >= 10) {
      const yesRatio = buyYesCount / totalEdges;
      if (yesRatio > 0.75 || yesRatio < 0.25) {
        logger.warn({
          buyYesCount, buyNoCount, totalEdges,
          yesRatio: yesRatio.toFixed(2),
          edgeDirectionsByModule,
        }, `DIRECTIONAL BIAS ALERT: ${(yesRatio * 100).toFixed(0)}% BUY_YES this cycle (expected ~50%). Check module probability distributions.`);
      }
    }
  } catch (err) {
    logger.error(err, 'Signal pipeline failed');
    throw err;
  }
}
