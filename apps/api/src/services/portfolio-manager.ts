import { prisma } from '../lib/prisma';
import { CONCENTRATION_LIMITS } from '@apex/shared';
import type { Platform, MarketCategory, EdgeDirection } from '@apex/db';

// ── Kelly Criterion ──

export interface KellyInput {
  cortexProbability: number;
  marketPrice: number;
  bankroll: number;
  kellyMultiplier?: number; // default 0.25 (quarter Kelly)
}

export interface KellyOutput {
  recommendedSize: number;
  kellyFraction: number;
  adjustedFraction: number;
  limitingFactor: string | null;
}

export function calculateKelly(input: KellyInput): KellyOutput {
  const { cortexProbability: p, marketPrice: price, bankroll, kellyMultiplier = 0.25 } = input;

  // Kelly formula: f* = (p * b - q) / b
  // where b = odds = (1/price - 1), q = 1 - p
  const b = (1 / price) - 1;
  const q = 1 - p;

  let kellyFraction = (p * b - q) / b;

  // Clamp to [0, 1] — negative Kelly means don't bet
  kellyFraction = Math.max(0, Math.min(1, kellyFraction));

  // Apply Kelly multiplier (quarter Kelly by default for safety)
  const adjustedFraction = kellyFraction * kellyMultiplier;

  const recommendedSize = Math.round(adjustedFraction * bankroll * 100) / 100;

  return {
    recommendedSize,
    kellyFraction,
    adjustedFraction,
    limitingFactor: null,
  };
}

// ── Concentration Limits ──

export interface ConcentrationCheck {
  pass: boolean;
  violations: string[];
}

export async function checkConcentrationLimits(
  marketId: string,
  category: MarketCategory,
  platform: Platform,
  newPositionSize: number,
  bankroll: number
): Promise<ConcentrationCheck> {
  const violations: string[] = [];

  // Get open positions
  const positions = await prisma.position.findMany({
    where: { isOpen: true },
    include: { market: { select: { id: true, category: true, platform: true } } },
  });

  const totalDeployed = positions.reduce((sum, p) => sum + p.size, 0) + newPositionSize;

  // Single market concentration (5%)
  const sameMarket = positions.filter(p => p.marketId === marketId).reduce((sum, p) => sum + p.size, 0) + newPositionSize;
  if (sameMarket / bankroll > CONCENTRATION_LIMITS.SINGLE_MARKET) {
    violations.push(`Single market: ${((sameMarket / bankroll) * 100).toFixed(1)}% > ${CONCENTRATION_LIMITS.SINGLE_MARKET * 100}%`);
  }

  // Category concentration (25%)
  const sameCategory = positions.filter(p => p.market.category === category).reduce((sum, p) => sum + p.size, 0) + newPositionSize;
  if (sameCategory / bankroll > CONCENTRATION_LIMITS.SINGLE_CATEGORY) {
    violations.push(`Category ${category}: ${((sameCategory / bankroll) * 100).toFixed(1)}% > ${CONCENTRATION_LIMITS.SINGLE_CATEGORY * 100}%`);
  }

  // Platform concentration (60%)
  const samePlatform = positions.filter(p => p.market.platform === platform).reduce((sum, p) => sum + p.size, 0) + newPositionSize;
  if (samePlatform / bankroll > CONCENTRATION_LIMITS.SINGLE_PLATFORM) {
    violations.push(`Platform ${platform}: ${((samePlatform / bankroll) * 100).toFixed(1)}% > ${CONCENTRATION_LIMITS.SINGLE_PLATFORM * 100}%`);
  }

  // Total deployed (80%)
  if (totalDeployed / bankroll > CONCENTRATION_LIMITS.TOTAL_DEPLOYED) {
    violations.push(`Total deployed: ${((totalDeployed / bankroll) * 100).toFixed(1)}% > ${CONCENTRATION_LIMITS.TOTAL_DEPLOYED * 100}%`);
  }

  return { pass: violations.length === 0, violations };
}

// ── Correlation-Adjusted Exposure ──

/**
 * Compute effective portfolio exposure using NEXUS correlation data.
 * Uses the formula: sqrt(sum(s_i^2) + 2 * sum(rho_ij * s_i * s_j))
 * where s_i are position sizes and rho_ij are pairwise correlations.
 *
 * This gives a more accurate risk measure than raw sum — highly correlated
 * positions amplify effective exposure, while uncorrelated positions diversify.
 */
export async function computeEffectiveExposure(
  positions: { marketId: string; size: number }[]
): Promise<{ effectiveExposure: number; naiveExposure: number; diversificationRatio: number }> {
  if (positions.length === 0) {
    return { effectiveExposure: 0, naiveExposure: 0, diversificationRatio: 1 };
  }

  const naiveExposure = positions.reduce((sum, p) => sum + p.size, 0);

  if (positions.length === 1) {
    return { effectiveExposure: naiveExposure, naiveExposure, diversificationRatio: 1 };
  }

  // Fetch NEXUS correlations for all position market pairs
  const marketIds = positions.map(p => p.marketId);
  const correlations = await prisma.causalEdge.findMany({
    where: {
      fromMarketId: { in: marketIds },
      toMarketId: { in: marketIds },
      correlation: { not: null },
    },
    select: { fromMarketId: true, toMarketId: true, correlation: true },
  });

  // Build correlation lookup
  const corrMap = new Map<string, number>();
  for (const c of correlations) {
    if (c.correlation !== null) {
      corrMap.set(`${c.fromMarketId}:${c.toMarketId}`, c.correlation);
      corrMap.set(`${c.toMarketId}:${c.fromMarketId}`, c.correlation);
    }
  }

  // Compute: sqrt(sum(s_i^2) + 2 * sum(rho_ij * s_i * s_j))
  let sumSquares = 0;
  let sumCross = 0;

  for (const p of positions) {
    sumSquares += p.size ** 2;
  }

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const rho = corrMap.get(`${positions[i].marketId}:${positions[j].marketId}`) ?? 0;
      sumCross += 2 * rho * positions[i].size * positions[j].size;
    }
  }

  const effectiveExposure = Math.sqrt(Math.max(0, sumSquares + sumCross));
  const diversificationRatio = naiveExposure > 0 ? effectiveExposure / naiveExposure : 1;

  return { effectiveExposure, naiveExposure, diversificationRatio };
}

// ── Portfolio Summary ──

export async function getPortfolioSummary(bankroll: number) {
  const openPositions = await prisma.position.findMany({
    where: { isOpen: true },
    include: { market: { select: { title: true, platform: true, category: true } } },
  });

  const deployedCapital = openPositions.reduce((sum, p) => sum + p.size, 0);
  const unrealizedPnl = openPositions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  const closedPositions = await prisma.position.findMany({
    where: { isOpen: false },
    select: { realizedPnl: true },
  });
  const realizedPnl = closedPositions.reduce((sum, p) => sum + p.realizedPnl, 0);

  // Correlation-adjusted exposure
  const { effectiveExposure, diversificationRatio } = await computeEffectiveExposure(
    openPositions.map(p => ({ marketId: p.marketId, size: p.size }))
  );

  return {
    totalValue: bankroll + unrealizedPnl + realizedPnl,
    deployedCapital,
    unrealizedPnl,
    realizedPnl,
    portfolioHeat: bankroll > 0 ? deployedCapital / bankroll : 0,
    effectiveExposure,
    diversificationRatio,
    openPositions: openPositions.length,
    positions: openPositions,
  };
}
