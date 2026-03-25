import { createDomexAgent } from './base-agent';
import { getFredData, formatFredContext } from '../../services/data-sources/fred';
import { getFedWatchData, formatFedWatchContext } from '../../services/data-sources/fedwatch';

export const fedHawkAgent = createDomexAgent({
  name: 'FED-HAWK',
  promptFile: 'domex-fed-hawk.md',
  categories: ['FINANCE'],
  contextProvider: async () => {
    const [fredData, fedwatchData] = await Promise.allSettled([
      getFredData(),
      getFedWatchData(),
    ]);

    const parts: string[] = [];
    if (fredData.status === 'fulfilled') parts.push(formatFredContext(fredData.value));
    if (fedwatchData.status === 'fulfilled' && fedwatchData.value.length > 0) {
      parts.push(formatFedWatchContext(fedwatchData.value));
    }
    return parts.join('\n\n');
  },
});
