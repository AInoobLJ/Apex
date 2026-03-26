/**
 * DualModePipeline — orchestrates Research and Speed mode signal processing.
 *
 * APEX_RESEARCH (resolves 24+ hours): LLM modules → CORTEX → SLOW_EXEC → 15 min cycle
 * APEX_SPEED (resolves <24 hours): Math-only modules → SpeedEdgeScore → FAST_EXEC → 30 sec cycle
 *
 * Markets transition from Research to Speed at 24-hour threshold.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { fuseSignals, calibrate, scoreOpportunity } from './cortex';
import { createOpportunity, transitionOpportunity } from './opportunity-machine';

// Research modules (LLM-powered, expensive, 15 min cycle)
export const RESEARCH_MODULES = ['COGEX', 'FLOWEX', 'LEGEX', 'DOMEX', 'ALTEX', 'REFLEX', 'SIGINT', 'NEXUS'];

// Speed modules (pure math, cheap, 30 sec cycle)
export const SPEED_MODULES = ['SPEEDEX', 'CRYPTEX', 'ARBEX', 'FLOWEX', 'COGEX'];

/**
 * Determine if a market should be in SPEED or RESEARCH mode.
 */
export function classifyMode(closesAt: Date | null): 'RESEARCH' | 'SPEED' {
  if (!closesAt) return 'RESEARCH';
  const hoursRemaining = (closesAt.getTime() - Date.now()) / 3600000;
  return hoursRemaining <= 24 ? 'SPEED' : 'RESEARCH';
}

/**
 * Process a market through the full CORTEX pipeline and create/update Opportunity.
 */
export async function processMarketOpportunity(marketId: string): Promise<void> {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { contracts: { where: { outcome: 'YES' }, take: 1 } },
  });
  if (!market) return;

  const yesPrice = market.contracts[0]?.lastPrice;
  if (!yesPrice || yesPrice <= 0) return;

  const mode = classifyMode(market.closesAt);
  const category = market.category;

  // Step 1: Signal Fusion
  const fused = await fuseSignals(marketId, category);
  if (!fused) return;

  // Step 2: Calibration
  const calibrated = await calibrate({
    fusedProbability: fused.probability,
    confidence: fused.confidence,
    marketPrice: yesPrice,
    category,
    dominantModule: fused.moduleContributions[0]?.moduleId || 'COGEX',
  });

  // Step 3: Opportunity Scoring
  const daysToRes = market.closesAt
    ? Math.max(0.01, (market.closesAt.getTime() - Date.now()) / 86400000)
    : 365;

  const scored = scoreOpportunity({
    cortexProbability: calibrated.calibratedProbability,
    confidence: fused.confidence,
    marketPrice: yesPrice,
    daysToResolution: daysToRes,
    volume: market.volume,
    liquidity: market.liquidity,
    signalCount: fused.signalCount,
  });

  if (!scored.isActionable) return;

  // Step 4: Create or update Opportunity
  const oppId = await createOpportunity({
    marketId,
    platform: market.platform,
    mode,
    discoveredBy: fused.moduleContributions[0]?.moduleId || 'CORTEX',
    marketPriceAtDiscovery: yesPrice,
    signalIds: [],
  });

  // Transition through pipeline
  try {
    await transitionOpportunity(oppId, 'RESEARCHED', 'Signal fusion complete', {
      cortexProbability: calibrated.calibratedProbability,
      edgeMagnitude: scored.edgeMagnitude,
    });

    await transitionOpportunity(oppId, 'RANKED', `EV=${(scored.expectedValue * 100).toFixed(1)}%, rank=${scored.rank}`, {
      expectedValue: scored.expectedValue,
      capitalEfficiencyScore: scored.capitalEfficiencyScore,
      rank: scored.rank,
    });

    // Auto-approve for paper tracking if actionable
    await transitionOpportunity(oppId, 'APPROVED', 'Auto-approved for paper tracking', {
      approvedAt: new Date(),
      approvalType: 'AUTO',
    });

    await transitionOpportunity(oppId, 'PAPER_TRACKING', 'Entering paper tracking', {});

    logger.info({
      opportunityId: oppId,
      marketId,
      mode,
      ev: scored.expectedValue,
      edge: scored.edgeMagnitude,
      direction: scored.edgeDirection,
    }, 'Opportunity pipeline complete');
  } catch (err) {
    logger.debug({ err, oppId }, 'Opportunity transition failed (may already be in correct state)');
  }
}
