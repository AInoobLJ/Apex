import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

interface EventSchedule {
  title: string;
  date: Date;
  category: 'FINANCE' | 'POLITICS' | 'SCIENCE' | 'OTHER';
  source: string;
}

// Static FOMC meeting dates for 2025-2026
const FOMC_DATES: EventSchedule[] = [
  { title: 'FOMC Meeting', date: new Date('2025-05-06'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2025-06-17'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2025-07-29'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2025-09-16'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2025-10-28'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2025-12-16'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-01-27'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-03-17'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-05-05'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-06-16'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-07-28'), category: 'FINANCE', source: 'Federal Reserve' },
  { title: 'FOMC Meeting', date: new Date('2026-09-15'), category: 'FINANCE', source: 'Federal Reserve' },
];

// BLS economic data releases (monthly, approximate)
const BLS_RELEASES: EventSchedule[] = Array.from({ length: 12 }, (_, i) => {
  const date = new Date(2026, i, i < 6 ? 10 : 12); // ~10th of each month
  return [
    { title: `CPI Release (${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`, date, category: 'FINANCE' as const, source: 'BLS' },
    { title: `Jobs Report (${date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})`, date: new Date(date.getTime() - 7 * 86400000), category: 'FINANCE' as const, source: 'BLS' },
  ];
}).flat();

/**
 * Populate the event calendar with static schedules.
 */
export async function populateEventCalendar(): Promise<number> {
  const allEvents = [...FOMC_DATES, ...BLS_RELEASES];
  let created = 0;

  for (const event of allEvents) {
    // Skip past events
    if (event.date < new Date()) continue;

    const existing = await prisma.scheduledEvent.findFirst({
      where: { title: event.title, eventDate: event.date },
    });

    if (!existing) {
      await prisma.scheduledEvent.create({
        data: {
          title: event.title,
          eventDate: event.date,
          category: event.category,
          source: event.source,
          relatedMarketIds: [],
        },
      });
      created++;
    }
  }

  logger.info({ created, total: allEvents.length }, 'Event calendar populated');
  return created;
}

/**
 * Get upcoming events within N days.
 */
export async function getUpcomingEvents(days = 7) {
  const until = new Date(Date.now() + days * 86400000);
  return prisma.scheduledEvent.findMany({
    where: { eventDate: { gte: new Date(), lte: until } },
    orderBy: { eventDate: 'asc' },
  });
}
