import { Market } from '@apex/db';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { callClaude } from './claude-client';
import type { LLMTask } from '@apex/shared';

export interface MarketMatch {
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiTitle: string;
  polymarketTitle: string;
  similarity: number;
}

// ── Text Similarity (free, fast) ──

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(' '));
  const wordsB = new Set(normalizeText(b).split(' '));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// ── Ingestion-Time Matching (called ONCE per new market) ──

/**
 * Match a newly ingested market against markets on the OTHER platform.
 * Called during market-sync when a market is first created.
 * Uses Jaccard pre-filter → LLM verification for high-confidence matches.
 * Results stored permanently in MarketMatch table.
 *
 * Cost: 0-1 LLM calls per new market (only if Jaccard finds candidates).
 */
export async function matchNewMarket(
  newMarket: { id: string; platform: string; title: string },
): Promise<void> {
  const otherPlatform = newMarket.platform === 'KALSHI' ? 'POLYMARKET' : 'KALSHI';

  // Already matched?
  const existing = newMarket.platform === 'KALSHI'
    ? await prisma.marketMatch.findFirst({ where: { kalshiMarketId: newMarket.id } })
    : await prisma.marketMatch.findFirst({ where: { polymarketMarketId: newMarket.id } });
  if (existing) return; // Already matched, skip

  // Get active markets from the other platform
  const otherMarkets = await prisma.market.findMany({
    where: { platform: otherPlatform, status: 'ACTIVE' },
    select: { id: true, title: true },
  });

  // Stage 1: Jaccard pre-filter — find top candidates
  const candidates: { id: string; title: string; score: number }[] = [];
  for (const other of otherMarkets) {
    const score = jaccardSimilarity(newMarket.title, other.title);
    if (score >= 0.35) { // Lower threshold for candidates
      candidates.push({ ...other, score });
    }
  }

  if (candidates.length === 0) return; // No plausible matches

  // Sort by score, take top 5
  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, 5);

  // If best Jaccard >= 0.80, just use it (no LLM needed)
  if (topCandidates[0].score >= 0.80) {
    const best = topCandidates[0];
    const [kalshiId, polyId] = newMarket.platform === 'KALSHI'
      ? [newMarket.id, best.id]
      : [best.id, newMarket.id];

    await prisma.marketMatch.create({
      data: {
        kalshiMarketId: kalshiId,
        polymarketMarketId: polyId,
        matchConfidence: best.score,
        matchMethod: 'jaccard',
      },
    }).catch(() => {}); // Ignore unique constraint violations

    logger.info({ kalshiId, polyId, score: best.score }, 'Market matched (Jaccard)');
    return;
  }

  // Stage 2: LLM verification for borderline candidates (0.35-0.80 Jaccard)
  try {
    const pairList = topCandidates.map((c, i) =>
      `${i + 1}. "${newMarket.title}" vs "${c.title}"`
    ).join('\n');

    const response = await callClaude<{ matches: { index: number; score: number }[] }>({
      systemPrompt: 'You match prediction market titles across platforms. For each pair, score 0.0-1.0 whether they refer to the SAME event. Return JSON: {"matches": [{"index": 1, "score": 0.95}]}',
      userMessage: `Score these pairs:\n${pairList}`,
      task: 'SCREEN_MARKET' as LLMTask,
      maxTokens: 256,
    });

    for (const m of response.parsed.matches || []) {
      const candidate = topCandidates[m.index - 1];
      if (!candidate || m.score < 0.75) continue;

      const [kalshiId, polyId] = newMarket.platform === 'KALSHI'
        ? [newMarket.id, candidate.id]
        : [candidate.id, newMarket.id];

      await prisma.marketMatch.create({
        data: {
          kalshiMarketId: kalshiId,
          polymarketMarketId: polyId,
          matchConfidence: m.score,
          matchMethod: 'llm',
        },
      }).catch(() => {}); // Ignore unique constraint violations

      logger.info({ kalshiId, polyId, score: m.score }, 'Market matched (LLM)');
    }
  } catch (err: any) {
    // LLM failed — fall back to best Jaccard if >= 0.60
    const best = topCandidates[0];
    if (best.score >= 0.60) {
      const [kalshiId, polyId] = newMarket.platform === 'KALSHI'
        ? [newMarket.id, best.id]
        : [best.id, newMarket.id];

      await prisma.marketMatch.create({
        data: {
          kalshiMarketId: kalshiId,
          polymarketMarketId: polyId,
          matchConfidence: best.score,
          matchMethod: 'jaccard',
        },
      }).catch(() => {});

      logger.info({ kalshiId, polyId, score: best.score, fallback: true }, 'Market matched (Jaccard fallback)');
    }
  }
}

// ── Arb-Scan Lookup (zero LLM calls, pure DB read) ──

/**
 * Get all pre-computed market matches for arb scanning.
 * Pure DB read — zero LLM calls.
 */
export async function getPrecomputedMatches(minConfidence: number = 0.60): Promise<MarketMatch[]> {
  const dbMatches = await prisma.marketMatch.findMany({
    where: { matchConfidence: { gte: minConfidence } },
    include: {
      kalshiMarket: { select: { id: true, title: true } },
      polymarketMarket: { select: { id: true, title: true } },
    },
  });

  return dbMatches.map(m => ({
    kalshiMarketId: m.kalshiMarketId,
    polymarketMarketId: m.polymarketMarketId,
    kalshiTitle: m.kalshiMarket.title,
    polymarketTitle: m.polymarketMarket.title,
    similarity: m.matchConfidence,
  }));
}

/**
 * Legacy wrapper — arb scan uses this.
 * Now just reads from MarketMatch table instead of computing live.
 */
export async function findMatchingMarkets(
  _kalshiMarkets: Market[],
  _polymarketMarkets: Market[],
  threshold: number = 0.5
): Promise<MarketMatch[]> {
  return getPrecomputedMatches(threshold);
}
