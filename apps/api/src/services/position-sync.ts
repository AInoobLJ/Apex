/**
 * PositionSync — reconciles local ExecutionLog/PaperPosition DB
 * with actual platform positions via API.
 *
 * Detects drift between what we think we own and what the platform says.
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
        const pnl = won ? (1 - pos.entryPrice) : -pos.entryPrice;

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
          pnl,
        }, 'Paper position auto-closed on resolution');
      } else if (market.closesAt && new Date(market.closesAt).getTime() < Date.now()) {
        // Market has expired but no resolution yet — close with current P&L estimate
        // This handles crypto brackets that expire without explicit resolution status
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
          pnl: grossPnl,
        }, 'Paper position closed — market expired without resolution');
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
  return result;
}
