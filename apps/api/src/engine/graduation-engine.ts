/**
 * GraduationEngine — tracks per-strategy paper trade performance
 * and graduates strategies from paper to live execution.
 *
 * Graduation criteria (all must be met):
 *   - min 20 resolved paper trades
 *   - win rate > 55%
 *   - profit factor > 1.3
 *   - avg edge > 3%
 *   - max single loss < 2x avg win
 *
 * Tracks per (module combo, category) graduation state.
 */
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface GraduationCriteria {
  minTrades: number;
  minWinRate: number;
  minProfitFactor: number;
  minAvgEdge: number;
  maxLossToWinRatio: number;
}

export interface GraduationStatus {
  strategyKey: string;        // e.g., "COGEX+DOMEX|FINANCE"
  category: string;
  modules: string[];
  totalTrades: number;
  resolvedTrades: number;
  winRate: number;
  profitFactor: number;
  avgEdge: number;
  maxLoss: number;
  avgWin: number;
  maxLossToWinRatio: number;
  graduated: boolean;
  criteriaProgress: {
    trades: { current: number; required: number; met: boolean };
    winRate: { current: number; required: number; met: boolean };
    profitFactor: { current: number; required: number; met: boolean };
    avgEdge: { current: number; required: number; met: boolean };
    lossRatio: { current: number; required: number; met: boolean };
  };
  graduatedAt: Date | null;
}

const DEFAULT_CRITERIA: GraduationCriteria = {
  minTrades: 20,
  minWinRate: 0.55,
  minProfitFactor: 1.3,
  minAvgEdge: 0.03,
  maxLossToWinRatio: 2.0,
};

/**
 * Evaluate graduation status for all strategies.
 */
export async function evaluateAllGraduations(
  criteria: GraduationCriteria = DEFAULT_CRITERIA
): Promise<GraduationStatus[]> {
  // Get all closed paper positions with edge data
  const positions = await prisma.paperPosition.findMany({
    where: { isOpen: false },
    include: {
      market: { select: { category: true, title: true, resolution: true } },
    },
  });

  if (positions.length === 0) return [];

  // Group by category (simplified — module combo tracking would need signal join)
  const byCategory: Record<string, typeof positions> = {};
  for (const pos of positions) {
    const cat = pos.market.category || 'OTHER';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(pos);
  }

  const results: GraduationStatus[] = [];

  for (const [category, catPositions] of Object.entries(byCategory)) {
    const resolved = catPositions.filter(p => p.market.resolution != null);
    if (resolved.length === 0) continue;

    // Calculate metrics
    const wins = resolved.filter(p => {
      const resolvedYes = p.market.resolution === 'YES';
      return (p.direction === 'BUY_YES' && resolvedYes) || (p.direction === 'BUY_NO' && !resolvedYes);
    });
    const losses = resolved.filter(p => !wins.includes(p));

    const winRate = resolved.length > 0 ? wins.length / resolved.length : 0;

    const winAmounts = wins.map(p => Math.abs(p.paperPnl || 0));
    const lossAmounts = losses.map(p => Math.abs(p.paperPnl || 0));

    const totalWins = winAmounts.reduce((s, v) => s + v, 0);
    const totalLosses = lossAmounts.reduce((s, v) => s + v, 0);
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

    const avgEdge = resolved.reduce((s, p) => s + (p.edgeAtEntry || 0), 0) / resolved.length;
    const avgWin = winAmounts.length > 0 ? totalWins / winAmounts.length : 0;
    const maxLoss = lossAmounts.length > 0 ? Math.max(...lossAmounts) : 0;
    const lossRatio = avgWin > 0 ? maxLoss / avgWin : 0;

    const criteriaProgress = {
      trades: { current: resolved.length, required: criteria.minTrades, met: resolved.length >= criteria.minTrades },
      winRate: { current: winRate, required: criteria.minWinRate, met: winRate >= criteria.minWinRate },
      profitFactor: { current: profitFactor, required: criteria.minProfitFactor, met: profitFactor >= criteria.minProfitFactor },
      avgEdge: { current: avgEdge, required: criteria.minAvgEdge, met: avgEdge >= criteria.minAvgEdge },
      lossRatio: { current: lossRatio, required: criteria.maxLossToWinRatio, met: lossRatio <= criteria.maxLossToWinRatio },
    };

    const graduated = Object.values(criteriaProgress).every(c => c.met);

    results.push({
      strategyKey: `ALL|${category}`,
      category,
      modules: ['COGEX', 'FLOWEX', 'LEGEX', 'DOMEX', 'ALTEX'],
      totalTrades: catPositions.length,
      resolvedTrades: resolved.length,
      winRate,
      profitFactor,
      avgEdge,
      maxLoss,
      avgWin,
      maxLossToWinRatio: lossRatio,
      graduated,
      criteriaProgress,
      graduatedAt: graduated ? new Date() : null,
    });
  }

  // Persist graduation status
  for (const status of results) {
    await prisma.systemConfig.upsert({
      where: { key: `graduation_${status.strategyKey}` },
      update: { value: JSON.stringify(status) },
      create: { key: `graduation_${status.strategyKey}`, value: JSON.stringify(status) },
    });
  }

  logger.info({
    strategies: results.length,
    graduated: results.filter(s => s.graduated).length,
  }, 'Graduation evaluation complete');

  return results;
}

/**
 * Check if a specific strategy has graduated.
 */
export async function isGraduated(category: string): Promise<boolean> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: `graduation_ALL|${category}` },
    });
    if (!config) return false;
    const status = JSON.parse(config.value as string) as GraduationStatus;
    return status.graduated;
  } catch {
    return false;
  }
}

/**
 * Get all graduation statuses from cache.
 */
export async function getAllGraduationStatuses(): Promise<GraduationStatus[]> {
  const configs = await prisma.systemConfig.findMany({
    where: { key: { startsWith: 'graduation_' } },
  });

  return configs.map(c => JSON.parse(c.value as string) as GraduationStatus);
}
