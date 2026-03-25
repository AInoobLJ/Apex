/**
 * CongressService — tracks bill status via Congress.gov API.
 * Free API, no key required (but rate limited to ~1000 req/hour).
 * Provides bill status for "Will X bill pass?" prediction markets.
 */
import axios from 'axios';
import { logger } from '../../lib/logger';
import { logApiUsage } from '../api-usage-logger';
import { config } from '../../config';

interface BillInfo {
  billId: string;         // e.g., "hr1234-119"
  number: string;         // e.g., "H.R. 1234"
  title: string;
  shortTitle: string;
  sponsor: string;
  sponsorParty: string;
  introducedDate: string;
  latestAction: string;
  latestActionDate: string;
  status: BillStatus;
  committees: string[];
  cosponsors: number;
  bipartisan: boolean;    // Has cosponsors from both parties
  chamber: 'House' | 'Senate';
}

type BillStatus =
  | 'INTRODUCED'
  | 'IN_COMMITTEE'
  | 'PASSED_COMMITTEE'
  | 'PASSED_HOUSE'
  | 'PASSED_SENATE'
  | 'PASSED_BOTH'
  | 'SENT_TO_PRESIDENT'
  | 'SIGNED'
  | 'VETOED'
  | 'FAILED';

// Cache for 6 hours — bills don't change status that often
const billCache: Record<string, { data: BillInfo; fetchedAt: number }> = {};
const CACHE_TTL = 6 * 60 * 60 * 1000;

const API_BASE = 'https://api.congress.gov/v3';

/**
 * Search for bills by keyword.
 */
export async function searchBills(query: string, limit = 10): Promise<BillInfo[]> {
  const apiKey = (config as any).CONGRESS_API_KEY || '';
  const start = Date.now();

  try {
    const params: Record<string, string> = {
      query,
      limit: String(limit),
      sort: 'updateDate+desc',
      format: 'json',
    };
    if (apiKey) params.api_key = apiKey;

    const response = await axios.get(`${API_BASE}/bill`, {
      params,
      timeout: 15000,
      headers: { 'Accept': 'application/json' },
    });

    await logApiUsage({
      service: 'congress_gov',
      endpoint: 'GET /bill (search)',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    const bills: BillInfo[] = [];
    for (const bill of response.data?.bills || []) {
      bills.push(normalizeBill(bill));
    }
    return bills;
  } catch (err) {
    await logApiUsage({
      service: 'congress_gov',
      endpoint: 'GET /bill (search)',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message, query }, 'Congress.gov bill search failed');
    return [];
  }
}

/**
 * Get detailed bill info by Congress number and bill type/number.
 * e.g., getBill(119, 'hr', 1234)
 */
export async function getBill(congress: number, billType: string, billNumber: number): Promise<BillInfo | null> {
  const cacheKey = `${congress}-${billType}-${billNumber}`;
  const cached = billCache[cacheKey];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const apiKey = (config as any).CONGRESS_API_KEY || '';
  const start = Date.now();

  try {
    const params: Record<string, string> = { format: 'json' };
    if (apiKey) params.api_key = apiKey;

    const response = await axios.get(
      `${API_BASE}/bill/${congress}/${billType}/${billNumber}`,
      { params, timeout: 15000, headers: { 'Accept': 'application/json' } }
    );

    await logApiUsage({
      service: 'congress_gov',
      endpoint: `GET /bill/${congress}/${billType}/${billNumber}`,
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    const bill = normalizeBill(response.data?.bill);
    billCache[cacheKey] = { data: bill, fetchedAt: Date.now() };
    return bill;
  } catch (err) {
    await logApiUsage({
      service: 'congress_gov',
      endpoint: `GET /bill/${congress}/${billType}/${billNumber}`,
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message }, 'Congress.gov bill fetch failed');
    return null;
  }
}

/**
 * Get recent legislative activity (bills with recent actions).
 */
export async function getRecentActivity(limit = 20): Promise<BillInfo[]> {
  const apiKey = (config as any).CONGRESS_API_KEY || '';
  const start = Date.now();

  try {
    const params: Record<string, string> = {
      limit: String(limit),
      sort: 'updateDate+desc',
      format: 'json',
    };
    if (apiKey) params.api_key = apiKey;

    const response = await axios.get(`${API_BASE}/bill`, {
      params,
      timeout: 15000,
      headers: { 'Accept': 'application/json' },
    });

    await logApiUsage({
      service: 'congress_gov',
      endpoint: 'GET /bill (recent)',
      latencyMs: Date.now() - start,
      statusCode: response.status,
    });

    return (response.data?.bills || []).map(normalizeBill);
  } catch (err) {
    await logApiUsage({
      service: 'congress_gov',
      endpoint: 'GET /bill (recent)',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message }, 'Congress.gov recent activity failed');
    return [];
  }
}

function normalizeBill(raw: any): BillInfo {
  const latestAction = raw.latestAction || {};
  const status = inferBillStatus(latestAction.text || '', raw);

  return {
    billId: `${raw.type || 'hr'}${raw.number || '0'}-${raw.congress || 119}`,
    number: `${(raw.type || 'H.R.').toUpperCase()} ${raw.number || ''}`,
    title: raw.title || 'Unknown',
    shortTitle: (raw.title || '').slice(0, 100),
    sponsor: raw.sponsors?.[0]?.fullName || raw.sponsor?.fullName || 'Unknown',
    sponsorParty: raw.sponsors?.[0]?.party || raw.sponsor?.party || 'Unknown',
    introducedDate: raw.introducedDate || '',
    latestAction: latestAction.text || '',
    latestActionDate: latestAction.actionDate || '',
    status,
    committees: (raw.committees?.committees || []).map((c: any) => c.name || c),
    cosponsors: raw.cosponsors?.count || 0,
    bipartisan: false, // Would need cosponsors detail to determine
    chamber: (raw.type || '').toLowerCase().startsWith('s') ? 'Senate' : 'House',
  };
}

function inferBillStatus(actionText: string, raw: any): BillStatus {
  const text = actionText.toLowerCase();
  if (text.includes('signed by president') || text.includes('became public law')) return 'SIGNED';
  if (text.includes('vetoed')) return 'VETOED';
  if (text.includes('sent to president') || text.includes('presented to president')) return 'SENT_TO_PRESIDENT';
  if (text.includes('passed senate') && text.includes('passed house')) return 'PASSED_BOTH';
  if (text.includes('passed senate') || text.includes('agreed to in senate')) return 'PASSED_SENATE';
  if (text.includes('passed house') || text.includes('agreed to in house')) return 'PASSED_HOUSE';
  if (text.includes('reported') || text.includes('ordered to be reported')) return 'PASSED_COMMITTEE';
  if (text.includes('referred to') || text.includes('committee')) return 'IN_COMMITTEE';
  return 'INTRODUCED';
}

/**
 * Format bill data for injection into GEO-INTEL agent prompt.
 */
export function formatCongressContext(bills: BillInfo[]): string {
  if (bills.length === 0) return '';

  const lines = ['## Recent Congressional Activity'];
  for (const b of bills.slice(0, 8)) {
    lines.push(`- **${b.number}**: ${b.shortTitle}`);
    lines.push(`  Status: ${b.status} | Sponsor: ${b.sponsor} (${b.sponsorParty}) | Cosponsors: ${b.cosponsors}`);
    lines.push(`  Latest: ${b.latestAction} (${b.latestActionDate})`);
  }
  return lines.join('\n');
}

/**
 * Estimate bill passage probability based on status.
 * Historical base rates for bills at each stage.
 */
export function estimatePassageProbability(status: BillStatus, cosponsors: number, bipartisan: boolean): number {
  const baseRates: Record<BillStatus, number> = {
    INTRODUCED: 0.03,       // ~3% of introduced bills pass
    IN_COMMITTEE: 0.08,
    PASSED_COMMITTEE: 0.25,
    PASSED_HOUSE: 0.45,
    PASSED_SENATE: 0.50,
    PASSED_BOTH: 0.85,
    SENT_TO_PRESIDENT: 0.90,
    SIGNED: 1.0,
    VETOED: 0.10,           // Can be overridden
    FAILED: 0.01,
  };

  let prob = baseRates[status] || 0.03;

  // Bipartisan bills pass at ~2x the rate
  if (bipartisan) prob = Math.min(0.95, prob * 1.5);

  // High cosponsor count is a strong signal
  if (cosponsors > 100) prob = Math.min(0.95, prob * 1.3);
  else if (cosponsors > 50) prob = Math.min(0.95, prob * 1.15);

  return prob;
}
