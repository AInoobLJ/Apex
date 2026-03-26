import { SignalOutput, clampProbability } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { SignalModule, MarketWithData } from './base';
import { OrderBookSnapshot } from '@apex/db';

interface FlowexMetadata {
  orderFlowImbalance: number;
  moveClassification: 'LIQUIDITY' | 'INFORMATION' | 'UNKNOWN';
  vwap24h: number;
  priceVsVwap: number;
  meanReversionSignal: boolean;
  thinBookFlag: boolean;
  bidDepthTotal: number;
  askDepthTotal: number;
}

interface BookLevel {
  price: number;
  quantity: number;
}

export class FlowexModule extends SignalModule {
  readonly moduleId = 'FLOWEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract || yesContract.lastPrice == null) return null;

    const marketPrice = yesContract.lastPrice;

    // Get last 2 order book snapshots for this contract
    const snapshots = await prisma.orderBookSnapshot.findMany({
      where: { contractId: yesContract.id },
      orderBy: { timestamp: 'desc' },
      take: 2,
    });

    if (snapshots.length < 1) return null;

    const current = snapshots[0];
    const previous = snapshots.length > 1 ? snapshots[1] : null;

    const currentBids = current.bids as unknown as BookLevel[];
    const currentAsks = current.asks as unknown as BookLevel[];

    // Compute metrics
    const ofi = previous ? this.computeOFI(current, previous) : 0;
    const vwap24h = await this.computeVWAP(market.id, 24);
    const priceVsVwap = marketPrice - vwap24h;
    const moveClass = previous ? this.classifyMove(current, previous, marketPrice) : 'UNKNOWN';
    const thinBook = current.totalBidDepth + current.totalAskDepth < 5000;

    const meanReversion = moveClass === 'LIQUIDITY' && Math.abs(priceVsVwap) > 0.03;

    const metadata: FlowexMetadata = {
      orderFlowImbalance: ofi,
      moveClassification: moveClass,
      vwap24h,
      priceVsVwap,
      meanReversionSignal: meanReversion,
      thinBookFlag: thinBook,
      bidDepthTotal: current.totalBidDepth,
      askDepthTotal: current.totalAskDepth,
    };

    let probability: number;
    let confidence: number;
    let reasoning: string;

    if (meanReversion) {
      // Mean reversion: probability = VWAP
      probability = clampProbability(vwap24h);
      confidence = Math.min(0.6, (current.totalBidDepth + current.totalAskDepth) / 50000);
      reasoning = `Liquidity-driven move detected. Price ${(priceVsVwap * 100).toFixed(1)}% from 24h VWAP (${(vwap24h * 100).toFixed(1)}%). Mean reversion signal toward VWAP.`;
    } else if (thinBook && (current.totalBidDepth + current.totalAskDepth) > 0) {
      // Thin book with SOME data: flag as warning signal
      probability = marketPrice;
      confidence = 0.1;
      reasoning = `Thin order book ($${(current.totalBidDepth + current.totalAskDepth).toFixed(0)} total depth). Price unreliable — potential for manipulation.`;
    } else if (Math.abs(ofi) > 0.3) {
      // Strong order flow imbalance without a price move yet — leading signal
      probability = clampProbability(marketPrice + ofi * 0.05);
      confidence = Math.min(0.4, Math.abs(ofi) * 0.5);
      reasoning = `Strong order flow imbalance (OFI: ${ofi.toFixed(2)}). ${ofi > 0 ? 'Bid' : 'Ask'} pressure building — price may move ${ofi > 0 ? 'up' : 'down'}.`;
    } else {
      // No meaningful signal — return null instead of spamming
      return null;
    }

    return this.makeSignal(
      market.id,
      probability,
      confidence,
      reasoning,
      metadata as unknown as Record<string, unknown>,
      60 // expires in 60 min (half-life 30 min)
    );
  }

  // ── Order Flow Imbalance ──
  private computeOFI(current: OrderBookSnapshot, previous: OrderBookSnapshot): number {
    const currBids = current.bids as unknown as BookLevel[];
    const prevBids = previous.bids as unknown as BookLevel[];
    const currAsks = current.asks as unknown as BookLevel[];
    const prevAsks = previous.asks as unknown as BookLevel[];

    const currBidDepth = currBids.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
    const prevBidDepth = prevBids.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
    const currAskDepth = currAsks.slice(0, 5).reduce((s, l) => s + l.quantity, 0);
    const prevAskDepth = prevAsks.slice(0, 5).reduce((s, l) => s + l.quantity, 0);

    const bidChange = currBidDepth - prevBidDepth;
    const askChange = currAskDepth - prevAskDepth;
    const totalDepth = currBidDepth + currAskDepth;

    if (totalDepth === 0) return 0;

    // OFI = (bid_increase - ask_increase) / total_depth → [-1, +1]
    return Math.max(-1, Math.min(1, (bidChange - askChange) / totalDepth));
  }

  // ── Move Classification ──
  private classifyMove(
    current: OrderBookSnapshot,
    previous: OrderBookSnapshot,
    currentPrice: number
  ): 'LIQUIDITY' | 'INFORMATION' | 'UNKNOWN' {
    const priceMove = Math.abs(current.midPrice - previous.midPrice);
    const prevTotalDepth = previous.totalBidDepth + previous.totalAskDepth;
    const currTotalDepth = current.totalBidDepth + current.totalAskDepth;

    if (priceMove < 0.02) return 'UNKNOWN'; // no significant move

    const depthChange = (currTotalDepth - prevTotalDepth) / Math.max(prevTotalDepth, 1);

    // Book thinned > 20% → information-driven
    if (depthChange < -0.20) return 'INFORMATION';

    // Book stable or grew → liquidity-driven (likely temporary)
    if (depthChange >= 0) return 'LIQUIDITY';

    return 'UNKNOWN';
  }

  // ── VWAP Calculation ──
  private async computeVWAP(marketId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const snapshots = await prisma.priceSnapshot.findMany({
      where: { marketId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });

    if (snapshots.length === 0) return 0.5; // default

    let totalPriceVolume = 0;
    let totalVolume = 0;

    for (let i = 1; i < snapshots.length; i++) {
      const volumeDelta = Math.max(0, snapshots[i].volume - snapshots[i - 1].volume);
      if (volumeDelta > 0) {
        totalPriceVolume += snapshots[i].yesPrice * volumeDelta;
        totalVolume += volumeDelta;
      }
    }

    if (totalVolume === 0) {
      // No volume change — use simple average
      return snapshots.reduce((s, p) => s + p.yesPrice, 0) / snapshots.length;
    }

    return totalPriceVolume / totalVolume;
  }
}

export const flowexModule = new FlowexModule();
