import fs from 'node:fs';
import path from 'node:path';
import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData, ModuleDeps } from './base';
import { logger } from '../lib/logger';

const REFLEX_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/reflex-system.md'), 'utf-8'
);

interface ReflexResult {
  reflexivityType: 'SELF_REINFORCING' | 'SELF_DEFEATING' | 'NEUTRAL' | 'AMBIGUOUS';
  reflexiveElasticity: number;
  feedbackMechanism: string;
  equilibriumPrice: number | null;
  confidence: number;
  reasoning: string;
}

export class ReflexModule extends SignalModule {
  readonly moduleId = 'REFLEX' as const;

  constructor(deps?: ModuleDeps) {
    super(deps);
  }

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    try {
      if (!this.llmProvider) throw new Error('REFLEX requires llmProvider');
      const result = await this.llmProvider.call<ReflexResult>({
        task: 'REFLEX_ANALYSIS',
        systemPrompt: REFLEX_PROMPT,
        userMessage: (() => { const { getDateContext, getMarketDateContext } = require('../lib/date-context'); return `${getDateContext()}\n${getMarketDateContext(market.closesAt)}\n\nMarket: ${market.title}\nCategory: ${market.category}\nCurrent YES price: ${(marketPrice * 100).toFixed(1)}%\nDescription: ${(market.description || '').slice(0, 400)}`; })(),
      });

      const analysis = result.parsed;
      if (analysis.reflexivityType === 'NEUTRAL') return null;
      if (analysis.equilibriumPrice == null) return null;

      const equilibrium = clampProbability(analysis.equilibriumPrice);
      const adjustment = equilibrium - marketPrice;
      if (Math.abs(adjustment) < 0.02) return null;

      return this.makeSignal(
        market.id,
        equilibrium,
        analysis.confidence * 0.7, // Discount reflexivity confidence
        `${analysis.reflexivityType}: ${analysis.reasoning}`,
        {
          reflexivityType: analysis.reflexivityType,
          elasticity: analysis.reflexiveElasticity,
          feedbackMechanism: analysis.feedbackMechanism,
          equilibriumPrice: equilibrium,
          llmCost: result.usage.cost,
        },
        360
      );
    } catch (err) {
      logger.error({ err, marketId: market.id }, 'REFLEX analysis failed');
      return null;
    }
  }
}

export const reflexModule = new ReflexModule();

export function createReflexModule(deps: ModuleDeps) {
  return new ReflexModule(deps);
}
