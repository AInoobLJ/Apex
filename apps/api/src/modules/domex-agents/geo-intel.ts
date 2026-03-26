import { createDomexAgent } from './base-agent';
import { getPollingData, formatPollingContext } from '../../services/data-sources/polling';
import { getRecentActivity, searchBills, formatCongressContext, estimatePassageProbability } from '../../services/data-sources/congress';

export const geoIntelAgent = createDomexAgent({
  name: 'GEO-INTEL',
  promptFile: 'domex-geo-intel.md',
  categories: ['POLITICS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    const [pollingData, congressData] = await Promise.allSettled([
      getPollingData(),
      getRecentActivity(10),
    ]);

    const parts: string[] = [];
    const sources: string[] = [];

    if (pollingData.status === 'fulfilled') {
      parts.push(formatPollingContext(pollingData.value));
      sources.push('Polling Data');
    }
    if (congressData.status === 'fulfilled' && congressData.value.length > 0) {
      parts.push(formatCongressContext(congressData.value));
      sources.push('Congress.gov');

      // For legislation markets, provide calibrated passage probability as baseline
      const searchText = `${title} ${description || ''}`.toLowerCase();
      const isLegislation = /\b(bill|act|law|legislation|pass|congress|house|senate)\b/.test(searchText);
      if (isLegislation) {
        // Search for relevant bills and compute passage probabilities
        try {
          const keywords = title.split(/\s+/).filter(w => w.length > 4).slice(0, 3).join(' ');
          const bills = await searchBills(keywords, 3);
          if (bills.length > 0) {
            const passageLines = ['## Bill Passage Base Rates (calibrated historical data)'];
            for (const bill of bills) {
              const prob = estimatePassageProbability(bill.status, bill.cosponsors, bill.bipartisan);
              passageLines.push(`- ${bill.number} (${bill.shortTitle}): Status=${bill.status}, Base rate=${(prob * 100).toFixed(0)}%, Cosponsors=${bill.cosponsors}, Bipartisan=${bill.bipartisan}`);
            }
            parts.push(passageLines.join('\n'));
            sources.push('Congress Base Rates');
          }
        } catch {
          // Continue without bill search
        }
      }
    }

    return {
      context: parts.join('\n\n'),
      freshness: sources.length > 0 ? 'cached' as const : 'none' as const,
      sources,
    };
  },
});
