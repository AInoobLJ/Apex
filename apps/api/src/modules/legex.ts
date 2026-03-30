import fs from 'node:fs';
import path from 'node:path';
import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData, ModuleDeps } from './base';
import { logger } from '../lib/logger';

const LEGEX_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/legex-system.md'), 'utf-8'
);

interface LegexScreenResult {
  isAmbiguous: boolean;
  reason: string;
}

interface LegexAnalysisResult {
  ambiguityScore: number;
  misinterpretationProbability: number;
  probabilityAdjustment: number;
  adjustmentDirection: 'TOWARD_YES' | 'TOWARD_NO' | 'NONE';
  reasoning: string;
  ambiguousTerms: { term: string; interpretations: string[]; riskLevel: number }[];
  crossPlatformDivergence: { detected: boolean; details: string | null };
}

export class LegexModule extends SignalModule {
  readonly moduleId = 'LEGEX' as const;

  constructor(deps?: ModuleDeps) {
    super(deps);
  }

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    // Skip markets without resolution text — use description as fallback
    const resolutionText = market.resolutionText || market.description;
    if (!resolutionText || resolutionText.length < 20) return null;

    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    // TIER_1 screen: "is this resolution ambiguous?"
    const shouldAnalyze = await this.screenMarket(market);
    if (!shouldAnalyze) return null;

    // TIER_2 deep analysis
    try {
      if (!this.llmProvider) throw new Error('LEGEX requires llmProvider');
      const result = await this.llmProvider.call<LegexAnalysisResult>({
        task: 'LEGEX_ANALYSIS',
        systemPrompt: LEGEX_PROMPT,
        userMessage: this.buildAnalysisPrompt(market, marketPrice),
      });

      const analysis = result.parsed;
      if (analysis.ambiguityScore < 2 && analysis.misinterpretationProbability < 0.1) {
        return null; // Not ambiguous enough to generate a signal
      }

      const adjustment = analysis.adjustmentDirection === 'NONE'
        ? 0
        : analysis.probabilityAdjustment;
      const adjustedProb = clampProbability(marketPrice + adjustment);

      const confidence = Math.min(0.7, analysis.misinterpretationProbability * (analysis.ambiguityScore / 5));

      return this.makeSignal(
        market.id,
        adjustedProb,
        confidence,
        analysis.reasoning,
        {
          ambiguityScore: analysis.ambiguityScore,
          misinterpretationProbability: analysis.misinterpretationProbability,
          adjustment,
          adjustmentDirection: analysis.adjustmentDirection,
          ambiguousTerms: analysis.ambiguousTerms,
          crossPlatformDivergence: analysis.crossPlatformDivergence,
          llmCost: result.usage.cost,
        },
        360 // expires in 6 hours
      );
    } catch (err) {
      logger.error({ err, marketId: market.id }, 'LEGEX analysis failed');
      return null;
    }
  }

  /** TIER_1 screen — cheap check if resolution is worth deep analysis */
  private async screenMarket(market: MarketWithData): Promise<boolean> {
    try {
      if (!this.llmProvider) throw new Error('LEGEX requires llmProvider');
      const result = await this.llmProvider.call<LegexScreenResult>({
        task: 'SCREEN_MARKET',
        systemPrompt: 'You screen prediction market resolution text for ambiguity. Respond with JSON: {"isAmbiguous": boolean, "reason": "string"}',
        userMessage: `Is this resolution text potentially ambiguous or commonly misunderstood?\n\nTitle: ${market.title}\nResolution: ${market.resolutionText?.slice(0, 500)}`,
        maxTokens: 256,
      });
      return result.parsed.isAmbiguous;
    } catch {
      return false; // Skip on screen failure
    }
  }

  private buildAnalysisPrompt(market: MarketWithData, marketPrice: number): string {
    const { getDateContext, getMarketDateContext } = require('../lib/date-context');
    return [
      `## Date Context`,
      getDateContext(),
      getMarketDateContext(market.closesAt),
      ``,
      `## Market`,
      `Title: ${market.title}`,
      `Platform: ${market.platform}`,
      `Category: ${market.category}`,
      ``,
      `## Resolution Text`,
      market.resolutionText || market.description || 'No resolution text available',
      market.resolutionSource ? `\nResolution Source: ${market.resolutionSource}` : '',
    ].join('\n');
  }
}

import { ClaudeLLMProvider } from '../providers/claude-llm-provider';
export const legexModule = new LegexModule({ llmProvider: new ClaudeLLMProvider() });
export function createLegexModule(deps: ModuleDeps) { return new LegexModule(deps); }
