import { syncPrisma as prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { WalletClassification } from '@apex/db';

interface WalletFeatures {
  roi: number;
  winRate: number;
  avgPositionSize: number;
  marketCount: number;
  txFrequency: number;
  totalVolume: number;
}

/**
 * Classify wallets based on their trading behavior.
 */
export async function classifyWallets(): Promise<number> {
  const wallets = await prisma.wallet.findMany({
    where: { classification: 'UNKNOWN' },
    include: { positions: true },
    take: 100,
  });

  let classified = 0;

  for (const wallet of wallets) {
    const features = computeFeatures(wallet);
    const classification = classify(features);

    if (classification !== 'UNKNOWN') {
      await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          classification,
          roi: features.roi,
          winRate: features.winRate,
          avgPositionSize: features.avgPositionSize,
          marketCount: features.marketCount,
          txFrequency: features.txFrequency,
          totalVolume: features.totalVolume,
        },
      });
      classified++;
    }
  }

  logger.info({ classified, total: wallets.length }, 'Wallet classification complete');
  return classified;
}

function computeFeatures(wallet: any): WalletFeatures {
  const positions = wallet.positions || [];
  const totalVolume = positions.reduce((s: number, p: any) => s + Math.abs(p.quantity * p.avgPrice), 0);
  const marketCount = new Set(positions.map((p: any) => p.marketId)).size;
  const profitablePositions = positions.filter((p: any) => p.pnl > 0).length;
  const totalPnl = positions.reduce((s: number, p: any) => s + p.pnl, 0);

  const daysSinceFirst = Math.max(1, (Date.now() - wallet.firstSeenAt.getTime()) / 86400000);
  const txFrequency = positions.length / daysSinceFirst;
  const avgPositionSize = positions.length > 0 ? totalVolume / positions.length : 0;

  return {
    roi: totalVolume > 0 ? totalPnl / totalVolume : 0,
    winRate: positions.length > 0 ? profitablePositions / positions.length : 0,
    avgPositionSize,
    marketCount,
    txFrequency,
    totalVolume,
  };
}

function classify(f: WalletFeatures): WalletClassification {
  // BOT: extremely high frequency
  if (f.txFrequency > 50) return 'BOT';

  // MARKET_MAKER: high frequency, moderate volume
  if (f.txFrequency > 10 && f.marketCount > 20) return 'MARKET_MAKER';

  // SMART_MONEY: profitable with significant history
  if (f.roi > 0.15 && f.marketCount >= 50 && f.winRate > 0.55) return 'SMART_MONEY';

  // WHALE: large positions
  if (f.avgPositionSize > 50000) return 'WHALE';

  // Need enough data to classify
  if (f.marketCount < 5) return 'UNKNOWN';

  return 'RETAIL';
}
