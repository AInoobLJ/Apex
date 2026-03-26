/**
 * EventDrivenIngestion — schedules high-frequency data capture around known event times.
 *
 * Knows the release schedule for BLS, FOMC, Congress votes.
 * Switches to high-frequency mode 5 minutes before releases.
 * Processes primary source data 5-30 minutes before aggregators.
 */
import { logger } from '../lib/logger';

export interface ScheduledEvent {
  name: string;
  source: string;         // 'BLS' | 'FOMC' | 'CONGRESS' | 'EARNINGS'
  cronPattern: string;    // When to start high-frequency capture
  url: string;            // Primary source URL
  fetchFn: string;        // Function name to call
  preEventMinutes: number; // Start capturing this many minutes early
}

// Known release schedules (Eastern Time)
export const KNOWN_SCHEDULES: ScheduledEvent[] = [
  // BLS releases at 8:30 AM ET on scheduled days
  {
    name: 'BLS CPI Release',
    source: 'BLS',
    cronPattern: '25 8 * * *',  // 8:25 AM ET — 5 min before release
    url: 'https://www.bls.gov/news.release/cpi.nr0.htm',
    fetchFn: 'scrapeBLSRelease',
    preEventMinutes: 5,
  },
  {
    name: 'BLS Jobs Report',
    source: 'BLS',
    cronPattern: '25 8 * * 5', // First Friday 8:25 AM (approximate)
    url: 'https://www.bls.gov/news.release/empsit.nr0.htm',
    fetchFn: 'scrapeBLSRelease',
    preEventMinutes: 5,
  },
  // FOMC statement at 2:00 PM ET on decision days
  {
    name: 'FOMC Rate Decision',
    source: 'FOMC',
    cronPattern: '55 13 * * 3', // 1:55 PM ET Wed — 5 min before
    url: 'https://www.federalreserve.gov/newsevents/pressreleases.htm',
    fetchFn: 'scrapeFOMCStatement',
    preEventMinutes: 5,
  },
  // Congress votes — check XML feed frequently
  {
    name: 'Congress Floor Votes',
    source: 'CONGRESS',
    cronPattern: '*/5 10-21 * * 1-5', // Every 5 min during session hours
    url: 'https://www.congress.gov/rss/most-viewed-bills.xml',
    fetchFn: 'scrapeCongressXML',
    preEventMinutes: 0,
  },
];

/**
 * Primary source scraper stubs.
 * Each returns extracted data as structured features.
 */

export interface BLSRelease {
  indicator: string;       // 'CPI' | 'UNEMPLOYMENT' | 'NFP'
  value: number;
  previousValue: number;
  change: number;
  consensusEstimate?: number;
  surprise?: number;       // actual - consensus
  timestamp: Date;
}

export interface FOMCDecision {
  rateDecision: 'HIKE' | 'CUT' | 'HOLD';
  rateChange: number;      // basis points
  newRate: number;
  statement: string;       // first 500 chars
  dotPlotShift?: string;
  timestamp: Date;
}

export interface CongressVote {
  billId: string;
  billTitle: string;
  chamber: 'HOUSE' | 'SENATE';
  voteResult: 'PASSED' | 'FAILED' | 'PENDING';
  yeas: number;
  nays: number;
  timestamp: Date;
}

/**
 * Scrape BLS release page for latest data.
 * Called at T-5 minutes, then every 10 seconds for 2 minutes after release time.
 */
export async function scrapeBLSRelease(url: string): Promise<BLSRelease | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'APEX-Research/1.0 (academic research)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const html = await response.text();

    // Extract headline number — BLS uses consistent HTML format
    // Look for "increased X.X percent" or "unchanged" or "decreased"
    const changeMatch = html.match(/(?:increased|rose|decreased|fell|unchanged)[\s\S]{0,30}?([\d.]+)\s*percent/i);
    if (!changeMatch) return null;

    const value = parseFloat(changeMatch[1]);
    const direction = /decreased|fell/i.test(changeMatch[0]) ? -1 : 1;

    return {
      indicator: url.includes('cpi') ? 'CPI' : url.includes('empsit') ? 'NFP' : 'OTHER',
      value: value * direction,
      previousValue: 0, // Would need historical data
      change: value * direction,
      timestamp: new Date(),
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message, url }, 'BLS scrape failed');
    return null;
  }
}

/**
 * Scrape Federal Reserve press releases for FOMC decisions.
 */
export async function scrapeFOMCStatement(url: string): Promise<FOMCDecision | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'APEX-Research/1.0 (academic research)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;

    const html = await response.text();

    // Look for rate decision language
    const rateMatch = html.match(/federal funds rate.*?(\d+(?:\.\d+)?)\s*(?:to|percent)/i);
    const decision = /maintain|unchanged/i.test(html) ? 'HOLD'
      : /increase|raise/i.test(html) ? 'HIKE' : 'CUT';

    return {
      rateDecision: decision,
      rateChange: decision === 'HOLD' ? 0 : 25, // default 25bp
      newRate: rateMatch ? parseFloat(rateMatch[1]) : 0,
      statement: html.replace(/<[^>]+>/g, '').slice(0, 500),
      timestamp: new Date(),
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'FOMC scrape failed');
    return null;
  }
}

/**
 * Check if we're within the pre-event window for any scheduled event.
 */
export function getActiveEvents(): ScheduledEvent[] {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay();

  return KNOWN_SCHEDULES.filter(event => {
    // Simple cron matching for hour/minute
    const [cronMin, cronHour] = event.cronPattern.split(' ');
    const targetHour = parseInt(cronHour);
    const targetMin = parseInt(cronMin.replace('*/', ''));

    if (cronHour === '*' || Math.abs(hour - targetHour) <= 1) {
      if (cronMin.startsWith('*/')) return true; // recurring
      const targetMinute = parseInt(cronMin);
      const minutesDiff = (hour * 60 + minute) - (targetHour * 60 + targetMinute);
      return minutesDiff >= -event.preEventMinutes && minutesDiff <= 10;
    }
    return false;
  });
}
