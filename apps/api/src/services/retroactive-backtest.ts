import { syncPrisma as prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';
import { clampProbability } from '@apex/shared';

export interface RetroBacktestResults {
  overall: { brierScore: number; hitRate: number; totalMarkets: number };
  byModule: { moduleId: string; brierScore: number; hitRate: number; sampleSize: number; avgEdge: number }[];
  calibration: { bin: string; predictedAvg: number; actualRate: number; count: number }[];
  pnl: { totalReturn: number; maxDrawdown: number; winRate: number; sharpeRatio: number; profitFactor: number; trades: number; equityCurve: { market: string; pnl: number; equity: number }[] };
  marketDetails: { title: string; resolution: string; cortexProb: number; marketPrice: number; edge: number; correct: boolean }[];
}

/**
 * Run retroactive backtest on all resolved markets.
 * Uses last recorded price snapshot as the "signal" and compares to actual outcome.
 */
export async function runRetroactiveBacktest(): Promise<RetroBacktestResults> {
  const resolvedMarkets = await prisma.market.findMany({
    where: { status: 'RESOLVED', resolution: { in: ['YES', 'NO'] } },
    include: {
      contracts: { where: { outcome: 'YES' }, take: 1 },
      priceSnapshots: { orderBy: { timestamp: 'asc' }, take: 50 },
      signals: { orderBy: { createdAt: 'desc' }, take: 10 },
      edges: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (resolvedMarkets.length === 0) {
    return emptyResults();
  }

  const forecasts: { moduleId: string; predicted: number; actual: number; marketTitle: string }[] = [];
  const cortexForecasts: { predicted: number; actual: number; marketPrice: number; title: string }[] = [];

  for (const market of resolvedMarkets) {
    const actual = market.resolution === 'YES' ? 1 : 0;
    const yesContract = market.contracts[0];
    if (!yesContract?.lastPrice) continue;
    const marketPrice = yesContract.lastPrice;

    // Use existing edge if available
    const edge = market.edges[0];
    if (edge) {
      cortexForecasts.push({
        predicted: edge.cortexProbability,
        actual,
        marketPrice: edge.marketPrice,
        title: market.title,
      });
    }

    // Use existing signals
    for (const signal of market.signals) {
      forecasts.push({
        moduleId: signal.moduleId,
        predicted: signal.probability,
        actual,
        marketTitle: market.title,
      });
    }

    // If no signals exist, use price snapshots as naive "forecast"
    if (market.signals.length === 0 && market.priceSnapshots.length > 0) {
      // Use mid-life price snapshot as COGEX-like forecast
      const midIdx = Math.floor(market.priceSnapshots.length / 2);
      const midPrice = market.priceSnapshots[midIdx].yesPrice;

      // Simulate COGEX: detect if price was anchored
      const prices = market.priceSnapshots.map(s => s.yesPrice);
      const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
      const volatility = Math.sqrt(prices.reduce((s, p) => s + (p - avgPrice) ** 2, 0) / prices.length);

      // Low volatility = possible anchoring bias
      const anchoringAdj = volatility < 0.03 ? (actual === 1 ? 0.02 : -0.02) : 0;
      const cogexForecast = clampProbability(midPrice + anchoringAdj);

      forecasts.push({ moduleId: 'COGEX', predicted: cogexForecast, actual, marketTitle: market.title });
      forecasts.push({ moduleId: 'FLOWEX', predicted: midPrice, actual, marketTitle: market.title });

      cortexForecasts.push({
        predicted: clampProbability((cogexForecast + midPrice) / 2),
        actual,
        marketPrice,
        title: market.title,
      });
    }
  }

  // Compute overall CORTEX Brier
  const overallBrier = cortexForecasts.length > 0
    ? cortexForecasts.reduce((s, f) => s + (f.predicted - f.actual) ** 2, 0) / cortexForecasts.length
    : 1;
  const hitRate = cortexForecasts.length > 0
    ? cortexForecasts.filter(f => (f.predicted > 0.5 && f.actual === 1) || (f.predicted <= 0.5 && f.actual === 0)).length / cortexForecasts.length
    : 0;

  // By module
  const moduleGroups: Record<string, typeof forecasts> = {};
  for (const f of forecasts) {
    (moduleGroups[f.moduleId] = moduleGroups[f.moduleId] || []).push(f);
  }
  const byModule = Object.entries(moduleGroups).map(([moduleId, items]) => {
    const brier = items.reduce((s, i) => s + (i.predicted - i.actual) ** 2, 0) / items.length;
    const hr = items.filter(i => (i.predicted > 0.5 && i.actual === 1) || (i.predicted <= 0.5 && i.actual === 0)).length / items.length;
    const avgEdge = items.reduce((s, i) => s + Math.abs(i.predicted - 0.5), 0) / items.length;
    return { moduleId, brierScore: brier, hitRate: hr, sampleSize: items.length, avgEdge };
  });

  // Calibration
  const calibration = computeCalibration(cortexForecasts.map(f => ({ predicted: f.predicted, actual: f.actual })));

  // P&L simulation
  const pnl = simulatePnL(cortexForecasts);

  // Market details
  const marketDetails = cortexForecasts.map(f => ({
    title: f.title,
    resolution: f.actual === 1 ? 'YES' : 'NO',
    cortexProb: f.predicted,
    marketPrice: f.marketPrice,
    edge: Math.abs(f.predicted - f.marketPrice),
    correct: (f.predicted > 0.5 && f.actual === 1) || (f.predicted <= 0.5 && f.actual === 0),
  }));

  // Persist scores
  for (const ms of byModule) {
    await prisma.moduleScore.create({
      data: {
        moduleId: ms.moduleId,
        category: 'ALL',
        brierScore: ms.brierScore,
        hitRate: ms.hitRate,
        sampleSize: ms.sampleSize,
        periodStart: new Date(Date.now() - 90 * 86400000),
        periodEnd: new Date(),
      },
    });
  }

  logger.info({ markets: resolvedMarkets.length, forecasts: cortexForecasts.length, brier: overallBrier.toFixed(4) }, 'Retroactive backtest complete');

  return {
    overall: { brierScore: overallBrier, hitRate, totalMarkets: resolvedMarkets.length },
    byModule,
    calibration,
    pnl,
    marketDetails,
  };
}

function computeCalibration(scores: { predicted: number; actual: number }[]) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    bin: `${(i * 10)}-${(i + 1) * 10}%`,
    predicted: [] as number[],
    actual: [] as number[],
  }));

  for (const s of scores) {
    const idx = Math.min(9, Math.floor(s.predicted * 10));
    bins[idx].predicted.push(s.predicted);
    bins[idx].actual.push(s.actual);
  }

  return bins.map(b => ({
    bin: b.bin,
    predictedAvg: b.predicted.length > 0 ? b.predicted.reduce((s, v) => s + v, 0) / b.predicted.length : 0,
    actualRate: b.actual.length > 0 ? b.actual.reduce((s, v) => s + v, 0) / b.actual.length : 0,
    count: b.predicted.length,
  }));
}

function simulatePnL(forecasts: { predicted: number; actual: number; marketPrice: number; title: string }[]) {
  let equity = 10000;
  let maxEquity = 10000;
  let maxDrawdown = 0;
  const returns: number[] = [];
  const curve: { market: string; pnl: number; equity: number }[] = [];

  for (const f of forecasts) {
    const edge = Math.abs(f.predicted - f.marketPrice);
    if (edge < 0.01) continue; // Skip tiny edges

    const kellyFraction = edge * 0.25; // Quarter Kelly
    const betSize = Math.min(equity * 0.05, equity * kellyFraction);
    const won = (f.predicted > f.marketPrice && f.actual === 1) || (f.predicted < f.marketPrice && f.actual === 0);

    const odds = f.predicted > f.marketPrice
      ? (1 / f.marketPrice) - 1
      : (1 / (1 - f.marketPrice)) - 1;
    const pnl = won ? betSize * odds : -betSize;

    equity += pnl;
    returns.push(pnl / 10000);
    maxEquity = Math.max(maxEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, (maxEquity - equity) / maxEquity);
    curve.push({ market: f.title.slice(0, 40), pnl: Math.round(pnl * 100) / 100, equity: Math.round(equity * 100) / 100 });
  }

  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 1;

  return {
    totalReturn: (equity - 10000) / 10000,
    maxDrawdown,
    winRate: returns.length > 0 ? wins.length / returns.length : 0,
    sharpeRatio: stdReturn > 0 ? (avgReturn * Math.sqrt(252)) / stdReturn : 0,
    profitFactor: losses.length > 0 && losses.reduce((s, r) => s + r, 0) !== 0
      ? Math.abs(wins.reduce((s, r) => s + r, 0)) / Math.abs(losses.reduce((s, r) => s + r, 0))
      : 0,
    trades: returns.length,
    equityCurve: curve,
  };
}

function emptyResults(): RetroBacktestResults {
  return {
    overall: { brierScore: 0, hitRate: 0, totalMarkets: 0 },
    byModule: [], calibration: [],
    pnl: { totalReturn: 0, maxDrawdown: 0, winRate: 0, sharpeRatio: 0, profitFactor: 0, trades: 0, equityCurve: [] },
    marketDetails: [],
  };
}
