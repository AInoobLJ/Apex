import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { EdgeOutput } from '@apex/shared';

// Kalshi fee model: ~3.5% per side (7% round trip).
// Fee = 7% × price × (1 - price) per contract.
// Subtract estimated entry fee from entry price to make paper P&L realistic.
const KALSHI_FEE_RATE = 0.07;

function estimateEntryFee(price: number): number {
  return KALSHI_FEE_RATE * price * (1 - price);
}

/**
 * PaperTrader: auto-enters paper position for every actionable edge.
 * Paper positions track what would happen if we followed every signal.
 * Entry price is adjusted for estimated fees so paper P&L reflects real trading costs.
 */
export async function enterPaperPosition(edge: EdgeOutput, fairValue?: number, daysToResolution?: number): Promise<string | null> {
  if (!edge.isActionable) return null;

  // Check if we already have an open paper position on this market
  const existing = await prisma.paperPosition.findFirst({
    where: { marketId: edge.marketId, isOpen: true },
  });
  if (existing) return null; // Don't duplicate

  // Adjust entry price for fees: buying costs more, selling gets less
  const rawPrice = edge.marketPrice;
  const fee = estimateEntryFee(rawPrice);
  const adjustedEntryPrice = edge.edgeDirection === 'BUY_YES'
    ? rawPrice + fee   // pay more when buying
    : rawPrice - fee;  // receive less when selling

  const position = await prisma.paperPosition.create({
    data: {
      marketId: edge.marketId,
      direction: edge.edgeDirection,
      entryPrice: adjustedEntryPrice,
      currentPrice: rawPrice,
      kellySize: edge.kellySize || edge.expectedValue * 100, // fallback sizing
      edgeAtEntry: edge.edgeMagnitude,
      confidenceAtEntry: edge.confidence,
      fairValueAtEntry: fairValue ?? null,
      daysToResolutionAtEntry: daysToResolution ?? null,
    },
  });

  logger.info({
    positionId: position.id,
    marketId: edge.marketId,
    direction: edge.edgeDirection,
    rawPrice,
    adjustedEntryPrice,
    fee,
  }, 'Paper position entered (fee-adjusted)');

  return position.id;
}

/**
 * Update paper positions with current market prices.
 * Call during market sync.
 */
export async function updatePaperPositions(): Promise<number> {
  const openPositions = await prisma.paperPosition.findMany({
    where: { isOpen: true },
    include: {
      market: {
        include: { contracts: { where: { outcome: 'YES' }, take: 1 } },
      },
    },
  });

  let updated = 0;
  for (const pos of openPositions) {
    const yesPrice = pos.market.contracts[0]?.lastPrice;
    if (yesPrice == null) continue;

    const pnl = pos.direction === 'BUY_YES'
      ? (yesPrice - pos.entryPrice) * pos.kellySize
      : (pos.entryPrice - yesPrice) * pos.kellySize;

    const updateData: Record<string, unknown> = { currentPrice: yesPrice, paperPnl: pnl };

    // Take-profit for long-duration positions (>30 days TTR at entry)
    if (pos.fairValueAtEntry && (pos.daysToResolutionAtEntry ?? 0) > 30) {
      const fairValue = pos.fairValueAtEntry;
      const denominator = fairValue - pos.entryPrice;
      if (Math.abs(denominator) > 0.001) {
        const convergence = (yesPrice - pos.entryPrice) / denominator;
        if (convergence >= 0.70) {
          updateData.isOpen = false;
          updateData.closedAt = new Date();
          updateData.closeReason = 'take_profit';
          logger.info({ positionId: pos.id, convergence: convergence.toFixed(2), pnl }, 'Take-profit triggered');
        }
      }
    }

    // Flag stale positions: open >14 days with <10% edge captured
    const daysOpen = (Date.now() - pos.createdAt.getTime()) / 86400000;
    if (daysOpen > 14 && pos.isOpen && !pos.needsReview) {
      const priceMovement = Math.abs(yesPrice - pos.entryPrice);
      if (priceMovement < pos.edgeAtEntry * 0.1) {
        updateData.needsReview = true;
        updateData.reviewReason = `Open ${Math.floor(daysOpen)}d, price moved ${(priceMovement * 100).toFixed(1)}% vs ${(pos.edgeAtEntry * 100).toFixed(1)}% edge`;
        logger.info({ positionId: pos.id, daysOpen: Math.floor(daysOpen) }, 'Stale position flagged for review');
      }
    }

    await prisma.paperPosition.update({
      where: { id: pos.id },
      data: updateData,
    });
    updated++;
  }

  return updated;
}
