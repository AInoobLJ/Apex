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

  return {
    totalValue: bankroll + unrealizedPnl + realizedPnl,
    deployedCapital,
    unrealizedPnl,
    realizedPnl,
    portfolioHeat: bankroll > 0 ? deployedCapital / bankroll : 0,
    openPositions: openPositions.length,
    positions: openPositions,
  };
}
