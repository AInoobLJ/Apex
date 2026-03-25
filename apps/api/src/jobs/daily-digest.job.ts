import { Job } from 'bullmq';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { telegramService } from '../services/telegram';
import { getUpcomingEvents } from '../services/event-calendar';

export async function handleDailyDigest(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Daily digest job started');

  try {
    const [marketCount, topEdges, signals24h, upcomingEvents] = await Promise.all([
      prisma.market.count({ where: { status: 'ACTIVE' } }),
      prisma.edge.findMany({
        where: { isActionable: true },
        orderBy: { expectedValue: 'desc' },
        take: 3,
        include: { market: { select: { title: true } } },
      }),
      prisma.signal.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
      getUpcomingEvents(3),
    ]);

    const edgeList = topEdges.map(e => ({
      title: e.market.title,
      ev: e.expectedValue,
    }));

    const eventText = upcomingEvents.length > 0
      ? upcomingEvents.map(e => `${e.title} (${e.eventDate.toLocaleDateString()})`).join(', ')
      : 'None in next 3 days';

    await telegramService.sendDailyDigest({
      activeMarkets: marketCount,
      topEdges: edgeList,
      portfolioSummary: `${signals24h} signals generated in last 24h`,
      moduleHealth: `Upcoming events: ${eventText}`,
    });

    logger.info('Daily digest sent');
  } catch (err) {
    logger.error(err, 'Daily digest failed');
  }
}
