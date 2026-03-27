import { createDomexAgent } from './base-agent';
import { getSportsOdds } from '../../services/data-sources/odds-api';
import { logger } from '../../lib/logger';

/**
 * SPORTS-EDGE: requires real odds data from The Odds API.
 * If THE_ODDS_API_KEY is not set or the API returns no data for this market,
 * the agent returns null (no signal) instead of guessing with hallucinated features.
 */
export const sportsEdgeAgent = createDomexAgent({
  name: 'SPORTS-EDGE',
  promptFile: 'domex-sports-edge.md',
  categories: ['SPORTS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    return getSportsOdds(title, description);
  },
  // SAFETY: Agent must not run without real odds data.
  // Without this gate, the LLM hallucinates features (e.g. "62% Schauffele").
  requireContext: true,
});
