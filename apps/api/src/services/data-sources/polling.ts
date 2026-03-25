/**
 * PollingService — fetches political polling data from RealClearPolitics RSS.
 * Provides polling averages for injection into GEO-INTEL agent context.
 * Compares polling-implied probabilities vs prediction market prices.
 */
import axios from 'axios';
import { logger } from '../../lib/logger';
import { logApiUsage } from '../api-usage-logger';

interface PollAverage {
  race: string;          // e.g., "2026 Generic Ballot", "Trump Approval"
  candidate1: string;
  candidate2: string;
  candidate1Avg: number;
  candidate2Avg: number;
  spread: number;        // candidate1 - candidate2
  lastUpdated: string;
}

interface ApprovalRating {
  subject: string;       // e.g., "President Trump"
  approve: number;
  disapprove: number;
  spread: number;
  lastUpdated: string;
}

interface PollingData {
  polls: PollAverage[];
  approvals: ApprovalRating[];
  fetchedAt: Date;
}

// Cache for 4 hours — polls update daily at most
let pollingCache: PollingData | null = null;
let lastFetch = 0;
const CACHE_TTL = 4 * 60 * 60 * 1000;

/**
 * Fetch polling data from RealClearPolitics RSS feed.
 */
export async function getPollingData(): Promise<PollingData> {
  if (pollingCache && Date.now() - lastFetch < CACHE_TTL) {
    return pollingCache;
  }

  const start = Date.now();
  const polls: PollAverage[] = [];
  const approvals: ApprovalRating[] = [];

  // Fetch RCP RSS feed for latest polls
  try {
    const response = await axios.get(
      'https://www.realclearpolling.com/api/polls/latest',
      {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          'Accept': 'application/json',
        },
      }
    );

    await logApiUsage({
      service: 'realclearpolling',
      endpoint: 'GET /api/polls/latest',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    if (response.data && Array.isArray(response.data)) {
      for (const poll of response.data.slice(0, 20)) {
        polls.push({
          race: poll.race || poll.title || 'Unknown',
          candidate1: poll.candidate1 || '',
          candidate2: poll.candidate2 || '',
          candidate1Avg: parseFloat(poll.candidate1Avg || '0'),
          candidate2Avg: parseFloat(poll.candidate2Avg || '0'),
          spread: parseFloat(poll.spread || '0'),
          lastUpdated: poll.date || new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    await logApiUsage({
      service: 'realclearpolling',
      endpoint: 'GET /api/polls/latest',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message }, 'RealClearPolling fetch failed — using fallback');
  }

  // Fallback: try FiveThirtyEight / 538 public data
  if (polls.length === 0) {
    try {
      const resp = await axios.get(
        'https://projects.fivethirtyeight.com/polls/president-approval/polls.json',
        { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );

      if (Array.isArray(resp.data)) {
        // Extract latest approval ratings
        const latestApproval = resp.data[0];
        if (latestApproval) {
          approvals.push({
            subject: 'President',
            approve: latestApproval.yes || latestApproval.approve || 0,
            disapprove: latestApproval.no || latestApproval.disapprove || 0,
            spread: (latestApproval.yes || 0) - (latestApproval.no || 0),
            lastUpdated: latestApproval.date || new Date().toISOString(),
          });
        }
      }
    } catch {
      // Both sources failed — return empty with timestamp
      logger.warn('Both RCP and 538 polling sources unavailable');
    }
  }

  pollingCache = { polls, approvals, fetchedAt: new Date() };
  lastFetch = Date.now();
  return pollingCache;
}

/**
 * Format polling data for injection into GEO-INTEL agent prompt.
 */
export function formatPollingContext(data: PollingData): string {
  if (data.polls.length === 0 && data.approvals.length === 0) {
    return '## Polling Data\nNo current polling data available.';
  }

  const lines = ['## Current Polling Data'];
  lines.push(`Last updated: ${data.fetchedAt.toISOString().split('T')[0]}`);
  lines.push('');

  if (data.approvals.length > 0) {
    lines.push('### Approval Ratings');
    for (const a of data.approvals) {
      lines.push(`- ${a.subject}: Approve ${a.approve.toFixed(1)}% / Disapprove ${a.disapprove.toFixed(1)}% (spread: ${a.spread >= 0 ? '+' : ''}${a.spread.toFixed(1)})`);
    }
    lines.push('');
  }

  if (data.polls.length > 0) {
    lines.push('### Poll Averages');
    for (const p of data.polls.slice(0, 10)) {
      lines.push(`- ${p.race}: ${p.candidate1} ${p.candidate1Avg.toFixed(1)}% vs ${p.candidate2} ${p.candidate2Avg.toFixed(1)}% (${p.spread >= 0 ? '+' : ''}${p.spread.toFixed(1)} ${p.candidate1})`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert polling spread to implied win probability using historical calibration.
 * Based on research: ~80% of candidates leading by 5+ points win.
 */
export function spreadToWinProbability(spreadPoints: number): number {
  // Logistic regression approximation: P(win) = 1 / (1 + exp(-0.3 * spread))
  const prob = 1 / (1 + Math.exp(-0.3 * spreadPoints));
  return Math.max(0.05, Math.min(0.95, prob));
}
