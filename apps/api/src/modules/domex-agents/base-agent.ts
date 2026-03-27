import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger';
import type { MarketCategory } from '@apex/db';
import type { LLMTask, LLMProvider } from '@apex/shared';

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
  /** Injected LLM provider — if not set, falls back to require('../../services/claude-client') */
  llmProvider?: LLMProvider;
  /** Optional async function that returns extra context to inject into the user message */
  contextProvider?: (title: string, description: string | null) => Promise<{ context: string; freshness: 'live' | 'cached' | 'stale' | 'none'; sources: string[] }>;
  /**
   * If true, the agent returns null when the context provider returns empty/no data.
   * Prevents LLM from hallucinating features without real data (e.g. sports odds).
   */
  requireContext?: boolean;
}

export function createDomexAgent(opts: DomexAgentOptions): DomexAgent {
  const promptPath = path.join(__dirname, '../../prompts', opts.promptFile);
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

  return {
    name: opts.name,
    categories: opts.categories,
    async run(title, description, category, closesAt?) {
      try {
        // Fetch optional context (e.g., FRED data for FED-HAWK, odds for SPORTS-EDGE)
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
            // Continue without context on failure (unless required)
          }
        }

        // SAFETY: If context is required but empty/missing, return null instead of
        // letting the LLM hallucinate features without real data.
        if (opts.requireContext && (!extraContext || extraContext.trim() === '')) {
          logger.debug({ agent: opts.name }, `${opts.name}: no context data available — returning null (requireContext=true)`);
          return null;
        }

        const { getDateContext, getMarketDateContext } = require('../../lib/date-context');
        const userMessage = [
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

        // Use injected LLM provider if available, otherwise fall back to direct import
        let parsed: DomexAgentResult;
        if (opts.llmProvider) {
          const result = await opts.llmProvider.call<DomexAgentResult>({
            task: opts.task ?? 'DOMEX_AGENT',
            systemPrompt,
            userMessage,
          });
          parsed = result.parsed;
        } else {
          // Legacy fallback for agents not yet wired through provider
          const { callClaude } = require('../../services/claude-client') as { callClaude: <T>(opts: any) => Promise<{ parsed: T }> };
          const result = await callClaude<DomexAgentResult>({
            task: opts.task ?? 'DOMEX_AGENT',
            systemPrompt,
            userMessage,
          });
          parsed = result.parsed;
        }
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
