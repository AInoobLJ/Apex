import fs from 'node:fs';
import path from 'node:path';
import { callClaude } from '../../services/claude-client';
import { logger } from '../../lib/logger';
import type { MarketCategory } from '@apex/db';

export interface DomexAgentResult {
  probability: number;
  confidence: number;
  topFactors: string[];
  keyUncertainties: string[];
  reasoning: string;
}

export interface DomexAgent {
  name: string;
  categories: MarketCategory[];
  run(title: string, description: string | null, marketPrice: number, category: MarketCategory, closesAt?: Date | null): Promise<DomexAgentResult | null>;
}

export interface DomexAgentOptions {
  name: string;
  promptFile: string;
  categories: MarketCategory[];
  /** Optional async function that returns extra context to inject into the user message */
  contextProvider?: () => Promise<string>;
}

export function createDomexAgent(opts: DomexAgentOptions): DomexAgent;
export function createDomexAgent(name: string, promptFile: string, categories: MarketCategory[]): DomexAgent;
export function createDomexAgent(
  nameOrOpts: string | DomexAgentOptions,
  promptFile?: string,
  categories?: MarketCategory[]
): DomexAgent {
  const opts: DomexAgentOptions = typeof nameOrOpts === 'string'
    ? { name: nameOrOpts, promptFile: promptFile!, categories: categories! }
    : nameOrOpts;

  const promptPath = path.join(__dirname, '../../prompts', opts.promptFile);
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8');

  return {
    name: opts.name,
    categories: opts.categories,
    async run(title, description, marketPrice, category, closesAt?) {
      try {
        // Fetch optional context (e.g., FRED data for FED-HAWK)
        let extraContext = '';
        if (opts.contextProvider) {
          try {
            extraContext = await opts.contextProvider();
          } catch {
            // Continue without context on failure
          }
        }

        const result = await callClaude<DomexAgentResult>({
          task: 'DOMEX_AGENT',
          systemPrompt,
          userMessage: (() => {
            const { getDateContext, getMarketDateContext } = require('../../lib/date-context');
            return [
              `## Date Context`,
              getDateContext(),
              getMarketDateContext(closesAt),
              ``,
              `## Prediction Market`,
              `Question: ${title}`,
              description ? `Description: ${description.slice(0, 500)}` : '',
              `Category: ${category}`,
              `Current YES price: ${(marketPrice * 100).toFixed(1)}%`,
              '',
              extraContext ? `${extraContext}\n` : '',
              `Estimate the probability of YES and explain your reasoning.`,
            ].filter(Boolean).join('\n');
          })(),
        });
        return result.parsed;
      } catch (err) {
        logger.error({ err, agent: opts.name }, `DOMEX ${opts.name} agent failed`);
        return null;
      }
    },
  };
}
