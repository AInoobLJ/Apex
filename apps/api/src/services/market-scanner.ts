/**
 * Market Scanner — Two-phase pipeline support.
 *
 * Phase 0: BUILD SCAN POOL
 *   Query DB for active, liquid, tradeable markets.
 *   Filters out expired, resolved (1¢/99¢), and stale markets.
 *   Uses price fallback chain: lastPrice → midpoint(bid,ask) → bestAsk
 *
 * Phase 1: SCAN (cheap, broad)
 *   Run lightweight quantitative checks on all scan pool markets.
 *   Produces a screening score (0-100) for each market.
 *   No LLM calls — only DB queries and math.
 *
 * The signal pipeline uses scan results to select top-N candidates
 * for Phase 2 deep LLM analysis.
 */
import { syncPrisma as prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';
import { config } from '../config';
import { detectFukuSport } from './data-sources/fuku-data';

// ── Active Categories ──
// Configurable via APEX_ACTIVE_CATEGORIES env var (comma-separated).
// Empty string = all categories. Default: CRYPTO,SPORTS for data collection phase.
function getActiveCategories(): string[] | null {
  const raw = config.APEX_ACTIVE_CATEGORIES;
  if (!raw || raw.trim() === '' || raw.trim() === '*') return null; // all categories
  return raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
}

// ── Active Crypto Assets ──
// Only track crypto brackets for these assets. Others have thin Kalshi markets.
const ACTIVE_CRYPTO_ASSETS = ['KXBTC', 'KXETH', 'KXSOL'];

function isSupportedCryptoAsset(platformMarketId: string): boolean {
  return ACTIVE_CRYPTO_ASSETS.some(prefix => platformMarketId.startsWith(prefix));
}

// ── Types ──

export interface ScanPoolStats {
  totalActive: number;
  scanPoolSize: number;
  filteredReasons: Record<string, number>;
}

export interface ScanResult {
  marketId: string;
  title: string;
  category: string;
  platform: string;
  screeningScore: number;  // 0-100
  reasons: string[];       // why this market scored high
  daysToClose: number;
  isSports: boolean;
  hasFukuCoverage: boolean;
  lastPrice: number;
  volume: number;
}

// ── Price Resolution ──

/**
 * Resolve the best available price for a YES contract.
 * Fallback chain: lastPrice → midpoint(bestBid, bestAsk) → bestAsk → bestBid
 * Many Polymarket markets have bestAsk but no lastPrice.
 */
function resolvePrice(contract: {
  lastPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
}): number | null {
  if (contract.lastPrice != null) return contract.lastPrice;
  if (contract.bestBid != null && contract.bestAsk != null) {
    return (contract.bestBid + contract.bestAsk) / 2;
  }
  if (contract.bestAsk != null) return contract.bestAsk;
  if (contract.bestBid != null) return contract.bestBid;
  return null;
}

// ── Phase 0: Build Scan Pool ──

/**
 * Query DB for active, liquid, tradeable markets.
 * Returns markets that pass basic filters:
 * - Status ACTIVE, not expired, resolves within 90 days
 * - Price between 0.03 and 0.97 (not already resolved)
 * - Has some liquidity signal (volume, order book, or any price)
 */
export async function buildScanPool(): Promise<{
  markets: ScanPoolMarket[];
  stats: ScanPoolStats;
}> {
  const now = new Date();
  const ninetyDaysOut = new Date(now.getTime() + 90 * 86400000);

  // Category focus filter
  const activeCategories = getActiveCategories();

  // Get total active count for logging
  const totalActive = await prisma.market.count({ where: { status: 'ACTIVE' } });

  // Phase 0 query: active, not expired, within 90 days, in active categories
  const rawMarkets = await prisma.market.findMany({
    where: {
      status: 'ACTIVE',
      closesAt: {
        gt: now,
        lte: ninetyDaysOut,
      },
      ...(activeCategories ? { category: { in: activeCategories } } : {}),
    },
    select: {
      id: true,
      title: true,
      category: true,
      platform: true,
      platformMarketId: true,
      volume: true,
      liquidity: true,
      closesAt: true,
      createdAt: true,
      contracts: {
        where: { outcome: 'YES' },
        take: 1,
        select: {
          id: true,
          lastPrice: true,
          bestBid: true,
          bestAsk: true,
          volume: true,
        },
      },
    },
    orderBy: { volume: 'desc' },
  });

  const filteredReasons: Record<string, number> = {};
  const incFilter = (reason: string) => {
    filteredReasons[reason] = (filteredReasons[reason] || 0) + 1;
  };

  const markets: ScanPoolMarket[] = [];

  for (const m of rawMarkets) {
    // Filter crypto to supported assets only (BTC/ETH/SOL)
    if (m.category === 'CRYPTO' && m.platformMarketId?.startsWith('KX') && !isSupportedCryptoAsset(m.platformMarketId)) {
      incFilter('unsupported_crypto_asset');
      continue;
    }

    const yesContract = m.contracts[0];
    if (!yesContract) {
      incFilter('no_contract');
      continue;
    }

    // Resolve price with fallback chain: lastPrice → mid(bid,ask) → bestAsk → bestBid
    const price = resolvePrice(yesContract);
    if (price == null) {
      incFilter('no_price');
      continue;
    }

    // Filter: not already resolved (avoid 1¢/99¢ markets)
    if (price < 0.03 || price > 0.97) {
      incFilter('extreme_price');
      continue;
    }

    // Liquidity filter: use available signals
    const hasOrderBook = yesContract.bestBid != null || yesContract.bestAsk != null;
    const spread = (yesContract.bestBid != null && yesContract.bestAsk != null)
      ? (yesContract.bestAsk! - yesContract.bestBid!)
      : null;

    // Include if ANY activity signal: volume, order book, or priced
    if (m.volume < 50 && !hasOrderBook) {
      incFilter('no_liquidity');
      continue;
    }

    // Filter: wide spreads (> $0.15) indicate untradeable markets
    if (spread != null && spread > 0.15) {
      incFilter('wide_spread');
      continue;
    }

    markets.push({
      id: m.id,
      title: m.title,
      category: m.category,
      platform: m.platform,
      volume: m.volume,
      liquidity: m.liquidity,
      closesAt: m.closesAt,
      createdAt: m.createdAt,
      lastPrice: price,
      bestBid: yesContract.bestBid,
      bestAsk: yesContract.bestAsk,
      contractId: yesContract.id,
      contractVolume: yesContract.volume,
    });
  }

  logger.info({
    totalActive,
    scanPoolSize: markets.length,
    filteredReasons,
    rawFetched: rawMarkets.length,
    activeCategories: activeCategories ?? 'ALL',
  }, `Scan pool: ${markets.length} liquid ${activeCategories ? activeCategories.join('+') : 'ALL'} markets out of ${totalActive} total`);

  return {
    markets,
    stats: { totalActive, scanPoolSize: markets.length, filteredReasons },
  };
}

interface ScanPoolMarket {
  id: string;
  title: string;
  category: string;
  platform: string;
  volume: number;
  liquidity: number;
  closesAt: Date | null;
  createdAt: Date;
  lastPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  contractId: string;
  contractVolume: number;
}

// ── Phase 1: Scan (Screening Score) ──

/**
 * Score all scan pool markets using cheap quantitative signals.
 * Returns sorted results (highest score first).
 *
 * Scoring heuristics (max 100):
 * - Price movement in last 4h: 0-25 pts
 * - Order book imbalance: 0-15 pts
 * - Fuku edge for sports: 0-25 pts
 * - Time urgency (resolves soon): 0-15 pts
 * - Market freshness (new market): 0-10 pts
 * - Volume activity: 0-10 pts
 */
export async function scanMarkets(markets: ScanPoolMarket[]): Promise<ScanResult[]> {
  if (markets.length === 0) return [];

  const start = Date.now();

  // Batch-fetch recent price snapshots for movement detection
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const marketIds = markets.map(m => m.id);

  // Get recent price snapshots for all markets in one query
  const [recentSnapshots, orderBookSnapshots] = await Promise.all([
    prisma.priceSnapshot.findMany({
      where: {
        marketId: { in: marketIds },
        timestamp: { gte: twentyFourHoursAgo },
      },
      select: {
        marketId: true,
        yesPrice: true,
        timestamp: true,
        volume: true,
      },
      orderBy: { timestamp: 'desc' },
    }),
    prisma.orderBookSnapshot.findMany({
      where: {
        contract: { marketId: { in: marketIds } },
        timestamp: { gte: fourHoursAgo },
      },
      select: {
        contract: { select: { marketId: true } },
        totalBidDepth: true,
        totalAskDepth: true,
        spread: true,
        timestamp: true,
      },
      orderBy: { timestamp: 'desc' },
    }),
  ]);

  // Index snapshots by market
  const pricesByMarket = new Map<string, typeof recentSnapshots>();
  for (const snap of recentSnapshots) {
    const list = pricesByMarket.get(snap.marketId) || [];
    list.push(snap);
    pricesByMarket.set(snap.marketId, list);
  }

  const obByMarket = new Map<string, typeof orderBookSnapshots>();
  for (const snap of orderBookSnapshots) {
    const mId = snap.contract.marketId;
    const list = obByMarket.get(mId) || [];
    list.push(snap);
    obByMarket.set(mId, list);
  }

  // Check which markets were recently scanned with no signal
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const recentScans = await prisma.signal.findMany({
    where: {
      marketId: { in: marketIds },
      createdAt: { gte: threeHoursAgo },
    },
    select: { marketId: true },
    distinct: ['marketId'],
  });
  const recentlyScannedIds = new Set(recentScans.map(s => s.marketId));

  // Score each market
  const results: ScanResult[] = [];

  for (const market of markets) {
    let score = 0;
    const reasons: string[] = [];

    const daysToClose = market.closesAt
      ? Math.max(0, (market.closesAt.getTime() - Date.now()) / 86400000)
      : 999;

    const isSports = market.category === 'SPORTS';
    const hasFuku = isSports && detectFukuSport(market.title) != null;

    // ── Price Movement Score (0-25) ──
    const prices = pricesByMarket.get(market.id) || [];
    const recent4h = prices.filter(p => p.timestamp >= fourHoursAgo);
    if (recent4h.length >= 2) {
      const oldest = recent4h[recent4h.length - 1].yesPrice;
      const newest = recent4h[0].yesPrice;
      const movement = Math.abs(newest - oldest);

      if (movement > 0.10) {
        score += 25;
        reasons.push(`price-movement-${(movement * 100).toFixed(0)}pct`);
      } else if (movement > 0.05) {
        score += 18;
        reasons.push(`price-movement-${(movement * 100).toFixed(0)}pct`);
      } else if (movement > 0.02) {
        score += 10;
        reasons.push('moderate-price-movement');
      }
    }
    // Penalize stale markets: no price change in 24h
    if (prices.length >= 2) {
      const oldest24h = prices[prices.length - 1].yesPrice;
      const newest24h = prices[0].yesPrice;
      if (Math.abs(newest24h - oldest24h) < 0.005) {
        score -= 10; // Stale — efficiently priced or dead
      }
    }

    // ── Order Book Imbalance Score (0-15) ──
    const obs = obByMarket.get(market.id) || [];
    if (obs.length > 0) {
      const latest = obs[0];
      const totalDepth = latest.totalBidDepth + latest.totalAskDepth;
      if (totalDepth > 0) {
        const bidFraction = latest.totalBidDepth / totalDepth;
        const imbalance = Math.abs(bidFraction - 0.5); // 0 = balanced, 0.5 = max imbalance

        if (imbalance > 0.20) {
          score += 15;
          reasons.push(`ob-imbalance-${bidFraction > 0.5 ? 'bid' : 'ask'}-heavy`);
        } else if (imbalance > 0.10) {
          score += 8;
          reasons.push('moderate-ob-imbalance');
        }
      }
    }

    // ── Fuku Edge Score (0-25) ──
    if (hasFuku) {
      score += 15; // Fuku coverage is valuable — free analysis
      reasons.push('fuku-coverage');
      // Additional boost if it's a match (not futures)
      if (daysToClose < 3) {
        score += 10;
        reasons.push('fuku-imminent-match');
      }
    }

    // ── Time Urgency Score (0-15) ──
    if (daysToClose <= 1) {
      score += 15;
      reasons.push('resolves-today');
    } else if (daysToClose <= 3) {
      score += 12;
      reasons.push('resolves-3d');
    } else if (daysToClose <= 7) {
      score += 8;
      reasons.push('resolves-7d');
    }

    // ── Market Freshness Score (0-10) ──
    const ageHours = (Date.now() - market.createdAt.getTime()) / 3600000;
    if (ageHours < 24) {
      score += 10;
      reasons.push('new-market');
    } else if (ageHours < 72) {
      score += 5;
      reasons.push('recent-market');
    }

    // ── Volume Activity Score (0-10) ──
    if (market.volume > 10000) {
      score += 10;
      reasons.push('high-volume');
    } else if (market.volume > 2000) {
      score += 6;
      reasons.push('moderate-volume');
    } else if (market.volume > 500) {
      score += 3;
      reasons.push('low-volume');
    }

    // ── Penalty: Recently scanned with signal (no need to re-scan) ──
    if (recentlyScannedIds.has(market.id)) {
      score -= 5;
    }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    results.push({
      marketId: market.id,
      title: market.title,
      category: market.category,
      platform: market.platform,
      screeningScore: score,
      reasons,
      daysToClose,
      isSports,
      hasFukuCoverage: hasFuku,
      lastPrice: market.lastPrice,
      volume: market.volume,
    });
  }

  // Sort by screening score descending
  results.sort((a, b) => b.screeningScore - a.screeningScore);

  const elapsed = Date.now() - start;
  logger.info({
    marketsScanned: results.length,
    elapsedMs: elapsed,
    topScore: results[0]?.screeningScore ?? 0,
    aboveThreshold20: results.filter(r => r.screeningScore > 20).length,
    breakdown: {
      priceMovement: results.filter(r => r.reasons.some(s => s.startsWith('price-movement'))).length,
      obImbalance: results.filter(r => r.reasons.some(s => s.includes('ob-imbalance'))).length,
      fukuEdge: results.filter(r => r.reasons.includes('fuku-coverage')).length,
      newMarket: results.filter(r => r.reasons.includes('new-market')).length,
      timeUrgent: results.filter(r => r.reasons.some(s => s.startsWith('resolves-'))).length,
    },
  }, `[SCAN] Scanned ${results.length} markets in ${elapsed}ms`);

  return results;
}

/**
 * Calculate how many non-sports markets to deep-analyze based on LLM budget.
 *
 * Aggressive strategy: use 80% of remaining daily budget this cycle.
 * If budget is healthy (>50% remaining for the day), go up to 50.
 * Minimum 15 (even if budget is low — need signal volume to learn).
 */
export function calculateDeepAnalysisBudget(
  remainingBudget: number,
  costPerMarket: number = 0.03, // ~$0.02-0.05 for Haiku feature extraction
): number {
  // Use 80% of remaining budget this cycle — be aggressive, we need signal data
  const aggressiveBudget = remainingBudget * 0.80;
  const n = Math.floor(aggressiveBudget / costPerMarket);

  // If budget is healthy (>$5 remaining = >50% of $10 daily), allow up to 50
  const maxSlots = remainingBudget > 5.00 ? 50 : 30;

  return Math.max(15, Math.min(maxSlots, n));
}
