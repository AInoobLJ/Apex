import { Market } from '@apex/db';
import { logger } from '../lib/logger';

export interface MarketMatch {
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiTitle: string;
  polymarketTitle: string;
  similarity: number;
}

/**
 * Normalize text for comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute word overlap (Jaccard similarity) between two strings.
 * Fast, no LLM calls, no cost.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeText(a).split(' '));
  const wordsB = new Set(normalizeText(b).split(' '));

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Find matching markets across Kalshi and Polymarket by title similarity.
 * Uses Jaccard similarity ONLY — no LLM calls.
 * LLM matching was removed: it caused 12,000+ Claude calls/day at $18.50
 * from the 60-second arb scan cycle. Jaccard is fast and free.
 *
 * Returns pairs with similarity above threshold (default 0.5).
 */
export async function findMatchingMarkets(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[],
  threshold: number = 0.5
): Promise<MarketMatch[]> {
  const matches: MarketMatch[] = [];

  for (const k of kalshiMarkets) {
    let bestMatch: MarketMatch | null = null;
    let bestSim = 0;

    for (const p of polymarketMarkets) {
      const sim = jaccardSimilarity(k.title, p.title);
      if (sim > bestSim && sim >= threshold) {
        bestSim = sim;
        bestMatch = {
          kalshiMarketId: k.id,
          polymarketMarketId: p.id,
          kalshiTitle: k.title,
          polymarketTitle: p.title,
          similarity: sim,
        };
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
    }
  }

  logger.info({ matchCount: matches.length }, 'Cross-platform market matching complete');
  return matches;
}

/** Export cache size for monitoring */
export function getMatchCacheSize(): number {
  return 0; // No LLM cache needed with Jaccard-only approach
}
