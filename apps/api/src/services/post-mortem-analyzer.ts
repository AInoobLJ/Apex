import { syncPrisma as prisma } from '../lib/prisma';
import { callClaude } from './claude-client';
import { logger } from '../lib/logger';
import type { MarketCategory } from '@apex/db';

interface PostMortemResult {
  rootCause: string;
  lessonsLearned: string;
  pattern: string;
}

/**
 * On market resolution, analyze CORTEX performance.
 * If confident and wrong → MistakeMemory
 * If confident and right → PatternMemory
 */
export async function analyzeResolution(
  marketId: string,
  marketTitle: string,
  category: MarketCategory,
  actualOutcome: 'YES' | 'NO',
  cortexProbability: number,
  confidence: number,
  moduleId: string
): Promise<void> {
  if (confidence < 0.6) return; // Only analyze high-confidence predictions

  const predictedYes = cortexProbability > 0.5;
  const wasCorrect = (predictedYes && actualOutcome === 'YES') || (!predictedYes && actualOutcome === 'NO');

  if (wasCorrect) {
    // Record pattern
    const existingPattern = await prisma.patternMemory.findFirst({
      where: { category, pattern: { contains: category } },
    });

    if (existingPattern) {
      await prisma.patternMemory.update({
        where: { id: existingPattern.id },
        data: {
          occurrences: { increment: 1 },
          lastSeen: new Date(),
          avgEdgeWhenApplied: (existingPattern.avgEdgeWhenApplied * existingPattern.occurrences + Math.abs(cortexProbability - 0.5)) / (existingPattern.occurrences + 1),
        },
      });
    } else {
      await prisma.patternMemory.create({
        data: {
          category,
          pattern: `Correct ${category} prediction: ${marketTitle.slice(0, 100)}`,
          confidence,
        },
      });
    }

    logger.info({ marketId, category, confidence }, 'Pattern memory recorded (correct prediction)');
  } else {
    // Generate root cause via Claude
    try {
      const result = await callClaude<PostMortemResult>({
        task: 'POST_MORTEM',
        systemPrompt: 'You analyze prediction market forecasting errors. Respond with JSON: {"rootCause": "string", "lessonsLearned": "string", "pattern": "string — recurring mistake type"}',
        userMessage: `Market: ${marketTitle}\nCategory: ${category}\nCORTEX predicted: ${(cortexProbability * 100).toFixed(1)}% YES\nActual outcome: ${actualOutcome}\nConfidence: ${(confidence * 100).toFixed(0)}%\n\nWhy was this prediction wrong? What can we learn?`,
      });

      await prisma.mistakeMemory.create({
        data: {
          marketId,
          moduleId,
          predictedProb: cortexProbability,
          actualOutcome,
          confidence,
          rootCause: result.parsed.rootCause,
          lessonsLearned: result.parsed.lessonsLearned,
          category,
        },
      });

      logger.info({ marketId, category }, 'Mistake memory recorded');
    } catch (err) {
      logger.error(err, 'Post-mortem analysis failed');
    }
  }
}
