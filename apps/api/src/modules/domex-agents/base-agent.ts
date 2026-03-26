import fs from 'node:fs';
import path from 'node:path';
import { callClaude } from '../../services/claude-client';
import { logger } from '../../lib/logger';
import type { MarketCategory } from '@apex/db';
import type { LLMTask } from '@apex/shared';

// ── Feature Extraction Result (v2) ──
// Agents extract structured features, NOT probabilities.
// The FeatureModel (logistic regression) converts features → calibrated probability.
export interface DomexAgentResult {
  features: Record<string, string | number | boolean | null>;
  reasoning: string;
  dataSourcesUsed: string[];
  dataFreshness: 'live' | 'cached' | 'stale' | 'none';
}

export interface DomexAgent {
  name: string;
  categories: MarketCategory[];
  run(title: string, description: string | null, category: MarketCategory, closesAt?: Date | null): Promise<DomexAgentResult | null>;
}

export interface DomexAgentOptions {
  name: string;
  promptFile: string;
  categories: MarketCategory[];
  /** LLM task tier — defaults to DOMEX_FEATURE_EXTRACT (TIER_1/Haiku) */
  task?: LLMTask;
  /** Optional async function that returns extra context to inject into the user message */
  contextProvider?: (title: string, description: string | null) => Promise<{ context: string; freshness: 'live' | 'cached' | 'stale' | 'none'; sources: string[] }>;
}

export function createDomexAgent(opts: DomexAgentOptions): DomexAgent {
  const promptPath = path.join(__dirname, '../../prompts', opts.promptFile);
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

  return {
    name: opts.name,
    categories: opts.categories,
    async run(title, description, category, closesAt?) {
      try {
        // Fetch optional context (e.g., FRED data for FED-HAWK)
        let extraContext = '';
        let freshness: DomexAgentResult['dataFreshness'] = 'none';
        let sources: string[] = [];
        if (opts.contextProvider) {
          try {
            const ctx = await opts.contextProvider(title, description);
            extraContext = ctx.context;
            freshness = ctx.freshness;
            sources = ctx.sources;
          } catch {
            // Continue without context on failure
          }
        }

        const result = await callClaude<DomexAgentResult>({
          task: opts.task ?? 'DOMEX_AGENT',
          systemPrompt,
          userMessage: (() => {
            const { getDateContext, getMarketDateContext } = require('../../lib/date-context');
            // CRITICAL: NO market price shown to agents — prevents anchoring bias.
            // Agents must estimate features independently from market price.
            return [
              `## Date Context`,
              getDateContext(),
              getMarketDateContext(closesAt),
              ``,
              `## Prediction Market`,
              `Question: ${title}`,
              description ? `Description: ${description.slice(0, 500)}` : '',
              `Category: ${category}`,
              '',
              extraContext ? `${extraContext}\n` : '',
              `Extract the structured features described in your instructions. Do NOT estimate probabilities.`,
            ].filter(Boolean).join('\n');
          })(),
        });

        // Attach data source metadata
        const parsed = result.parsed;
        if (!parsed.dataSourcesUsed) parsed.dataSourcesUsed = sources;
        if (!parsed.dataFreshness) parsed.dataFreshness = freshness;
        return parsed;
      } catch (err) {
        logger.error({ err, agent: opts.name }, `DOMEX ${opts.name} agent failed`);
        return null;
      }
    },
  };
}
