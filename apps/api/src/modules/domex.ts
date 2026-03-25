import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { logger } from '../lib/logger';
import type { DomexAgent, DomexAgentResult } from './domex-agents/base-agent';
import { fedHawkAgent } from './domex-agents/fed-hawk';
import { geoIntelAgent } from './domex-agents/geo-intel';
import { cryptoAlphaAgent } from './domex-agents/crypto-alpha';
import type { MarketCategory } from '@apex/db';

const ALL_AGENTS: DomexAgent[] = [fedHawkAgent, geoIntelAgent, cryptoAlphaAgent];

export class DomexModule extends SignalModule {
  readonly moduleId = 'DOMEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    // Select agents relevant to this market's category
    const relevantAgents = ALL_AGENTS.filter(a =>
      a.categories.includes(market.category as MarketCategory)
    );

    // All agents run on markets that don't match specific categories
    // (general analysis agents could be added here)
    if (relevantAgents.length === 0) return null;

    // Run relevant agents in parallel
    const agentResults = await Promise.all(
      relevantAgents.map(agent =>
        agent.run(market.title, market.description, marketPrice, market.category as MarketCategory, market.closesAt)
      )
    );

    // Filter out failures
    const validResults = agentResults.filter((r): r is DomexAgentResult => r !== null);
    if (validResults.length === 0) return null;

    // Aggregate: trimmed mean (drop highest/lowest if 3+, otherwise average)
    const aggregated = this.aggregate(validResults);

    const reasoning = validResults.map((r, i) =>
      `${relevantAgents[i].name}: ${(r.probability * 100).toFixed(1)}% (conf: ${(r.confidence * 100).toFixed(0)}%) — ${r.reasoning.slice(0, 100)}`
    ).join('\n');

    return this.makeSignal(
      market.id,
      aggregated.probability,
      aggregated.confidence,
      reasoning,
      {
        agentCount: validResults.length,
        agents: validResults.map((r, i) => ({
          name: relevantAgents[i].name,
          probability: r.probability,
          confidence: r.confidence,
          topFactors: r.topFactors,
        })),
        agreement: aggregated.agreement,
      },
      360 // 6 hours
    );
  }

  private aggregate(results: DomexAgentResult[]): { probability: number; confidence: number; agreement: number } {
    const probs = results.map(r => r.probability);
    const confs = results.map(r => r.confidence);

    let avgProb: number;
    if (probs.length >= 3) {
      // Trimmed mean: drop highest and lowest
      const sorted = [...probs].sort((a, b) => a - b);
      const trimmed = sorted.slice(1, -1);
      avgProb = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    } else {
      avgProb = probs.reduce((s, v) => s + v, 0) / probs.length;
    }

    const avgConf = confs.reduce((s, v) => s + v, 0) / confs.length;

    // Agreement: 1 - spread. High spread = low agreement = penalty
    const spread = Math.max(...probs) - Math.min(...probs);
    const agreement = 1 - Math.min(1, spread / 0.30); // 0.30 spread = 0 agreement

    // Confidence penalized by disagreement
    const confidence = clampProbability(avgConf * agreement);

    return {
      probability: clampProbability(avgProb),
      confidence,
      agreement,
    };
  }
}

export const domexModule = new DomexModule();
