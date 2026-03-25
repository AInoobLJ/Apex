import { syncPrisma as prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { SignalOutput } from '@apex/shared';

const DIVERGENCE_THRESHOLD = 0.05; // 5% divergence triggers signal

/**
 * Detect divergence between smart money positions and market price.
 * When smart money wallets disagree with the market by >5%, produce a signal.
 */
export async function detectSmartMoneyDivergence(): Promise<SignalOutput[]> {
  const signals: SignalOutput[] = [];

  // Get all smart money wallets
  const smartWallets = await prisma.wallet.findMany({
    where: { classification: 'SMART_MONEY' },
    include: {
      positions: {
        where: { quantity: { gt: 0 } },
        select: { marketId: true, side: true, quantity: true, avgPrice: true },
      },
    },
  });

  if (smartWallets.length === 0) return signals;

  // Aggregate smart money positions by market
  const marketPositions: Map<string, { totalYes: number; totalNo: number; walletCount: number }> = new Map();

  for (const wallet of smartWallets) {
    for (const pos of wallet.positions) {
      if (!pos.marketId) continue;
      const existing = marketPositions.get(pos.marketId) || { totalYes: 0, totalNo: 0, walletCount: 0 };
      if (pos.side === 'YES') {
        existing.totalYes += pos.quantity * pos.avgPrice;
      } else {
        existing.totalNo += pos.quantity * pos.avgPrice;
      }
      existing.walletCount++;
      marketPositions.set(pos.marketId, existing);
    }
  }

  // Compare smart money consensus to market price
  for (const [marketId, positions] of marketPositions) {
    if (positions.walletCount < 2) continue; // Need multiple smart wallets

    const total = positions.totalYes + positions.totalNo;
    if (total === 0) continue;
    const smartMoneyYes = positions.totalYes / total;

    // Get market price
    const contract = await prisma.contract.findFirst({
      where: { marketId, outcome: 'YES' },
      select: { lastPrice: true },
    });
    if (!contract?.lastPrice) continue;

    const divergence = smartMoneyYes - contract.lastPrice;
    if (Math.abs(divergence) < DIVERGENCE_THRESHOLD) continue;

    const signal: SignalOutput = {
      moduleId: 'SIGINT',
      marketId,
      probability: smartMoneyYes,
      confidence: Math.min(0.8, positions.walletCount / 10), // More wallets = more confidence
      reasoning: `Smart money divergence: ${positions.walletCount} wallets consensus at ${(smartMoneyYes * 100).toFixed(1)}% vs market at ${(contract.lastPrice * 100).toFixed(1)}% (${divergence > 0 ? '+' : ''}${(divergence * 100).toFixed(1)}%)`,
      metadata: {
        smartMoneyYes,
        marketPrice: contract.lastPrice,
        divergence,
        walletCount: positions.walletCount,
        totalVolume: total,
      },
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    };

    signals.push(signal);
    logger.info({ marketId, divergence: divergence.toFixed(3), walletCount: positions.walletCount }, 'SIGINT divergence detected');
  }

  return signals;
}
