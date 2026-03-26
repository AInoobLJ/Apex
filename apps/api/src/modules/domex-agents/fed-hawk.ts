import { createDomexAgent } from './base-agent';
import { getFredData, formatFredContext } from '../../services/data-sources/fred';
import { getFedWatchData, formatFedWatchContext } from '../../services/data-sources/fedwatch';

export const fedHawkAgent = createDomexAgent({
  name: 'FED-HAWK',
  promptFile: 'domex-fed-hawk.md',
  categories: ['FINANCE'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async () => {
    const [fredData, fedwatchData] = await Promise.allSettled([
      getFredData(),
      getFedWatchData(),
    ]);

    const parts: string[] = [];
    const sources: string[] = [];
    if (fredData.status === 'fulfilled') {
      parts.push(formatFredContext(fredData.value));
      sources.push('FRED');
    }
    if (fedwatchData.status === 'fulfilled' && fedwatchData.value.length > 0) {
      parts.push(formatFedWatchContext(fedwatchData.value));
      sources.push('CME FedWatch');
    }
    return {
      context: parts.join('\n\n'),
      freshness: sources.length > 0 ? 'cached' as const : 'none' as const,
      sources,
    };
  },
});
