import { createDomexAgent } from './base-agent';
import { getPollingData, formatPollingContext } from '../../services/data-sources/polling';
import { getRecentActivity, formatCongressContext } from '../../services/data-sources/congress';

export const geoIntelAgent = createDomexAgent({
  name: 'GEO-INTEL',
  promptFile: 'domex-geo-intel.md',
  categories: ['POLITICS'],
  contextProvider: async () => {
    const [pollingData, congressData] = await Promise.allSettled([
      getPollingData(),
      getRecentActivity(10),
    ]);

    const parts: string[] = [];
    if (pollingData.status === 'fulfilled') parts.push(formatPollingContext(pollingData.value));
    if (congressData.status === 'fulfilled' && congressData.value.length > 0) {
      parts.push(formatCongressContext(congressData.value));
    }
    return parts.join('\n\n');
  },
});
