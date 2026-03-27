import { SignalOutput, ModuleId } from '@apex/shared';
import type { MarketDataProvider, LLMProvider } from '@apex/shared';
import { Market, Contract, PriceSnapshot, OrderBookSnapshot } from '@apex/db';
import { logger } from '../lib/logger';

export interface MarketWithData extends Market {
  contracts: Contract[];
  priceSnapshots: PriceSnapshot[];
}

export interface MarketWithOrderBook extends MarketWithData {
  contracts: (Contract & { orderBookSnapshots: OrderBookSnapshot[] })[];
}

export interface ModuleDeps {
  dataProvider?: MarketDataProvider;
  llmProvider?: LLMProvider;
}

export abstract class SignalModule {
  abstract readonly moduleId: ModuleId;
  protected dataProvider?: MarketDataProvider;
  protected llmProvider?: LLMProvider;

  constructor(deps?: ModuleDeps) {
    this.dataProvider = deps?.dataProvider;
    this.llmProvider = deps?.llmProvider;
  }

  async run(market: MarketWithData): Promise<SignalOutput | null> {
    const start = Date.now();
    try {
      const result = await this.analyze(market);
      const elapsed = Date.now() - start;
      logger.info({ moduleId: this.moduleId, marketId: market.id, elapsed }, 'Module analysis complete');
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      logger.error({ moduleId: this.moduleId, marketId: market.id, elapsed, err }, 'Module analysis failed');
      return null;
    }
  }

  protected abstract analyze(market: MarketWithData): Promise<SignalOutput | null>;

  protected makeSignal(
    marketId: string,
    probability: number,
    confidence: number,
    reasoning: string,
    metadata: Record<string, unknown>,
    expiresInMinutes: number
  ): SignalOutput {
    return {
      moduleId: this.moduleId,
      marketId,
      probability: Math.max(0, Math.min(1, probability)),
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning,
      metadata,
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
    };
  }
}
