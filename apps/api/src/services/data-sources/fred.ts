import axios from 'axios';
import { logger } from '../../lib/logger';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_API_KEY = process.env.FRED_API_KEY || '';

// Series we track for FED-HAWK
const FRED_SERIES = {
  CPIAUCSL: { name: 'CPI (All Urban Consumers)', unit: 'index' },
  PCEPI: { name: 'PCE Price Index', unit: 'index' },
  UNRATE: { name: 'Unemployment Rate', unit: '%' },
  FEDFUNDS: { name: 'Fed Funds Rate', unit: '%' },
  DGS10: { name: '10-Year Treasury Yield', unit: '%' },
  GDP: { name: 'GDP (Annualized)', unit: 'billions $' },
} as const;

type FredSeriesId = keyof typeof FRED_SERIES;

interface FredObservation {
  date: string;
  value: string;
}

interface FredDataPoint {
  seriesId: string;
  name: string;
  unit: string;
  latestValue: number;
  latestDate: string;
  previousValue: number;
  previousDate: string;
  change: number;
  changePercent: number;
}

// ── Cache ──
const cache: Map<string, { data: FredDataPoint; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch latest observation for a FRED series.
 */
async function fetchSeries(seriesId: FredSeriesId): Promise<FredDataPoint | null> {
  // Check cache
  const cached = cache.get(seriesId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    if (!FRED_API_KEY) {
      logger.debug('FRED_API_KEY not set, skipping FRED fetch');
      return null;
    }

    const params: Record<string, string> = {
      series_id: seriesId,
      sort_order: 'desc',
      limit: '5',
      file_type: 'json',
      api_key: FRED_API_KEY,
    };

    const response = await axios.get(FRED_BASE, { params, timeout: 10000 });
    const observations: FredObservation[] = response.data.observations || [];

    // Filter out "." (missing) values
    const valid = observations.filter(o => o.value !== '.');
    if (valid.length < 2) return null;

    const latest = valid[0];
    const previous = valid[1];
    const latestVal = parseFloat(latest.value);
    const prevVal = parseFloat(previous.value);

    const meta = FRED_SERIES[seriesId];
    const dataPoint: FredDataPoint = {
      seriesId,
      name: meta.name,
      unit: meta.unit,
      latestValue: latestVal,
      latestDate: latest.date,
      previousValue: prevVal,
      previousDate: previous.date,
      change: latestVal - prevVal,
      changePercent: prevVal !== 0 ? ((latestVal - prevVal) / prevVal) * 100 : 0,
    };

    cache.set(seriesId, { data: dataPoint, fetchedAt: Date.now() });
    return dataPoint;
  } catch (err) {
    logger.error({ err, seriesId }, 'FRED API fetch failed');
    // Return stale cache if available
    return cached?.data ?? null;
  }
}

/**
 * Fetch all tracked FRED series. Returns formatted context for LLM injection.
 */
export async function getFredData(): Promise<FredDataPoint[]> {
  const seriesIds = Object.keys(FRED_SERIES) as FredSeriesId[];
  const results = await Promise.all(seriesIds.map(id => fetchSeries(id)));
  return results.filter((r): r is FredDataPoint => r !== null);
}

/**
 * Format FRED data as a text block for LLM prompt injection.
 */
export function formatFredContext(data: FredDataPoint[]): string {
  if (data.length === 0) return '';

  const lines = data.map(d => {
    const changeDir = d.change >= 0 ? '+' : '';
    return `- ${d.name}: ${d.latestValue.toFixed(2)}${d.unit === '%' ? '%' : ''} (as of ${d.latestDate}, ${changeDir}${d.change.toFixed(2)} from ${d.previousDate})`;
  });

  return [
    '## Current Economic Data (FRED)',
    ...lines,
  ].join('\n');
}
