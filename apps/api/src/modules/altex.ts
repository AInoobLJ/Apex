import fs from 'node:fs';
import path from 'node:path';
import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { callClaude } from '../services/claude-client';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const ALTEX_PROMPT = fs.readFileSync(
  path.join(__dirname, '../prompts/altex-news.md'), 'utf-8'
);

interface NewsArticle {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
}

interface AltexScreenResult {
  isRelevant: boolean;
  relevantMarketIds: string[];
}

interface MarketImpact {
  marketId: string;
  relevance: number;
  probabilityShift: number;
  direction: 'TOWARD_YES' | 'TOWARD_NO';
  likelyPricedIn: number;
  sourceReliability: number;
  summary: string;
  keyArticles: string[];
}

interface AltexAnalysisResult {
  marketImpacts: MarketImpact[];
  noImpactMarkets: string[];
}

/**
 * ALTEX module — analyzes news for market impact.
 * Unlike other modules, ALTEX operates on batches of markets + articles,
 * not individual markets. Call analyzeNewsImpact() directly.
 */
export class AltexModule extends SignalModule {
  readonly moduleId = 'ALTEX' as const;

  /** Single-market analysis — asks Claude about recent news impact on this market */
  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    // Only analyze markets with enough context
    if (!market.description && !market.title) return null;

    try {
      const result = await callClaude<{
        hasRecentNews: boolean;
        probabilityShift: number;
        direction: 'TOWARD_YES' | 'TOWARD_NO';
        likelyPricedIn: number;
        reasoning: string;
      }>({
        task: 'ALTEX_ANALYSIS',
        systemPrompt: 'You assess whether recent news or developments may have shifted the probability of a prediction market outcome. IMPORTANT: Base analysis on the CURRENT date provided, not historical events from training data. Respond with JSON: {"hasRecentNews": boolean, "probabilityShift": number (-0.30 to 0.30), "direction": "TOWARD_YES | TOWARD_NO", "likelyPricedIn": number (0-1), "reasoning": "string"}',
        userMessage: (() => { const { getDateContext, getMarketDateContext } = require('../lib/date-context'); return `${getDateContext()}\n${getMarketDateContext(market.closesAt)}\n\nMarket: ${market.title}\nCategory: ${market.category}\nCurrent YES price: ${(marketPrice * 100).toFixed(1)}%\nDescription: ${(market.description || '').slice(0, 400)}\n\nBased on the CURRENT state of affairs as of the date above, has anything happened that would shift this market's probability? If so, how much and in which direction?`; })(),
      });

      const analysis = result.parsed;
      if (!analysis.hasRecentNews || Math.abs(analysis.probabilityShift) < 0.02) return null;

      const netShift = analysis.probabilityShift * (1 - analysis.likelyPricedIn);
      const adjustedProb = clampProbability(marketPrice + netShift);

      return this.makeSignal(
        market.id,
        adjustedProb,
        Math.min(0.5, Math.abs(netShift) * 2), // confidence proportional to shift
        analysis.reasoning,
        {
          probabilityShift: analysis.probabilityShift,
          direction: analysis.direction,
          likelyPricedIn: analysis.likelyPricedIn,
          llmCost: result.usage.cost,
        },
        360
      );
    } catch (err) {
      logger.error({ err, marketId: market.id }, 'ALTEX single-market analysis failed');
      return null;
    }
  }

  /**
   * Analyze a batch of news articles against a set of markets.
   * Two-pass: TIER_1 filters relevant articles, TIER_2 deep analysis.
   */
  async analyzeNewsImpact(
    articles: NewsArticle[],
    markets: { id: string; title: string; category: string; yesPrice: number }[]
  ): Promise<SignalOutput[]> {
    if (articles.length === 0 || markets.length === 0) return [];

    // TIER_1: Screen which articles are relevant to prediction markets
    const relevantArticles = await this.screenArticles(articles, markets);
    if (relevantArticles.length === 0) return [];

    // TIER_2: Deep analysis of relevant articles against markets
    try {
      const result = await callClaude<AltexAnalysisResult>({
        task: 'ALTEX_ANALYSIS',
        systemPrompt: ALTEX_PROMPT,
        userMessage: this.buildAnalysisPrompt(relevantArticles, markets),
      });

      return this.impactsToSignals(result.parsed.marketImpacts, markets);
    } catch (err) {
      logger.error({ err }, 'ALTEX analysis failed');
      return [];
    }
  }

  /** TIER_1 screen — cheap check which articles matter */
  private async screenArticles(
    articles: NewsArticle[],
    markets: { id: string; title: string }[]
  ): Promise<NewsArticle[]> {
    try {
      const articleSummaries = articles.slice(0, 20).map((a, i) =>
        `[${i}] ${a.title} (${a.source}, ${a.publishedAt})`
      ).join('\n');

      const marketSummaries = markets.slice(0, 30).map(m =>
        `- ${m.title} (id: ${m.id})`
      ).join('\n');

      const result = await callClaude<AltexScreenResult>({
        task: 'SCREEN_NEWS',
        systemPrompt: 'You filter news articles for prediction market relevance. Respond with JSON: {"isRelevant": boolean, "relevantMarketIds": ["string"]}',
        userMessage: `Which of these articles could affect these prediction markets?\n\nArticles:\n${articleSummaries}\n\nMarkets:\n${marketSummaries}`,
        maxTokens: 512,
      });

      if (!result.parsed.isRelevant) return [];
      return articles; // Return all if any are relevant (deep analysis will sort out)
    } catch {
      return articles.slice(0, 10); // On failure, send first 10 to deep analysis
    }
  }

  private buildAnalysisPrompt(
    articles: NewsArticle[],
    markets: { id: string; title: string; category: string; yesPrice: number }[]
  ): string {
    const articleText = articles.slice(0, 15).map(a =>
      `### ${a.title}\nSource: ${a.source} | Published: ${a.publishedAt}\n${a.description?.slice(0, 300) || 'No description'}`
    ).join('\n\n');

    const marketText = markets.slice(0, 20).map(m =>
      `- [${m.id}] ${m.title} (${m.category}, YES=${(m.yesPrice * 100).toFixed(1)}%)`
    ).join('\n');

    const { getDateContext } = require('../lib/date-context');
    return `## Date Context\n${getDateContext()}\n\n## Recent News Articles\n${articleText}\n\n## Active Markets\n${marketText}`;
  }

  private impactsToSignals(
    impacts: MarketImpact[],
    markets: { id: string; yesPrice: number }[]
  ): SignalOutput[] {
    return impacts
      .filter(imp => Math.abs(imp.probabilityShift) > 0.02 && imp.likelyPricedIn < 0.7)
      .map(imp => {
        const market = markets.find(m => m.id === imp.marketId);
        if (!market) return null;

        const netShift = imp.probabilityShift * (1 - imp.likelyPricedIn) * imp.sourceReliability;
        const adjustedProb = clampProbability(market.yesPrice + netShift);

        return {
          moduleId: 'ALTEX' as const,
          marketId: imp.marketId,
          probability: adjustedProb,
          confidence: imp.relevance * imp.sourceReliability * (1 - imp.likelyPricedIn),
          reasoning: imp.summary,
          metadata: {
            probabilityShift: imp.probabilityShift,
            direction: imp.direction,
            likelyPricedIn: imp.likelyPricedIn,
            sourceReliability: imp.sourceReliability,
            keyArticles: imp.keyArticles,
          },
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 hours
        } as SignalOutput;
      })
      .filter((s): s is SignalOutput => s !== null);
  }
}

export const altexModule = new AltexModule();
