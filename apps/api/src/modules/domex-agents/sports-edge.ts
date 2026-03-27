import { createDomexAgent, type DomexAgent, type DomexAgentResult } from './base-agent';
import { getSportsOdds } from '../../services/data-sources/odds-api';
import { getEspnData } from '../../services/data-sources/espn-data';
import { getFukuData, detectFukuSport, type FukuFeatures } from '../../services/data-sources/fuku-data';
import { logger } from '../../lib/logger';
import type { MarketCategory } from '@apex/db';

/**
 * SPORTS-EDGE: Hybrid data-first sports analysis.
 *
 * Priority chain:
 *   1. Fuku Predictions API — pre-computed features (CBB, NBA, NHL, Soccer).
 *      When available, returns structured features DIRECTLY — no LLM call.
 *   2. The Odds API + ESPN — bookmaker odds + injuries/standings/form.
 *      Used only when Fuku doesn't cover the sport or specific game.
 *      Feeds context to the LLM for feature extraction.
 *
 * Safety: If ALL sources return no data, returns null (no signal).
 * Never hallucinates.
 */

/** Convert FukuFeatures to DomexAgentResult features format */
function fukuToAgentResult(features: FukuFeatures, sources: string[]): DomexAgentResult {
  const featureMap: Record<string, string | number | boolean | null> = {
    projectedSpread: features.projectedSpread,
    spreadEdge: features.spreadEdge,
    projectedTotal: features.projectedTotal,
    totalEdge: features.totalEdge,
    projectedHomeScore: features.projectedHomeScore,
    projectedAwayScore: features.projectedAwayScore,
    homeTeamRank: features.homeTeamRank,
    awayTeamRank: features.awayTeamRank,
    offensiveEfficiencyDiff: features.offensiveEfficiencyDiff,
    defensiveEfficiencyDiff: features.defensiveEfficiencyDiff,
    tempoDiff: features.tempoDiff,
    modelConfidence: features.modelConfidence,
    bookSpread: features.bookSpread,
    bookTotal: features.bookTotal,
    homeWinPct: features.homeWinPct,
    awayWinPct: features.awayWinPct,
    homeNetRating: features.homeNetRating,
    awayNetRating: features.awayNetRating,
    // Marker that this was a data passthrough (no LLM)
    fukuDataPassthrough: true,
  };

  // Build reasoning from features
  const spreadInfo = features.spreadEdge != null
    ? `Spread edge: ${features.spreadEdge > 0 ? '+' : ''}${features.spreadEdge.toFixed(1)} (Fuku: ${features.projectedSpread.toFixed(1)}, Book: ${features.bookSpread?.toFixed(1) ?? 'N/A'})`
    : `Projected spread: ${features.projectedSpread.toFixed(1)} (no book line available)`;
  const totalInfo = features.totalEdge != null
    ? `Total edge: ${features.totalEdge > 0 ? '+' : ''}${features.totalEdge.toFixed(1)} (Fuku: ${features.projectedTotal.toFixed(1)}, Book: ${features.bookTotal?.toFixed(1) ?? 'N/A'})`
    : `Projected total: ${features.projectedTotal.toFixed(1)} (no book line available)`;
  const scoreInfo = `Projected: ${features.projectedHomeScore.toFixed(1)} - ${features.projectedAwayScore.toFixed(1)}`;
  const effInfo = features.offensiveEfficiencyDiff != null
    ? `Off eff diff: ${features.offensiveEfficiencyDiff > 0 ? '+' : ''}${features.offensiveEfficiencyDiff.toFixed(1)}, Def eff diff: ${features.defensiveEfficiencyDiff?.toFixed(1) ?? 'N/A'}`
    : '';

  const reasoning = [
    `[Fuku Data Passthrough — no LLM call]`,
    scoreInfo,
    spreadInfo,
    totalInfo,
    effInfo,
    features.homeWinPct != null ? `Win rates: Home ${(features.homeWinPct * 100).toFixed(0)}%, Away ${(features.awayWinPct! * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('. ');

  return {
    features: featureMap,
    reasoning,
    dataSourcesUsed: sources,
    dataFreshness: 'live',
  };
}

/**
 * The LLM-based fallback agent — only used when Fuku doesn't cover the market.
 * Uses Odds API + ESPN data as context for Claude to extract features.
 */
const llmFallbackAgent = createDomexAgent({
  name: 'SPORTS-EDGE',
  promptFile: 'domex-sports-edge.md',
  categories: ['SPORTS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    const [odds, espn] = await Promise.allSettled([
      getSportsOdds(title, description),
      getEspnData(title, description),
    ]);

    const oddsResult = odds.status === 'fulfilled' ? odds.value : { context: '', freshness: 'none' as const, sources: [] };
    const espnResult = espn.status === 'fulfilled' ? espn.value : { context: '', freshness: 'none' as const, sources: [] };

    const context = [oddsResult.context, espnResult.context].filter(Boolean).join('\n\n');
    const sources = [...oddsResult.sources, ...espnResult.sources];
    const freshness = oddsResult.freshness === 'live' || espnResult.freshness === 'live'
      ? 'live' as const
      : oddsResult.freshness !== 'none' || espnResult.freshness !== 'none'
        ? 'cached' as const
        : 'none' as const;

    return { context, freshness, sources };
  },
  requireContext: true,
});

/**
 * SPORTS-EDGE agent — tries Fuku first (data passthrough), falls back to LLM.
 */
export const sportsEdgeAgent: DomexAgent = {
  name: 'SPORTS-EDGE',
  categories: ['SPORTS'] as MarketCategory[],

  async run(title, description, category, closesAt?) {
    // ── Step 1: Try Fuku (data passthrough — no LLM cost) ──
    try {
      const fuku = await getFukuData(title, description);

      if (fuku.features && fuku.prediction) {
        logger.info({
          agent: 'SPORTS-EDGE',
          mode: 'fuku-passthrough',
          home: fuku.prediction.home_team,
          away: fuku.prediction.away_team,
        }, 'SPORTS-EDGE: Fuku data passthrough (no LLM call)');

        return fukuToAgentResult(fuku.features, fuku.sources);
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, 'SPORTS-EDGE: Fuku fetch failed, falling back to LLM');
    }

    // ── Step 2: Fall back to LLM with Odds API + ESPN context ──
    logger.debug({ agent: 'SPORTS-EDGE', mode: 'llm-fallback' }, 'SPORTS-EDGE: Fuku has no data, falling back to Odds API + ESPN + LLM');
    return llmFallbackAgent.run(title, description, category, closesAt);
  },
};
