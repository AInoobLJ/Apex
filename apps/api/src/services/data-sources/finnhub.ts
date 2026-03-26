/**
 * Finnhub API (finnhub.io) — free tier: 60 calls/minute.
 * Provides earnings dates, analyst estimates, SEC filings, and FDA approvals.
 *
 * Also includes OpenFDA API (free, no key) for FDA approval tracking.
 */
import { logger } from '../../lib/logger';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const OPENFDA_BASE = 'https://api.fda.gov/drug';

interface CorporateContext {
  context: string;
  freshness: 'live' | 'cached' | 'stale' | 'none';
  sources: string[];
}

// Map common company names to tickers
const COMPANY_TICKERS: Record<string, string> = {
  'apple': 'AAPL', 'google': 'GOOGL', 'alphabet': 'GOOGL', 'microsoft': 'MSFT',
  'amazon': 'AMZN', 'meta': 'META', 'facebook': 'META', 'tesla': 'TSLA',
  'nvidia': 'NVDA', 'netflix': 'NFLX', 'disney': 'DIS', 'walmart': 'WMT',
  'jpmorgan': 'JPM', 'goldman': 'GS', 'boeing': 'BA', 'pfizer': 'PFE',
  'moderna': 'MRNA', 'johnson': 'JNJ', 'merck': 'MRK', 'eli lilly': 'LLY',
  'novo nordisk': 'NVO', 'abbvie': 'ABBV', 'bristol': 'BMY',
};

function extractTicker(title: string): string | null {
  const lower = title.toLowerCase();

  // Direct ticker mention: $AAPL or (AAPL)
  const tickerMatch = title.match(/\$([A-Z]{1,5})\b|\(([A-Z]{1,5})\)/);
  if (tickerMatch) return tickerMatch[1] || tickerMatch[2];

  // Company name lookup
  for (const [name, ticker] of Object.entries(COMPANY_TICKERS)) {
    if (lower.includes(name)) return ticker;
  }

  return null;
}

function detectFDA(title: string): string | null {
  const lower = title.toLowerCase();
  if (!/\b(fda|approval|approve|drug|therapy|treatment|pharma)\b/.test(lower)) return null;

  // Try to extract drug name
  const drugMatch = title.match(/\b([A-Z][a-z]+(?:mab|nib|lib|zumab|tinib|ciclib|rafenib|parin))\b/);
  if (drugMatch) return drugMatch[1];

  return lower.includes('fda') ? 'fda' : null;
}

export async function getCorporateIntelContext(title: string, description: string | null): Promise<CorporateContext> {
  const apiKey = process.env.FINNHUB_API_KEY;
  const sources: string[] = [];
  const parts: string[] = [];

  const ticker = extractTicker(title);
  const fdaDrug = detectFDA(title);

  // Finnhub: earnings, estimates, filings
  if (ticker && apiKey) {
    const axios = require('axios');

    try {
      // Earnings calendar
      const now = new Date();
      const from = now.toISOString().split('T')[0];
      const to = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];

      const [earningsResp, recResp, filingResp] = await Promise.allSettled([
        axios.get(`${FINNHUB_BASE}/calendar/earnings`, {
          params: { symbol: ticker, from, to, token: apiKey },
          timeout: 5000,
        }),
        axios.get(`${FINNHUB_BASE}/stock/recommendation`, {
          params: { symbol: ticker, token: apiKey },
          timeout: 5000,
        }),
        axios.get(`${FINNHUB_BASE}/stock/filings`, {
          params: { symbol: ticker, token: apiKey },
          timeout: 5000,
        }),
      ]);

      // Earnings
      if (earningsResp.status === 'fulfilled') {
        const earnings = earningsResp.value.data?.earningsCalendar?.slice(0, 3) || [];
        if (earnings.length > 0) {
          parts.push(`## Earnings Calendar — ${ticker}`);
          for (const e of earnings) {
            parts.push(`- ${e.date}: EPS estimate ${e.epsEstimate ?? 'N/A'}, actual ${e.epsActual ?? 'TBD'}, revenue estimate ${e.revenueEstimate ?? 'N/A'}`);
          }
          sources.push('Finnhub Earnings');
        }
      }

      // Analyst recommendations
      if (recResp.status === 'fulfilled') {
        const recs = recResp.value.data?.slice(0, 3) || [];
        if (recs.length > 0) {
          parts.push(`## Analyst Consensus — ${ticker}`);
          for (const r of recs) {
            parts.push(`- ${r.period}: Buy=${r.buy}, Hold=${r.hold}, Sell=${r.sell}, Strong Buy=${r.strongBuy}, Strong Sell=${r.strongSell}`);
          }
          sources.push('Finnhub Analysts');
        }
      }

      // SEC Filings
      if (filingResp.status === 'fulfilled') {
        const filings = filingResp.value.data?.slice(0, 5) || [];
        if (filings.length > 0) {
          parts.push(`## Recent SEC Filings — ${ticker}`);
          for (const f of filings) {
            parts.push(`- ${f.filedDate}: ${f.form} — ${(f.source || '').slice(0, 100)}`);
          }
          sources.push('Finnhub SEC Filings');
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message, ticker }, 'Finnhub fetch failed');
    }
  }

  // OpenFDA: drug approval tracking (free, no key needed)
  if (fdaDrug && fdaDrug !== 'fda') {
    try {
      const axios = require('axios');
      const resp = await axios.get(`${OPENFDA_BASE}/drugsfda.json`, {
        params: {
          search: `openfda.brand_name:"${fdaDrug}"`,
          limit: 3,
        },
        timeout: 5000,
      });

      const results = resp.data?.results || [];
      if (results.length > 0) {
        parts.push(`## FDA Drug Data — ${fdaDrug}`);
        for (const r of results) {
          const appType = r.application_type || 'N/A';
          const sponsor = r.sponsor_name || 'N/A';
          const submissions = r.submissions?.slice(0, 2) || [];
          parts.push(`- Application: ${appType}, Sponsor: ${sponsor}`);
          for (const s of submissions) {
            parts.push(`  - ${s.submission_type} ${s.submission_number}: ${s.submission_status} (${s.submission_status_date || 'N/A'})`);
          }
        }
        sources.push('OpenFDA');
      }
    } catch (err: any) {
      logger.debug({ err: err.message, drug: fdaDrug }, 'OpenFDA fetch failed');
    }
  }

  return {
    context: parts.join('\n'),
    freshness: sources.length > 0 ? 'live' : 'none',
    sources,
  };
}
