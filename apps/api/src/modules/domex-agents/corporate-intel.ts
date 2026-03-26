import { createDomexAgent } from './base-agent';

export const corporateIntelAgent = createDomexAgent({
  name: 'CORPORATE-INTEL',
  promptFile: 'domex-corporate-intel.md',
  categories: ['FINANCE'],
});
