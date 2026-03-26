import { createDomexAgent } from './base-agent';

export const legalEagleAgent = createDomexAgent({
  name: 'LEGAL-EAGLE',
  promptFile: 'domex-legal-eagle.md',
  categories: ['POLITICS'], // Legal markets are mostly under POLITICS category
});
