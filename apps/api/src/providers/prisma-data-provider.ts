/**
 * Concrete MarketDataProvider implementation using Prisma.
 * Wraps the same queries that COGEX/FLOWEX used to make inline.
 */
import type { MarketDataProvider, PriceSnapshotData, OrderBookSnapshotData, ResolvedMarketData } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';

export class PrismaDataProvider implements MarketDataProvider {
  async getPriceSnapshots(marketId: string, days: number): Promise<PriceSnapshotData[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshots = await prisma.priceSnapshot.findMany({
      where: { marketId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });
    return snapshots.map(s => ({
      id: s.id,
      marketId: s.marketId,
      yesPrice: s.yesPrice,
      noPrice: (s as any).noPrice ?? (1 - s.yesPrice),
      volume: (s as any).volume ?? 0,
      timestamp: s.timestamp,
    }));
  }

  async getOrderBookSnapshots(contractId: string, limit: number): Promise<OrderBookSnapshotData[]> {
    const snapshots = await prisma.orderBookSnapshot.findMany({
      where: { contractId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return snapshots.map(s => {
      const bids = (s.bids as any) ?? [];
      const asks = (s.asks as any) ?? [];
      return {
        id: s.id,
        contractId: s.contractId,
        bids,
        asks,
        totalBidDepth: (s as any).totalBidDepth ?? bids.reduce((sum: number, b: any) => sum + (b.quantity ?? 0), 0),
        totalAskDepth: (s as any).totalAskDepth ?? asks.reduce((sum: number, a: any) => sum + (a.quantity ?? 0), 0),
        timestamp: s.timestamp,
      };
    });
  }

  async getResolvedMarkets(category: string, limit: number): Promise<ResolvedMarketData[]> {
    const markets = await prisma.market.findMany({
      where: { category: category as any, status: 'RESOLVED', resolution: { not: null } },
      include: {
        priceSnapshots: { orderBy: { timestamp: 'asc' }, take: 1 },
      },
      take: limit,
    });
    return markets.map(m => ({
      id: m.id,
      category: m.category,
      resolution: m.resolution,
      priceSnapshots: m.priceSnapshots.map(ps => ({ yesPrice: ps.yesPrice, timestamp: ps.timestamp })),
    }));
  }
}
