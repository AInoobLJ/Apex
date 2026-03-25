import { syncPrisma as prisma } from '../lib/prisma';
import type { MarketCategory } from '@apex/db';

export interface MemoryContext {
  patterns: { pattern: string; confidence: number; occurrences: number }[];
  mistakes: { rootCause: string; lessonsLearned: string; predictedProb: number; actualOutcome: string }[];
  baseRates: { marketType: string; baseRate: number; sampleSize: number }[];
}

/**
 * Retrieve relevant memories for a market to inject into LLM prompts.
 */
export async function getRelevantContext(
  category: MarketCategory,
  title: string
): Promise<MemoryContext> {
  const [patterns, mistakes, baseRates] = await Promise.all([
    prisma.patternMemory.findMany({
      where: { category },
      orderBy: { occurrences: 'desc' },
      take: 5,
      select: { pattern: true, confidence: true, occurrences: true },
    }),
    prisma.mistakeMemory.findMany({
      where: { category },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { rootCause: true, lessonsLearned: true, predictedProb: true, actualOutcome: true },
    }),
    prisma.marketMemory.findMany({
      where: { category },
      select: { marketType: true, baseRate: true, sampleSize: true },
    }),
  ]);

  return { patterns, mistakes, baseRates };
}
