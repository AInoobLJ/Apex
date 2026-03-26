import { Market } from '@apex/db';
import { logger } from '../lib/logger';
import { callClaude, cacheResult, getCachedResult } from './claude-client';
import { LLMTask } from '@apex/shared';

export interface MarketMatch {
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiTitle: string;
  polymarketTitle: string;
  similarity: number;
}

// ── Permanent match cache ──
// Key: sorted pair of normalized titles, Value: similarity score
// Persists for the lifetime of the worker process — market titles don't change
const matchCache = new Map<string, number>();

function cacheKey(a: string, b: string): string {
  const sorted = [normalizeText(a), normalizeText(b)].sort();
  return `${sorted[0]}|||${sorted[1]}`;
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
 * Used as a fast pre-filter before LLM matching.
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
 * LLM-based semantic matching via Claude Haiku.
 * Batches candidate pairs and asks Claude to score them.
 * Results are permanently cached since market titles don't change.
 */
async function llmMatchBatch(
  pairs: { kalshi: Market; poly: Market; jaccardScore: number }[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();
  if (pairs.length === 0) return results;

  // Build batch prompt
  const pairList = pairs.map((p, i) =>
    `${i + 1}. Kalshi: "${p.kalshi.title}" | Polymarket: "${p.poly.title}"`
  ).join('\n');

  const systemPrompt = `You are a prediction market analyst. For each pair of market titles from different platforms, determine if they refer to the SAME real-world event/question. Return a JSON array of objects with "index" (1-based) and "score" (0.0 to 1.0). Score 1.0 = definitely same event, 0.0 = completely different events. Consider semantic meaning, not just word overlap. Markets about the same event but phrased differently should score high (>0.8).`;

  const userMessage = `Score these market pairs:\n${pairList}\n\nReturn JSON array: [{"index": 1, "score": 0.95}, ...]`;

  try {
    const response = await callClaude<{ index: number; score: number }[]>({
      systemPrompt,
      userMessage,
      task: 'SCREEN_MARKET' as LLMTask, // Use screening tier (Haiku)
      maxTokens: 1024,
    });

    for (const item of response.parsed) {
      const pair = pairs[item.index - 1];
      if (pair) {
        const key = cacheKey(pair.kalshi.title, pair.poly.title);
        results.set(key, item.score);
        matchCache.set(key, item.score); // permanent cache
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message, pairCount: pairs.length }, 'LLM market matching failed, falling back to Jaccard');
    // Fallback: use Jaccard scores
    for (const p of pairs) {
      const key = cacheKey(p.kalshi.title, p.poly.title);
      results.set(key, p.jaccardScore);
    }
  }

  return results;
}

/**
 * Find matching markets across Kalshi and Polymarket.
 * Two-stage: fast Jaccard pre-filter → LLM semantic matching for candidates.
 * Results are permanently cached.
 */
export async function findMatchingMarkets(
  kalshiMarkets: Market[],
  polymarketMarkets: Market[],
  threshold: number = 0.5
): Promise<MarketMatch[]> {
  const matches: MarketMatch[] = [];
  const needsLLM: { kalshi: Market; poly: Market; jaccardScore: number }[] = [];

  // Stage 1: Jaccard pre-filter + check permanent cache
  for (const k of kalshiMarkets) {
    let bestMatch: MarketMatch | null = null;
    let bestSim = 0;

    for (const p of polymarketMarkets) {
      const key = cacheKey(k.title, p.title);

      // Check permanent cache first
      const cached = matchCache.get(key);
      if (cached !== undefined) {
        if (cached > bestSim && cached >= threshold) {
          bestSim = cached;
          bestMatch = {
            kalshiMarketId: k.id,
            polymarketMarketId: p.id,
            kalshiTitle: k.title,
            polymarketTitle: p.title,
            similarity: cached,
          };
        }
        continue;
      }

      // Jaccard pre-filter: only send promising pairs to LLM
      const jaccardScore = jaccardSimilarity(k.title, p.title);
      if (jaccardScore >= 0.25) { // lower threshold for LLM candidates
        needsLLM.push({ kalshi: k, poly: p, jaccardScore });
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
    }
  }

  // Stage 2: LLM matching for uncached candidates (batch in groups of 20)
  if (needsLLM.length > 0) {
    const BATCH_SIZE = 20;
    for (let i = 0; i < needsLLM.length; i += BATCH_SIZE) {
      const batch = needsLLM.slice(i, i + BATCH_SIZE);
      const llmScores = await llmMatchBatch(batch);

      // Merge LLM results into matches
      for (const pair of batch) {
        const key = cacheKey(pair.kalshi.title, pair.poly.title);
        const score = llmScores.get(key) ?? pair.jaccardScore;

        if (score >= threshold) {
          // Check if we already have a match for this Kalshi market
          const existingIdx = matches.findIndex(m => m.kalshiMarketId === pair.kalshi.id);
          if (existingIdx >= 0) {
            if (score > matches[existingIdx].similarity) {
              matches[existingIdx] = {
                kalshiMarketId: pair.kalshi.id,
                polymarketMarketId: pair.poly.id,
                kalshiTitle: pair.kalshi.title,
                polymarketTitle: pair.poly.title,
                similarity: score,
              };
            }
          } else {
            matches.push({
              kalshiMarketId: pair.kalshi.id,
              polymarketMarketId: pair.poly.id,
              kalshiTitle: pair.kalshi.title,
              polymarketTitle: pair.poly.title,
              similarity: score,
            });
          }
        }
      }
    }
  }

  logger.info({ matchCount: matches.length, llmCandidates: needsLLM.length, cacheSize: matchCache.size },
    'Cross-platform market matching complete');
  return matches;
}

/** Export cache size for monitoring */
export function getMatchCacheSize(): number {
  return matchCache.size;
}
