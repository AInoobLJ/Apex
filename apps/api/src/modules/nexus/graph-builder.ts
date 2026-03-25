import fs from 'node:fs';
import path from 'node:path';
import { syncPrisma as prisma } from '../../lib/prisma';
import { callClaude } from '../../services/claude-client';
import { logger } from '../../lib/logger';

const NEXUS_PROMPT = fs.readFileSync(
  path.join(__dirname, '../../prompts/nexus-causal.md'), 'utf-8'
);

interface CausalRelationship {
  fromMarketId: string;
  toMarketId: string;
  relationType: 'CAUSES' | 'PREVENTS' | 'CORRELATES' | 'CONDITIONAL_ON';
  strength: number;
  description: string;
  directionality: number;
}

/**
 * Build the causal graph by identifying relationships between markets via LLM.
 */
export async function buildCausalGraph(): Promise<number> {
  // Get top markets by volume for graph construction
  const markets = await prisma.market.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { volume: 'desc' },
    take: 50,
    select: { id: true, title: true, category: true, description: true },
  });

  if (markets.length < 2) return 0;

  // Build market list for LLM
  const marketList = markets.map(m =>
    `[${m.id}] ${m.title} (${m.category})`
  ).join('\n');

  try {
    const result = await callClaude<{ relationships: CausalRelationship[] }>({
      task: 'NEXUS_CAUSAL',
      systemPrompt: NEXUS_PROMPT,
      userMessage: `## Active Markets\n${marketList}\n\nIdentify causal relationships between these markets.`,
    });

    let created = 0;
    for (const rel of result.parsed.relationships) {
      // Verify both markets exist
      const from = markets.find(m => m.id === rel.fromMarketId);
      const to = markets.find(m => m.id === rel.toMarketId);
      if (!from || !to) continue;

      await prisma.causalEdge.upsert({
        where: { fromMarketId_toMarketId: { fromMarketId: rel.fromMarketId, toMarketId: rel.toMarketId } },
        create: {
          fromMarketId: rel.fromMarketId,
          toMarketId: rel.toMarketId,
          relationType: rel.relationType,
          strength: rel.strength,
          directionality: rel.directionality,
          description: rel.description,
        },
        update: {
          relationType: rel.relationType,
          strength: rel.strength,
          directionality: rel.directionality,
          description: rel.description,
        },
      });
      created++;
    }

    logger.info({ relationships: created }, 'Causal graph built');
    return created;
  } catch (err) {
    logger.error(err, 'Causal graph building failed');
    return 0;
  }
}
