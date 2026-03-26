import { createDomexAgent } from './base-agent';
import { logger } from '../../lib/logger';

/**
 * Legal context from CourtListener API (free, courtlistener.com).
 */
async function getLegalContext(title: string): Promise<{ context: string; freshness: 'live' | 'cached' | 'stale' | 'none'; sources: string[] }> {
  const sources: string[] = [];
  const parts: string[] = [];

  try {
    const axios = require('axios');

    // Search CourtListener for relevant cases
    const keywords = title.split(/\s+/).filter(w => w.length > 4).slice(0, 4).join(' ');
    if (keywords.length > 5) {
      const resp = await axios.get('https://www.courtlistener.com/api/rest/v4/search/', {
        params: {
          q: keywords,
          type: 'o',  // opinions
          order_by: 'score desc',
          page_size: 5,
        },
        timeout: 5000,
        headers: { 'User-Agent': 'APEX-Legal/1.0' },
      });

      const results = resp.data?.results?.slice(0, 3) || [];
      if (results.length > 0) {
        parts.push('## Related Court Opinions (CourtListener)');
        for (const r of results) {
          parts.push(`- ${r.caseName || 'Unknown'} (${r.court || 'N/A'}, ${r.dateFiled || 'N/A'})`);
          if (r.snippet) parts.push(`  ${r.snippet.slice(0, 200)}`);
        }
        sources.push('CourtListener');
      }
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, 'CourtListener fetch failed');
  }

  return {
    context: parts.join('\n'),
    freshness: sources.length > 0 ? 'cached' as const : 'none' as const,
    sources,
  };
}

export const legalEagleAgent = createDomexAgent({
  name: 'LEGAL-EAGLE',
  promptFile: 'domex-legal-eagle.md',
  categories: ['POLITICS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: getLegalContext,
});
