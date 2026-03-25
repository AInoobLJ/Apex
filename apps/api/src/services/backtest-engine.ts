import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface BacktestResults {
  overall: { brierScore: number; hitRate: number; totalMarkets: number; periodStart: string; periodEnd: string };
  byModule: { moduleId: string; brierScore: number; hitRate: number; valueAdded: number; sampleSize: number }[];
  byCategory: { category: string; brierScore: number; hitRate: number; sampleSize: number }[];
  calibration: { bin: string; predictedAvg: number; actualRate: number; count: number }[];
  pnlSimulation: { totalReturn: number; maxDrawdown: number; sharpeRatio: number; winRate: number; profitFactor: number; equityCurve: { date: string; value: number }[] };
}

/**
 * Run backtesting on resolved markets.
 */
export async function runBacktest(days = 90): Promise<BacktestResults> {
  const since = new Date(Date.now() - days * 86400000);

  // Get resolved markets with their signals and edges
  const resolvedMarkets = await prisma.market.findMany({
    where: { status: 'RESOLVED', resolution: { not: null }, resolutionDate: { gte: since } },
    include: {
      edges: { orderBy: { createdAt: 'desc' }, take: 1 },
      signals: { where: { createdAt: { gte: since } } },
      contracts: { where: { outcome: 'YES' }, take: 1 },
    },
  });

  if (resolvedMarkets.length === 0) {
    return emptyResults(since);
  }

  // Compute Brier scores
  const scores: { moduleId: string; category: string; predicted: number; actual: number }[] = [];
  const edgeScores: { predicted: number; actual: number; category: string }[] = [];

  for (const market of resolvedMarkets) {
    const actual = market.resolution === 'YES' ? 1 : 0;
    const edge = market.edges[0];

    if (edge) {
      edgeScores.push({ predicted: edge.cortexProbability, actual, category: market.category });
    }

    for (const signal of market.signals) {
      scores.push({ moduleId: signal.moduleId, category: market.category, predicted: signal.probability, actual });
    }
  }

  // Overall Brier
  const overallBrier = edgeScores.length > 0
    ? edgeScores.reduce((s, e) => s + (e.predicted - e.actual) ** 2, 0) / edgeScores.length
    : 1;
  const hitRate = edgeScores.length > 0
    ? edgeScores.filter(e => (e.predicted > 0.5 && e.actual === 1) || (e.predicted <= 0.5 && e.actual === 0)).length / edgeScores.length
    : 0;

  // By module
  const moduleGroups = groupBy(scores, 'moduleId');
  const byModule = Object.entries(moduleGroups).map(([moduleId, items]) => ({
    moduleId,
    brierScore: items.reduce((s, i) => s + (i.predicted - i.actual) ** 2, 0) / items.length,
    hitRate: items.filter(i => (i.predicted > 0.5 && i.actual === 1) || (i.predicted <= 0.5 && i.actual === 0)).length / items.length,
    valueAdded: 0, // Would need leave-one-out analysis
    sampleSize: items.length,
  }));

  // By category
  const catGroups = groupBy(edgeScores, 'category');
  const byCategory = Object.entries(catGroups).map(([category, items]) => ({
    category,
    brierScore: items.reduce((s, i) => s + (i.predicted - i.actual) ** 2, 0) / items.length,
    hitRate: items.filter(i => (i.predicted > 0.5 && i.actual === 1) || (i.predicted <= 0.5 && i.actual === 0)).length / items.length,
    sampleSize: items.length,
  }));

  // Calibration bins
  const calibration = computeCalibration(edgeScores);

  // P&L simulation
  const pnlSimulation = simulatePnL(edgeScores);

  // Persist module scores
  for (const ms of byModule) {
    await prisma.moduleScore.create({
      data: {
        moduleId: ms.moduleId,
        category: 'ALL',
        brierScore: ms.brierScore,
        hitRate: ms.hitRate,
        sampleSize: ms.sampleSize,
        periodStart: since,
        periodEnd: new Date(),
      },
    });
  }

  logger.info({ markets: resolvedMarkets.length, modules: byModule.length }, 'Backtest completed');

  return {
    overall: { brierScore: overallBrier, hitRate, totalMarkets: resolvedMarkets.length, periodStart: since.toISOString(), periodEnd: new Date().toISOString() },
    byModule,
    byCategory,
    calibration,
    pnlSimulation,
  };
}

function computeCalibration(scores: { predicted: number; actual: number }[]) {
  const bins: Record<string, { predicted: number[]; actual: number[] }> = {};
  for (let i = 0; i < 10; i++) {
    const key = `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`;
    bins[key] = { predicted: [], actual: [] };
  }

  for (const s of scores) {
    const binIdx = Math.min(9, Math.floor(s.predicted * 10));
    const key = `${(binIdx / 10).toFixed(1)}-${((binIdx + 1) / 10).toFixed(1)}`;
    bins[key].predicted.push(s.predicted);
    bins[key].actual.push(s.actual);
  }

  return Object.entries(bins).map(([bin, data]) => ({
    bin,
    predictedAvg: data.predicted.length > 0 ? data.predicted.reduce((s, v) => s + v, 0) / data.predicted.length : 0,
    actualRate: data.actual.length > 0 ? data.actual.reduce((s, v) => s + v, 0) / data.actual.length : 0,
    count: data.predicted.length,
  }));
}

function simulatePnL(scores: { predicted: number; actual: number }[]) {
  const bankroll = 10000;
  const kellyMult = 0.25;
  let equity = bankroll;
  let maxEquity = bankroll;
  let maxDrawdown = 0;
  const returns: number[] = [];
  const curve: { date: string; value: number }[] = [];

  for (const s of scores) {
    const edge = Math.abs(s.predicted - 0.5);
    if (edge < 0.03) continue;

    const betSize = Math.min(equity * 0.05, equity * kellyMult * edge);
    const won = (s.predicted > 0.5 && s.actual === 1) || (s.predicted <= 0.5 && s.actual === 0);
    const pnl = won ? betSize * (1 / Math.max(s.predicted, 1 - s.predicted) - 1) : -betSize;

    equity += pnl;
    returns.push(pnl / bankroll);
    maxEquity = Math.max(maxEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, (maxEquity - equity) / maxEquity);
    curve.push({ date: new Date().toISOString(), value: equity });
  }

  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 1;

  return {
    totalReturn: (equity - bankroll) / bankroll,
    maxDrawdown,
    sharpeRatio: stdReturn > 0 ? avgReturn / stdReturn : 0,
    winRate: returns.length > 0 ? wins.length / returns.length : 0,
    profitFactor: losses.length > 0 ? Math.abs(wins.reduce((s, r) => s + r, 0)) / Math.abs(losses.reduce((s, r) => s + r, 0)) : 0,
    equityCurve: curve,
  };
}

function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const k = String(item[key]);
    (groups[k] = groups[k] || []).push(item);
  }
  return groups;
}

function emptyResults(since: Date): BacktestResults {
  return {
    overall: { brierScore: 0, hitRate: 0, totalMarkets: 0, periodStart: since.toISOString(), periodEnd: new Date().toISOString() },
    byModule: [], byCategory: [],
    calibration: Array.from({ length: 10 }, (_, i) => ({ bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, predictedAvg: 0, actualRate: 0, count: 0 })),
    pnlSimulation: { totalReturn: 0, maxDrawdown: 0, sharpeRatio: 0, winRate: 0, profitFactor: 0, equityCurve: [] },
  };
}
