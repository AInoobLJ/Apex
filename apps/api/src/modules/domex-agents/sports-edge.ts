import { createDomexAgent } from './base-agent';
import { getSportsOdds } from '../../services/data-sources/odds-api';
import { getEspnData } from '../../services/data-sources/espn-data';

/**
 * SPORTS-EDGE: requires real data from The Odds API and/or ESPN.
 * If BOTH sources return no data, the agent returns null (no signal).
 * Either source alone is sufficient — ESPN provides injuries/standings/form,
 * The Odds API provides bookmaker-implied probabilities and line movement.
 */
export const sportsEdgeAgent = createDomexAgent({
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
  // SAFETY: Agent must not run without real data from at least one source.
  // Without this gate, the LLM hallucinates features (e.g. "62% Schauffele").
  requireContext: true,
});
