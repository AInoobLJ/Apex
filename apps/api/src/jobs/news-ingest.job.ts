import { Job } from 'bullmq';
import { logger } from '../lib/logger';
import { fetchNews, fetchHeadlines } from '../services/news-client';
import { syncPrisma as prisma } from '../lib/prisma';
import { altexModule } from '../modules/altex';

export async function handleNewsIngest(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'News ingest job started');

  try {
    // Fetch news from multiple categories
    const [general, business, science, tech] = await Promise.all([
      fetchNews(),
      fetchHeadlines('business', 10),
      fetchHeadlines('science', 5),
      fetchHeadlines('technology', 5),
    ]);

    const allArticles = [...general, ...business, ...science, ...tech];
    logger.info({ articleCount: allArticles.length }, 'Fetched news articles');

    if (allArticles.length === 0) return;

    // Get top active markets for ALTEX analysis
    const markets = await prisma.market.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { volume: 'desc' },
      take: 30,
      include: { contracts: { where: { outcome: 'YES' }, take: 1 } },
    });

    const marketData = markets
      .filter(m => m.contracts[0]?.lastPrice)
      .map(m => ({
        id: m.id,
        title: m.title,
        category: m.category,
        yesPrice: m.contracts[0].lastPrice!,
      }));

    // Run ALTEX analysis
    const signals = await altexModule.analyzeNewsImpact(allArticles, marketData);

    // Persist signals
    for (const signal of signals) {
      await prisma.signal.create({
        data: {
          moduleId: signal.moduleId,
          marketId: signal.marketId,
          probability: signal.probability,
          confidence: signal.confidence,
          reasoning: signal.reasoning,
          metadata: signal.metadata as object,
          expiresAt: signal.expiresAt,
        },
      });
    }

    logger.info({ signals: signals.length, articles: allArticles.length }, 'News ingest completed');
  } catch (err) {
    logger.error(err, 'News ingest job failed');
    throw err;
  }
}
