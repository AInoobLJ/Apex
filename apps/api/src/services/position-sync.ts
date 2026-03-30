/**
 * PositionSync — reconciles local ExecutionLog/PaperPosition DB
 * with actual platform positions via API.
 *
 * Detects drift between what we think we own and what the platform says.
 * Also links resolved markets to their training snapshots for FeatureModel training.
 */
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { kalshiClient } from './kalshi-client';

export interface PositionDrift {
  marketId: string;
  platform: string;
  localDirection: string;
  localSize: number;
  platformSize: number;
  drift: number;          // platformSize - localSize
  driftType: 'MISSING_LOCAL' | 'MISSING_PLATFORM' | 'SIZE_MISMATCH' | 'SYNCED';
}

export interface SyncResult {
  synced: number;
  drifts: PositionDrift[];
  errors: string[];
  timestamp: Date;
}

/**
 * Reconcile local positions with platform positions.
 * Currently supports paper positions only (no live execution yet).
 */
export async function reconcilePositions(): Promise<SyncResult> {
  const errors: string[] = [];
  const drifts: PositionDrift[] = [];
  let synced = 0;

  // Get all open paper positions
  const openPositions = await prisma.paperPosition.findMany({
    where: { isOpen: true },
    include: { market: { select: { title: true, platform: true, platformMarketId: true } } },
  });

  logger.info({ openPositions: openPositions.length }, 'Position sync starting');

  // For each open position, verify market is still active
  for (const pos of openPositions) {
    try {
      // Check if market has resolved
      const market = await prisma.market.findUnique({
        where: { id: pos.marketId },
        select: { status: true, resolution: true, closesAt: true },
      });

      if (!market) {
        drifts.push({
          marketId: pos.marketId,
          platform: pos.market.platform,
          localDirection: pos.direction,
          localSize: 1,
          platformSize: 0,
          drift: -1,
          driftType: 'MISSING_PLATFORM',
        });
        continue;
      }

      // Auto-close positions on resolved markets
      if (market.resolution) {
        const resolvedYes = market.resolution === 'YES';
        const won = (pos.direction === 'BUY_YES' && resolvedYes) || (pos.direction === 'BUY_NO' && !resolvedYes);
        const contracts = pos.kellySize || 0;

        // P&L = (settlement - cost) × contracts
        // BUY_YES: paid entryPrice per contract, receive 1.0 if YES wins, 0 if NO wins
        // BUY_NO: paid (1 - entryPrice) per contract, receive 1.0 if NO wins, 0 if YES wins
        let pnl: number;
        if (pos.direction === 'BUY_YES') {
          const settlement = resolvedYes ? 1.0 : 0.0;
          pnl = (settlement - pos.entryPrice) * contracts;
        } else {
          // BUY_NO: cost = 1 - entryPrice, payout = 1.0 if NO wins
          const cost = 1 - pos.entryPrice;
          const payout = resolvedYes ? 0.0 : 1.0;
          pnl = (payout - cost) * contracts;
        }

        await prisma.paperPosition.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closeReason: 'RESOLVED',
            currentPrice: resolvedYes ? 1.0 : 0.0,
            paperPnl: pnl,
          },
        });

        synced++;
        logger.info({
          marketId: pos.marketId,
          direction: pos.direction,
          resolution: market.resolution,
          won,
          contracts,
          pnl: pnl.toFixed(2),
        }, `[RESOLUTION] ${pos.direction} | outcome=${market.resolution} | contracts=${contracts} | P&L=$${pnl.toFixed(2)}`);
      } else if (market.closesAt && new Date(market.closesAt).getTime() < Date.now()) {
        // Market expired but no resolution data yet.
        // Wait up to 30 minutes for resolution sync to bring in the outcome.
        // This prevents the stale-price P&L bug where positions close at the last
        // market YES price instead of the actual settlement outcome.
        const expiredAgo = Date.now() - new Date(market.closesAt).getTime();
        const GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

        if (expiredAgo < GRACE_PERIOD_MS) {
          // Still within grace period — skip, let resolution sync handle it
          continue;
        }

        // Past grace period, no resolution arrived — close with mark-to-market P&L as last resort
        const contract = await prisma.contract.findFirst({
          where: { marketId: pos.marketId, outcome: 'YES' },
          select: { lastPrice: true, bestAsk: true, bestBid: true },
        });
        const finalPrice = contract?.lastPrice ?? contract?.bestAsk ?? contract?.bestBid ?? pos.currentPrice ?? 0;
        const grossPnl = pos.direction === 'BUY_YES'
          ? (finalPrice - pos.entryPrice) * pos.kellySize
          : (pos.entryPrice - finalPrice) * pos.kellySize;

        await prisma.paperPosition.update({
          where: { id: pos.id },
          data: {
            isOpen: false,
            closedAt: new Date(),
            closeReason: 'expired',
            currentPrice: finalPrice,
            paperPnl: grossPnl,
          },
        });

        synced++;
        logger.info({
          marketId: pos.marketId,
          direction: pos.direction,
          finalPrice,
          pnl: grossPnl.toFixed(2),
          expiredMinutesAgo: Math.round(expiredAgo / 60000),
        }, 'Paper position closed — expired without resolution (past 30min grace)');
      } else if (market.status === 'ACTIVE') {
        // Market still active — update current price from latest contract data
        const contract = await prisma.contract.findFirst({
          where: { marketId: pos.marketId, outcome: 'YES' },
          select: { lastPrice: true },
        });

        if (contract?.lastPrice) {
          const currentPrice = pos.direction === 'BUY_YES' ? contract.lastPrice : (1 - contract.lastPrice);
          await prisma.paperPosition.update({
            where: { id: pos.id },
            data: { currentPrice: contract.lastPrice },
          });
          synced++;
        }
      }
    } catch (err) {
      errors.push(`Position ${pos.id}: ${(err as Error).message}`);
    }
  }

  // Check for stale positions (open > 14 days without price movement toward fair value)
  const stalePositions = await prisma.paperPosition.findMany({
    where: {
      isOpen: true,
      createdAt: { lte: new Date(Date.now() - 14 * 86400000) },
      needsReview: false,
    },
    include: { market: { select: { title: true } } },
  });

  for (const pos of stalePositions) {
    const priceMovedTowardFairValue = pos.direction === 'BUY_YES'
      ? (pos.currentPrice ?? 0) > pos.entryPrice
      : (pos.currentPrice ?? 1) < pos.entryPrice;

    if (!priceMovedTowardFairValue) {
      await prisma.paperPosition.update({
        where: { id: pos.id },
        data: { needsReview: true, reviewReason: 'Stale position: open >14 days, no convergence toward fair value' },
      });
      logger.warn({ marketId: pos.marketId, title: pos.market.title }, 'Paper position flagged for review — stale');
    }
  }

  // ── Check for signal-invalidated positions ──
  // Positions whose market no longer has a recent actionable edge may have been
  // created from data that's since been invalidated (e.g., SPORTS-EDGE returning
  // game-line data for futures markets, now fixed to return null).
  const unreviewedOpen = await prisma.paperPosition.findMany({
    where: {
      isOpen: true,
      needsReview: false,
      createdAt: { lte: new Date(Date.now() - 24 * 3600000) }, // open > 24h
    },
    include: { market: { select: { title: true, category: true } } },
  });

  for (const pos of unreviewedOpen) {
    try {
      // Check if any actionable edge still exists for this market (last 48h)
      const recentEdge = await prisma.edge.findFirst({
        where: {
          marketId: pos.marketId,
          createdAt: { gte: new Date(Date.now() - 48 * 3600000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { isActionable: true, edgeDirection: true, createdAt: true },
      });

      if (!recentEdge) {
        // No edge produced in 48h — signal source may have been invalidated
        await prisma.paperPosition.update({
          where: { id: pos.id },
          data: {
            needsReview: true,
            reviewReason: 'Signal lost: no edge produced for this market in 48h. Original signal source may have been invalidated.',
          },
        });
        logger.warn({
          positionId: pos.id,
          marketId: pos.marketId,
          title: pos.market.title,
          category: pos.market.category,
        }, 'Position flagged SIGNAL_INVALIDATED — no recent edge');
      } else if (!recentEdge.isActionable) {
        // Edge exists but is no longer actionable (e.g., modules now disagree or edge shrunk below threshold)
        await prisma.paperPosition.update({
          where: { id: pos.id },
          data: {
            needsReview: true,
            reviewReason: `Edge no longer actionable (last edge: ${recentEdge.createdAt.toISOString().slice(0, 16)}, direction: ${recentEdge.edgeDirection}). Signal quality may have degraded.`,
          },
        });
        logger.warn({
          positionId: pos.id,
          marketId: pos.marketId,
          title: pos.market.title,
        }, 'Position flagged — edge no longer actionable');
      }
    } catch (err) {
      errors.push(`Signal check ${pos.id}: ${(err as Error).message}`);
    }
  }

  const result: SyncResult = {
    synced,
    drifts,
    errors,
    timestamp: new Date(),
  };

  // Persist last sync result
  await prisma.systemConfig.upsert({
    where: { key: 'last_position_sync' },
    update: { value: JSON.stringify(result) },
    create: { key: 'last_position_sync', value: JSON.stringify(result) },
  });

  logger.info({ synced, drifts: drifts.length, errors: errors.length }, 'Position sync complete');

  // ── Link resolved markets to training snapshots ──
  await linkResolutionOutcomes();

  return result;
}

/**
 * Link resolution outcomes to training snapshots.
 * Finds all TrainingSnapshots with null outcome whose market has resolved,
 * and fills in the outcome (1=YES, 0=NO).
 *
 * This builds the labeled dataset the FeatureModel needs to train.
 * Runs as part of position reconciliation (every 5 min).
 */
async function linkResolutionOutcomes(): Promise<void> {
  try {
    // Find snapshots missing outcomes where market has resolved
    const unlinked = await prisma.trainingSnapshot.findMany({
      where: { outcome: null },
      select: { id: true, marketId: true },
      take: 500, // batch to avoid memory issues
    });

    if (unlinked.length === 0) return;

    // Get unique market IDs and check resolution status
    const marketIds = [...new Set(unlinked.map(s => s.marketId))];
    const resolvedMarkets = await prisma.market.findMany({
      where: {
        id: { in: marketIds },
        resolution: { not: null },
      },
      select: { id: true, resolution: true, resolutionDate: true },
    });

    if (resolvedMarkets.length === 0) return;

    const resolutionMap = new Map(resolvedMarkets.map(m => [m.id, m]));

    let linked = 0;
    for (const snapshot of unlinked) {
      const market = resolutionMap.get(snapshot.marketId);
      if (!market) continue;

      const outcome = market.resolution === 'YES' ? 1 : 0;
      await prisma.trainingSnapshot.update({
        where: { id: snapshot.id },
        data: {
          outcome,
          resolvedAt: market.resolutionDate ?? new Date(),
        },
      });
      linked++;
    }

    if (linked > 0) {
      logger.info({ linked, unlinkedTotal: unlinked.length },
        'Training snapshots linked to resolution outcomes');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to link resolution outcomes to training snapshots');
  }
}
