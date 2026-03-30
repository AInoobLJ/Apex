import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

/**
 * Nightly job: delete old data per retention policy.
 * - PriceSnapshots > 1 year
 * - OrderBookSnapshots > 90 days
 * - Signals > 30 days
 * - ApiUsageLogs > 90 days
 */
export async function handleDataRetention(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Data retention job started');

  const oneYear = new Date(Date.now() - 365 * 86400000);
  const ninetyDays = new Date(Date.now() - 90 * 86400000);
  const thirtyDays = new Date(Date.now() - 30 * 86400000);

  const [snapshots, orderbooks, signals, apiLogs] = await Promise.all([
    prisma.priceSnapshot.deleteMany({ where: { timestamp: { lt: oneYear } } }),
    prisma.orderBookSnapshot.deleteMany({ where: { timestamp: { lt: ninetyDays } } }),
    prisma.signal.deleteMany({ where: { expiresAt: { lt: thirtyDays } } }),
    prisma.apiUsageLog.deleteMany({ where: { createdAt: { lt: ninetyDays } } }),
  ]);

  // Mark expired markets as RESOLVED (prevents phantom edges on dashboard)
  const expiredMarkets = await prisma.market.updateMany({
    where: { status: 'ACTIVE', closesAt: { lt: new Date() } },
    data: { status: 'RESOLVED' },
  });

  logger.info({
    snapshots: snapshots.count,
    orderbooks: orderbooks.count,
    signals: signals.count,
    apiLogs: apiLogs.count,
    expiredMarkets: expiredMarkets.count,
  }, 'Data retention cleanup completed');
}
