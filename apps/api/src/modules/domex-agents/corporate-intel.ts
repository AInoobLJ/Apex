import { createDomexAgent } from './base-agent';
import { getCorporateIntelContext } from '../../services/data-sources/finnhub';

export const corporateIntelAgent = createDomexAgent({
  name: 'CORPORATE-INTEL',
  promptFile: 'domex-corporate-intel.md',
  categories: ['FINANCE'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    return getCorporateIntelContext(title, description);
  },
});
