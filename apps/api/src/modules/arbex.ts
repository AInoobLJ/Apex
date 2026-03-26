import { SignalOutput } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { calculateKalshiFee, calculatePolymarketFee, calculateNetArb } from '../services/fee-calculator';
import { findMatchingMarkets, MarketMatch } from '../services/market-matcher';
import type { Platform, Market, Contract } from '@apex/db';

// ── Types ──

export interface ArbOpportunity {
  type: 'INTRA_PLATFORM' | 'CROSS_PLATFORM';
  urgency: 'URGENT' | 'NORMAL';
  marketId: string;
  marketTitle: string;
  platform: Platform;
  yesPrice: number;
  noPrice: number;
  grossSpread: number;
  totalFees: number;
  netProfit: number; // per contract
  contracts: number; // recommended size
  // Cross-platform specific
  crossPlatformMarketId?: string;
  crossPlatformTitle?: string;
  yesPlatform?: Platform;
  noPlatform?: Platform;
  similarity?: number;
}

// Minimum net profit per contract to signal (2¢ — avoids noise from sub-penny arbs)
const MIN_NET_PROFIT_PER_CONTRACT = 0.02; // $0.02
const DEFAULT_CONTRACTS = 10;
const MIN_CROSS_PLATFORM_SIMILARITY = 0.80; // Only arb markets with 80%+ title similarity

// ── ARBEX Module ──

export async function runArbScan(): Promise<ArbOpportunity[]> {
  const opportunities: ArbOpportunity[] = [];

  // Fetch all active markets with contracts
  const markets = await prisma.market.findMany({
    where: { status: 'ACTIVE' },
    include: {
      contracts: true,
    },
  });

  // 1. Intra-platform arb scan
  const intraArbs = scanIntraPlatformArbs(markets);
  opportunities.push(...intraArbs);

  // 2. Cross-platform arb scan
  const kalshiMarkets = markets.filter(m => m.platform === 'KALSHI');
  const polymarketMarkets = markets.filter(m => m.platform === 'POLYMARKET');
  const crossArbs = await scanCrossPlatformArbs(kalshiMarkets, polymarketMarkets);
  opportunities.push(...crossArbs);

  logger.info({
    intraArbs: intraArbs.length,
    crossArbs: crossArbs.length,
    totalArbs: opportunities.length,
  }, 'ARBEX scan complete');

  return opportunities;
}

// ── Intra-Platform Arb Detection ──

function scanIntraPlatformArbs(
  markets: (Market & { contracts: Contract[] })[]
): ArbOpportunity[] {
  const arbs: ArbOpportunity[] = [];

  for (const market of markets) {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    const noContract = market.contracts.find(c => c.outcome === 'NO');

    if (!yesContract?.lastPrice || !noContract?.lastPrice) continue;

    const yesPrice = yesContract.lastPrice;
    const noPrice = noContract.lastPrice;

    // Skip if prices don't make sense
    if (yesPrice <= 0 || noPrice <= 0 || yesPrice >= 1 || noPrice >= 1) continue;

    const grossSpread = 1 - yesPrice - noPrice;
    if (grossSpread <= 0) continue;

    // Calculate fees for both sides
    const { netProfit, totalFees } = calculateNetArb(
      yesPrice,
      noPrice,
      market.platform,
      market.platform,
      DEFAULT_CONTRACTS
    );

    const netProfitPerContract = netProfit / DEFAULT_CONTRACTS;

    if (netProfitPerContract >= MIN_NET_PROFIT_PER_CONTRACT) {
      arbs.push({
        type: 'INTRA_PLATFORM',
        urgency: netProfitPerContract > 0.02 ? 'URGENT' : 'NORMAL',
        marketId: market.id,
        marketTitle: market.title,
        platform: market.platform,
        yesPrice,
        noPrice,
        grossSpread,
        totalFees,
        netProfit: netProfitPerContract,
        contracts: DEFAULT_CONTRACTS,
      });
    }
  }

  return arbs;
}

// ── Cross-Platform Arb Detection ──

async function scanCrossPlatformArbs(
  kalshiMarkets: (Market & { contracts: Contract[] })[],
  polymarketMarkets: (Market & { contracts: Contract[] })[]
): Promise<ArbOpportunity[]> {
  const arbs: ArbOpportunity[] = [];

  // Find matching markets
  const matches = await findMatchingMarkets(kalshiMarkets, polymarketMarkets, MIN_CROSS_PLATFORM_SIMILARITY);

  for (const match of matches) {
    const kalshi = kalshiMarkets.find(m => m.id === match.kalshiMarketId);
    const poly = polymarketMarkets.find(m => m.id === match.polymarketMarketId);
    if (!kalshi || !poly) continue;

    const kalshiYes = kalshi.contracts.find(c => c.outcome === 'YES')?.lastPrice;
    const kalshiNo = kalshi.contracts.find(c => c.outcome === 'NO')?.lastPrice;
    const polyYes = poly.contracts.find(c => c.outcome === 'Yes' || c.outcome === 'YES')?.lastPrice;
    const polyNo = poly.contracts.find(c => c.outcome === 'No' || c.outcome === 'NO')?.lastPrice;

    // Try both directions: buy YES on one, buy NO on the other
    const combinations = [
      { yesPrice: kalshiYes, noPrice: polyNo, yesPlatform: 'KALSHI' as Platform, noPlatform: 'POLYMARKET' as Platform, yesMarketId: kalshi.id, noMarketId: poly.id },
      { yesPrice: polyYes, noPrice: kalshiNo, yesPlatform: 'POLYMARKET' as Platform, noPlatform: 'KALSHI' as Platform, yesMarketId: poly.id, noMarketId: kalshi.id },
    ];

    for (const combo of combinations) {
      if (!combo.yesPrice || !combo.noPrice) continue;
      if (combo.yesPrice <= 0 || combo.noPrice <= 0) continue;

      const { netProfit, grossSpread, totalFees } = calculateNetArb(
        combo.yesPrice,
        combo.noPrice,
        combo.yesPlatform,
        combo.noPlatform,
        DEFAULT_CONTRACTS
      );

      const netProfitPerContract = netProfit / DEFAULT_CONTRACTS;

      if (netProfitPerContract >= MIN_NET_PROFIT_PER_CONTRACT) {
        arbs.push({
          type: 'CROSS_PLATFORM',
          urgency: 'URGENT', // cross-platform arbs are always urgent
          marketId: combo.yesMarketId,
          marketTitle: match.kalshiTitle,
          platform: combo.yesPlatform,
          yesPrice: combo.yesPrice,
          noPrice: combo.noPrice,
          grossSpread,
          totalFees,
          netProfit: netProfitPerContract,
          contracts: DEFAULT_CONTRACTS,
          crossPlatformMarketId: combo.noMarketId,
          crossPlatformTitle: match.polymarketTitle,
          yesPlatform: combo.yesPlatform,
          noPlatform: combo.noPlatform,
          similarity: match.similarity,
        });
      }
    }
  }

  return arbs;
}

// ── Convert arb opportunities to SignalOutput ──

export function arbToSignals(arbs: ArbOpportunity[]): SignalOutput[] {
  return arbs.map(arb => {
    // Pure math arbs get high confidence — no model risk, just execution risk
    const confidence = arb.type === 'INTRA_PLATFORM' ? 0.95 : 0.85;
    const feeBreakdown = `Gross: ${(arb.grossSpread * 100).toFixed(1)}% → Fees: $${arb.totalFees.toFixed(3)} → Net: ${(arb.netProfit * 100).toFixed(1)}¢/contract`;

    const reasoning = arb.type === 'INTRA_PLATFORM'
      ? `Intra-platform arb on ${arb.platform}: YES=${(arb.yesPrice * 100).toFixed(1)}¢ + NO=${(arb.noPrice * 100).toFixed(1)}¢ = ${((arb.yesPrice + arb.noPrice) * 100).toFixed(1)}¢. ${feeBreakdown}`
      : `Cross-platform arb: Buy YES on ${arb.yesPlatform} @ ${(arb.yesPrice * 100).toFixed(1)}¢, Buy NO on ${arb.noPlatform} @ ${(arb.noPrice * 100).toFixed(1)}¢ (${((arb.similarity ?? 0) * 100).toFixed(0)}% match). ${feeBreakdown}`;

    return {
      moduleId: 'ARBEX' as const,
      marketId: arb.marketId,
      probability: arb.yesPrice,
      confidence,
      reasoning,
      metadata: {
        arbType: arb.type,
        urgency: arb.urgency,
        grossSpread: arb.grossSpread,
        totalFees: arb.totalFees,
        netProfit: arb.netProfit,
        netProfitCents: arb.netProfit * 100,
        contracts: arb.contracts,
        yesPlatform: arb.yesPlatform ?? arb.platform,
        noPlatform: arb.noPlatform ?? arb.platform,
        crossPlatformMarketId: arb.crossPlatformMarketId,
        similarity: arb.similarity,
        feeBreakdown,
      },
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  });
}
