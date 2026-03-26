import { createDomexAgent } from './base-agent';

export const entertainmentScoutAgent = createDomexAgent({
  name: 'ENTERTAINMENT-SCOUT',
  promptFile: 'domex-entertainment-scout.md',
  categories: ['CULTURE'],
});
