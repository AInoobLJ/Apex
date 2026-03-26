import { createDomexAgent } from './base-agent';
import { getSportsOdds } from '../../services/data-sources/odds-api';

export const sportsEdgeAgent = createDomexAgent({
  name: 'SPORTS-EDGE',
  promptFile: 'domex-sports-edge.md',
  categories: ['SPORTS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    return getSportsOdds(title, description);
  },
});
