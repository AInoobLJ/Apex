import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { parseKalshiCryptoTicker } from './crypto-price';
import type { EdgeOutput } from '@apex/shared';

// Kalshi fee model: ~3.5% per side (7% round trip).
// Fee = 7% × price × (1 - price) per contract.
// Subtract estimated entry fee from entry price to make paper P&L realistic.
const KALSHI_FEE_RATE = 0.07;

// Position concentration limits
const MAX_POSITIONS_PER_ASSET_DATE = 3;

// Minimum time to expiry for new positions (in hours)
const MIN_HOURS_TO_EXPIRY = 0.5; // 30 minutes

// Minimum volume for crypto bracket contracts
const MIN_CRYPTO_VOLUME = 100; // $100

function estimateFee(price: number): number {
  return KALSHI_FEE_RATE * price * (1 - price);
}

/**
 * Build a descriptive display name for a position.
 * For crypto brackets: "BTC $67,050-$67,550 Mar 26 9PM"
 * For other markets: use the market title as-is.
 */
export function buildPositionDisplayName(
  title: string,
  platformContractId?: string | null,
): string {
  if (!platformContractId) return title;

  const parsed = parseKalshiCryptoTicker(platformContractId);
  if (!parsed) return title;

  // Extract date from the ticker: KXBTC-26MAR2621-B67450-YES → 26MAR2621
  const dateMatch = platformContractId.match(/KX\w+-(\d{2})(\w{3})(\d{2})(\d{2})-/);
  let dateSuffix = '';
  if (dateMatch) {
    const [, day, month, , hour] = dateMatch;
    const hourNum = parseInt(hour);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const displayHour = hourNum > 12 ? hourNum - 12 : hourNum === 0 ? 12 : hourNum;
    dateSuffix = ` ${month} ${day} ${displayHour}${ampm}`;
  }

  if (parsed.contractType === 'BRACKET') {
    const low = parsed.strike;
    const high = low + parsed.bracketWidth;
    return `${parsed.asset} $${low.toLocaleString()}-$${high.toLocaleString()}${dateSuffix}`;
  } else if (parsed.contractType === 'FLOOR') {
    return `${parsed.asset} above $${parsed.strike.toLocaleString()}${dateSuffix}`;
  }

  return title;
}

/**
 * PaperTrader: auto-enters paper position for every actionable edge.
 * Paper positions track what would happen if we followed every signal.
 * Entry price is adjusted for estimated fees so paper P&L reflects real trading costs.
 *
 * Guards:
 * - No duplicate positions on same market
 * - Min 30 minutes to expiry
 * - Min $100 volume for crypto brackets
 * - Max 3 positions per asset per expiry date
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
  const fee = estimateFee(rawPrice);
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
 * Resolve the best available price for a YES contract.
 * Fallback chain: lastPrice → midpoint(bestBid, bestAsk) → bestAsk → bestBid
 */
function resolveContractPrice(contract: { lastPrice: number | null; bestBid: number | null; bestAsk: number | null } | null): number | null {
  if (!contract) return null;
  if (contract.lastPrice != null) return contract.lastPrice;
  if (contract.bestBid != null && contract.bestAsk != null) return (contract.bestBid + contract.bestAsk) / 2;
  if (contract.bestAsk != null) return contract.bestAsk;
  if (contract.bestBid != null) return contract.bestBid;
  return null;
}

/**
 * Update paper positions with current market prices.
 * Call during market sync.
 *
 * P&L is direction-aware:
 * - BUY_YES: profit when YES price goes UP → P&L = (current - entry) × size
 * - BUY_NO: profit when YES price goes DOWN → P&L = (entry - current) × size
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
    const contract = pos.market.contracts[0];
    const yesPrice = resolveContractPrice(contract);
    if (yesPrice == null) continue;

    // Direction-aware gross P&L (entry fee already baked into entryPrice)
    // BUY_YES: profit when price goes up → (current - entry)
    // BUY_NO: profit when price goes DOWN → (entry - current)
    const grossPnl = pos.direction === 'BUY_YES'
      ? (yesPrice - pos.entryPrice) * pos.kellySize
      : (pos.entryPrice - yesPrice) * pos.kellySize;

    // For open positions, show P&L with estimated exit fee deducted
    const exitFee = estimateFee(yesPrice);
    const pnl = grossPnl - (exitFee * pos.kellySize);

    const updateData: Record<string, unknown> = { currentPrice: yesPrice, paperPnl: pnl };

    // Take-profit for long-duration positions (>30 days TTR at entry)
    if (pos.fairValueAtEntry && (pos.daysToResolutionAtEntry ?? 0) > 30) {
      const fairValue = pos.fairValueAtEntry;
      const denominator = fairValue - pos.entryPrice;
      if (Math.abs(denominator) > 0.001) {
        const convergence = (yesPrice - pos.entryPrice) / denominator;
        if (convergence >= 0.70) {
          const takeProfitPnl = grossPnl - (exitFee * pos.kellySize);
          updateData.isOpen = false;
          updateData.closedAt = new Date();
          updateData.closeReason = 'take_profit';
          updateData.paperPnl = takeProfitPnl;
          logger.info({ positionId: pos.id, convergence: convergence.toFixed(2), grossPnl, exitFee, netPnl: takeProfitPnl }, 'Take-profit triggered (fee-adjusted)');
        }
      }
    }

    // Auto-close positions on expired markets (past closesAt with no resolution yet)
    if (pos.market.closesAt && new Date(pos.market.closesAt).getTime() < Date.now()) {
      // Market has expired but not yet resolved — close with current P&L
      updateData.isOpen = false;
      updateData.closedAt = new Date();
      updateData.closeReason = 'expired';
      logger.info({ positionId: pos.id, pnl, marketId: pos.marketId }, 'Paper position closed — market expired');
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

/**
 * Check if a new position would violate concentration limits.
 * Max 3 positions per underlying asset per expiry date.
 */
export async function checkConcentrationLimit(
  asset: string,
  closesAt: Date | null,
): Promise<boolean> {
  if (!closesAt) return true; // Allow if no expiry

  // Extract date portion (ignore time) for grouping
  const expiryDate = new Date(closesAt);
  const startOfDay = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);

  // Count open positions for this asset on this date
  const count = await prisma.paperPosition.count({
    where: {
      isOpen: true,
      market: {
        title: { contains: asset, mode: 'insensitive' },
        closesAt: { gte: startOfDay, lt: endOfDay },
      },
    },
  });

  return count < MAX_POSITIONS_PER_ASSET_DATE;
}

export { MIN_HOURS_TO_EXPIRY, MIN_CRYPTO_VOLUME };
