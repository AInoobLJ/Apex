import { createDomexAgent } from './base-agent';

export const sportsEdgeAgent = createDomexAgent({
  name: 'SPORTS-EDGE',
  promptFile: 'domex-sports-edge.md',
  categories: ['SPORTS'],
});
