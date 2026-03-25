import { SignalOutput, clampProbability } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { SignalModule, MarketWithData } from './base';
import { PriceSnapshot, MarketCategory } from '@apex/db';

interface CogexMetadata {
  anchoringScore: number;
  tailRiskScore: number;
  recencyScore: number;
  favLongshotScore: number;
  adjustments: {
    anchoring: number;
    tailRisk: number;
    recency: number;
    favLongshot: number;
  };
}

const ANCHORS = [0.10, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.70, 0.75, 0.80, 0.90];
const ANCHOR_BAND = 0.02;
const BIAS_WEIGHTS = { anchoring: 0.25, tailRisk: 0.30, recency: 0.20, favLongshot: 0.25 };

export class CogexModule extends SignalModule {
  readonly moduleId = 'COGEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract || yesContract.lastPrice == null) return null;

    const marketPrice = yesContract.lastPrice;
    const snapshots = await this.getPriceHistory(market.id, 90);
    if (snapshots.length < 10) return null; // need minimum data

    const anchoringAdj = this.detectAnchoring(snapshots, marketPrice);
    const tailRiskAdj = await this.detectTailRisk(market.category, marketPrice);
    const recencyAdj = this.detectRecencyBias(snapshots, marketPrice);
    const favLongshotAdj = await this.detectFavLongshot(market.category, marketPrice);

    const adjustments = {
      anchoring: anchoringAdj,
      tailRisk: tailRiskAdj,
      recency: recencyAdj,
      favLongshot: favLongshotAdj,
    };

    const combinedAdjustment =
      adjustments.anchoring * BIAS_WEIGHTS.anchoring +
      adjustments.tailRisk * BIAS_WEIGHTS.tailRisk +
      adjustments.recency * BIAS_WEIGHTS.recency +
      adjustments.favLongshot * BIAS_WEIGHTS.favLongshot;

    const biasAdjustedProbability = clampProbability(marketPrice + combinedAdjustment);
    const maxAbsAdj = Math.max(
      Math.abs(anchoringAdj),
      Math.abs(tailRiskAdj),
      Math.abs(recencyAdj),
      Math.abs(favLongshotAdj)
    );

    const dataQuality = Math.min(1, snapshots.length / 200);
    const biasStrength = Math.min(1, maxAbsAdj / 0.10);
    const confidence = Math.min(0.8, dataQuality * Math.max(0.1, biasStrength));

    const metadata: CogexMetadata = {
      anchoringScore: Math.abs(anchoringAdj) / 0.10,
      tailRiskScore: Math.abs(tailRiskAdj) / 0.10,
      recencyScore: Math.abs(recencyAdj) / 0.10,
      favLongshotScore: Math.abs(favLongshotAdj) / 0.10,
      adjustments,
    };

    const reasoning = this.buildReasoning(adjustments, combinedAdjustment);

    return this.makeSignal(
      market.id,
      biasAdjustedProbability,
      confidence,
      reasoning,
      metadata as unknown as Record<string, unknown>,
      60 // expires in 60 min (half-life 30 min)
    );
  }

  // ── Anchoring Bias ──
  private detectAnchoring(snapshots: PriceSnapshot[], currentPrice: number): number {
    if (snapshots.length < 20) return 0;

    // Use last 7 days of snapshots
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = snapshots.filter(s => s.timestamp.getTime() > weekAgo);
    if (recent.length < 10) return 0;

    // Find nearest anchor
    let nearestAnchor = ANCHORS[0];
    let minDist = Math.abs(currentPrice - ANCHORS[0]);
    for (const a of ANCHORS) {
      const dist = Math.abs(currentPrice - a);
      if (dist < minDist) {
        minDist = dist;
        nearestAnchor = a;
      }
    }

    // Compute stickiness: fraction of time within anchor band
    const nearAnchor = recent.filter(s => Math.abs(s.yesPrice - nearestAnchor) <= ANCHOR_BAND);
    const stickinessRatio = nearAnchor.length / recent.length;
    const expectedRatio = (ANCHOR_BAND * 2); // ~0.04 expected
    const relativeStickiness = stickinessRatio / Math.max(expectedRatio, 0.01);

    if (relativeStickiness <= 2.0) return 0;

    // Push away from anchor
    const direction = currentPrice > nearestAnchor ? 1 : -1;
    const magnitude = Math.min(0.10, 0.02 * (relativeStickiness - 1));
    return direction * magnitude;
  }

  // ── Tail Risk Underpricing ──
  private async detectTailRisk(category: MarketCategory, marketPrice: number): Promise<number> {
    if (marketPrice > 0.10 && marketPrice < 0.90) return 0; // only applies to tails

    const resolvedMarkets = await prisma.market.findMany({
      where: { category, status: 'RESOLVED', resolution: { not: null } },
      include: {
        priceSnapshots: { orderBy: { timestamp: 'asc' }, take: 1 },
      },
      take: 500,
    });

    if (resolvedMarkets.length < 30) return 0;

    if (marketPrice <= 0.10) {
      // Count how often low-priced markets resolved YES
      const lowPriced = resolvedMarkets.filter(m =>
        m.priceSnapshots.length > 0 && m.priceSnapshots[0].yesPrice <= 0.10
      );
      if (lowPriced.length < 10) return 0;

      const resolvedYes = lowPriced.filter(m => m.resolution === 'YES').length;
      const empiricalRate = resolvedYes / lowPriced.length;

      if (empiricalRate > marketPrice) {
        return Math.min(0.10, empiricalRate - marketPrice);
      }
    }

    if (marketPrice >= 0.90) {
      const highPriced = resolvedMarkets.filter(m =>
        m.priceSnapshots.length > 0 && m.priceSnapshots[0].yesPrice >= 0.90
      );
      if (highPriced.length < 10) return 0;

      const resolvedNo = highPriced.filter(m => m.resolution === 'NO').length;
      const empiricalNoRate = resolvedNo / highPriced.length;
      const impliedNoRate = 1 - marketPrice;

      if (empiricalNoRate > impliedNoRate) {
        return -Math.min(0.10, empiricalNoRate - impliedNoRate);
      }
    }

    return 0;
  }

  // ── Recency Bias ──
  private detectRecencyBias(snapshots: PriceSnapshot[], currentPrice: number): number {
    const now = Date.now();
    const recent7d = snapshots.filter(s => s.timestamp.getTime() > now - 7 * 24 * 3600 * 1000);
    const older90d = snapshots.filter(s => s.timestamp.getTime() > now - 90 * 24 * 3600 * 1000);

    if (recent7d.length < 5 || older90d.length < 20) return 0;

    const vol7d = this.computeVolatility(recent7d);
    const vol90d = this.computeVolatility(older90d);

    if (vol90d === 0) return 0;
    if (vol7d / vol90d <= 2.0) return 0;

    // Price moved significantly in 7 days — dampen by 30%
    const priceStart7d = recent7d[0].yesPrice;
    const move7d = currentPrice - priceStart7d;

    if (Math.abs(move7d) < 0.05) return 0;

    // Dampen: push back toward where price was
    return -move7d * 0.30;
  }

  // ── Favorite-Longshot Bias ──
  private async detectFavLongshot(category: MarketCategory, marketPrice: number): Promise<number> {
    const resolvedMarkets = await prisma.market.findMany({
      where: { category, status: 'RESOLVED', resolution: { not: null } },
      include: { priceSnapshots: { orderBy: { timestamp: 'asc' }, take: 1 } },
      take: 500,
    });

    if (resolvedMarkets.length < 50) return 0;

    // Build calibration bins
    const bins = new Map<string, { predicted: number[]; actual: number[] }>();
    for (const m of resolvedMarkets) {
      if (m.priceSnapshots.length === 0) continue;
      const price = m.priceSnapshots[0].yesPrice;
      const binKey = Math.floor(price * 10) / 10; // 0.0, 0.1, ..., 0.9
      const bin = bins.get(binKey.toFixed(1)) ?? { predicted: [], actual: [] };
      bin.predicted.push(price);
      bin.actual.push(m.resolution === 'YES' ? 1 : 0);
      bins.set(binKey.toFixed(1), bin);
    }

    // Find the bin for current market price
    const currentBinKey = (Math.floor(marketPrice * 10) / 10).toFixed(1);
    const currentBin = bins.get(currentBinKey);

    if (!currentBin || currentBin.predicted.length < 10) return 0;

    const avgPredicted = currentBin.predicted.reduce((s, v) => s + v, 0) / currentBin.predicted.length;
    const actualRate = currentBin.actual.reduce((s, v) => s + v, 0) / currentBin.actual.length;

    const miscalibration = actualRate - avgPredicted;

    // Cap adjustment
    return Math.max(-0.10, Math.min(0.10, miscalibration));
  }

  // ── Helpers ──
  private async getPriceHistory(marketId: string, days: number): Promise<PriceSnapshot[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return prisma.priceSnapshot.findMany({
      where: { marketId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });
  }

  private computeVolatility(snapshots: PriceSnapshot[]): number {
    if (snapshots.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      returns.push(snapshots[i].yesPrice - snapshots[i - 1].yesPrice);
    }
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private buildReasoning(adjustments: CogexMetadata['adjustments'], combined: number): string {
    const parts: string[] = [];
    if (Math.abs(adjustments.anchoring) > 0.01) parts.push(`anchoring (${adjustments.anchoring > 0 ? '+' : ''}${(adjustments.anchoring * 100).toFixed(1)}%)`);
    if (Math.abs(adjustments.tailRisk) > 0.01) parts.push(`tail risk (${adjustments.tailRisk > 0 ? '+' : ''}${(adjustments.tailRisk * 100).toFixed(1)}%)`);
    if (Math.abs(adjustments.recency) > 0.01) parts.push(`recency (${adjustments.recency > 0 ? '+' : ''}${(adjustments.recency * 100).toFixed(1)}%)`);
    if (Math.abs(adjustments.favLongshot) > 0.01) parts.push(`fav-longshot (${adjustments.favLongshot > 0 ? '+' : ''}${(adjustments.favLongshot * 100).toFixed(1)}%)`);

    if (parts.length === 0) return 'No significant cognitive biases detected.';
    return `Detected biases: ${parts.join(', ')}. Combined adjustment: ${combined > 0 ? '+' : ''}${(combined * 100).toFixed(1)}%.`;
  }
}

export const cogexModule = new CogexModule();
