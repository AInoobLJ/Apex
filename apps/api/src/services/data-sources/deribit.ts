/**
 * DeribitProvider — implied volatility data from Deribit (crypto's VIX).
 * No API key required for public market data.
 *
 * Provides:
 * - DVOL index (30-day forward-looking implied vol for BTC and ETH)
 * - Option book summary (mark_iv, open_interest, volume for all active options)
 * - Historical realized vol (for IV/RV comparison)
 * - ATM implied vol interpolation by time-to-expiry
 *
 * SOL has no options on Deribit — uses BTC DVOL × 1.8 beta proxy.
 */
import Bottleneck from 'bottleneck';
import { logger } from '../../lib/logger';

const BASE_URL = 'https://www.deribit.com/api/v2';

// ── Types ──

export interface DVOLData {
  currency: string;
  dvol: number;              // Current DVOL level (annualized IV %)
  expectedDailyMove: number; // dvol / sqrt(365) as percentage
  timestamp: number;
}

export interface OptionSummary {
  instrumentName: string;
  markIv: number;            // Mark implied volatility (%)
  bidIv: number | null;
  askIv: number | null;
  underlyingPrice: number;
  markPrice: number;
  volume24h: number;
  openInterest: number;
  strike: number;
  expiry: string;            // e.g., "28MAR26"
  type: 'call' | 'put';
  delta: number | null;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// ── Cache TTLs ──
const DVOL_TTL_MS = 60_000;          // 1 minute
const BOOK_SUMMARY_TTL_MS = 300_000; // 5 minutes
const HIST_VOL_TTL_MS = 3600_000;    // 1 hour

// SOL beta to BTC (SOL typically 1.5-2x BTC vol)
const SOL_BTC_VOL_BETA = 1.8;

class DeribitProvider {
  private limiter: Bottleneck;

  // Caches
  private dvolCache: Record<string, CacheEntry<DVOLData>> = {};
  private bookSummaryCache: Record<string, CacheEntry<OptionSummary[]>> = {};
  private histVolCache: Record<string, CacheEntry<number>> = {};

  private lastSuccessAt = 0;
  private consecutiveFailures = 0;
  private solProxyWarningLogged = false;

  constructor() {
    // Deribit allows 20 req/s unauthenticated — use 10 for safety
    this.limiter = new Bottleneck({
      reservoir: 10,
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 3,
    });
  }

  // ── DVOL Index ──

  async getDVOL(currency: 'BTC' | 'ETH' | 'SOL'): Promise<DVOLData | null> {
    if (currency === 'SOL') {
      return this.getSOLDvolProxy();
    }

    const cached = this.dvolCache[currency];
    if (cached && Date.now() - cached.fetchedAt < DVOL_TTL_MS) {
      return cached.data;
    }

    try {
      const instrument = `${currency}_USD`;  // Deribit DVOL instrument format
      const res = await this.limiter.schedule(() =>
        fetch(`${BASE_URL}/public/get_volatility_index_data?currency=${currency}&resolution=60&start_timestamp=${Date.now() - 300000}&end_timestamp=${Date.now()}`)
      );

      if (!res.ok) throw new Error(`Deribit DVOL ${res.status}`);
      const json = await res.json();

      // DVOL data comes as array of [timestamp, open, high, low, close]
      const data = json?.result?.data;
      if (!data || data.length === 0) {
        // Fallback: try ticker endpoint
        return this.getDvolFromTicker(currency);
      }

      const latest = data[data.length - 1];
      const dvol = latest[4]; // close value

      const dvolData: DVOLData = {
        currency,
        dvol,
        expectedDailyMove: dvol / Math.sqrt(365),
        timestamp: latest[0],
      };

      this.dvolCache[currency] = { data: dvolData, fetchedAt: Date.now() };
      this.lastSuccessAt = Date.now();
      this.consecutiveFailures = 0;
      return dvolData;
    } catch (err: any) {
      this.consecutiveFailures++;
      logger.warn({ err: err.message, currency }, '[DERIBIT] DVOL fetch failed');

      // Return cached data if available
      if (cached) return cached.data;
      // Try ticker fallback
      return this.getDvolFromTicker(currency);
    }
  }

  private async getDvolFromTicker(currency: 'BTC' | 'ETH'): Promise<DVOLData | null> {
    try {
      const instrument = `${currency}-DVOL`;
      const res = await this.limiter.schedule(() =>
        fetch(`${BASE_URL}/public/ticker?instrument_name=${instrument}`)
      );

      if (!res.ok) return this.dvolCache[currency]?.data ?? null;
      const json = await res.json();
      const result = json?.result;
      if (!result) return this.dvolCache[currency]?.data ?? null;

      const dvol = result.last_price ?? result.mark_price ?? 0;
      if (dvol <= 0) return this.dvolCache[currency]?.data ?? null;

      const dvolData: DVOLData = {
        currency,
        dvol,
        expectedDailyMove: dvol / Math.sqrt(365),
        timestamp: result.timestamp ?? Date.now(),
      };

      this.dvolCache[currency] = { data: dvolData, fetchedAt: Date.now() };
      this.lastSuccessAt = Date.now();
      this.consecutiveFailures = 0;
      return dvolData;
    } catch (err: any) {
      logger.debug({ err: err.message, currency }, '[DERIBIT] DVOL ticker fallback failed');
      return this.dvolCache[currency]?.data ?? null;
    }
  }

  private async getSOLDvolProxy(): Promise<DVOLData | null> {
    const btcDvol = await this.getDVOL('BTC');
    if (!btcDvol) return null;

    if (!this.solProxyWarningLogged) {
      logger.info({ beta: SOL_BTC_VOL_BETA, btcDvol: btcDvol.dvol },
        `[DERIBIT] SOL: using BTC DVOL × ${SOL_BTC_VOL_BETA} beta proxy (no SOL options on Deribit)`);
      this.solProxyWarningLogged = true;
    }

    const solDvol = btcDvol.dvol * SOL_BTC_VOL_BETA;
    return {
      currency: 'SOL',
      dvol: solDvol,
      expectedDailyMove: solDvol / Math.sqrt(365),
      timestamp: btcDvol.timestamp,
    };
  }

  // ── Option Book Summary ──

  async getBookSummary(currency: 'BTC' | 'ETH'): Promise<OptionSummary[]> {
    const cached = this.bookSummaryCache[currency];
    if (cached && Date.now() - cached.fetchedAt < BOOK_SUMMARY_TTL_MS) {
      return cached.data;
    }

    try {
      const res = await this.limiter.schedule(() =>
        fetch(`${BASE_URL}/public/get_book_summary_by_currency?currency=${currency}&kind=option`)
      );

      if (!res.ok) throw new Error(`Deribit book summary ${res.status}`);
      const json = await res.json();
      const results = json?.result;
      if (!Array.isArray(results)) return cached?.data ?? [];

      const summaries: OptionSummary[] = results
        .filter((r: any) => r.mark_iv > 0)
        .map((r: any) => {
          // Parse instrument name: BTC-28MAR26-85000-C
          const parts = r.instrument_name.split('-');
          return {
            instrumentName: r.instrument_name,
            markIv: r.mark_iv,
            bidIv: r.bid_iv ?? null,
            askIv: r.ask_iv ?? null,
            underlyingPrice: r.underlying_price,
            markPrice: r.mark_price,
            volume24h: r.volume ?? 0,
            openInterest: r.open_interest ?? 0,
            strike: parseFloat(parts[2] || '0'),
            expiry: parts[1] || '',
            type: (parts[3] || '').toLowerCase() === 'p' ? 'put' : 'call',
            delta: null, // Not in book summary
          };
        });

      this.bookSummaryCache[currency] = { data: summaries, fetchedAt: Date.now() };
      this.lastSuccessAt = Date.now();
      this.consecutiveFailures = 0;

      logger.debug({ currency, options: summaries.length }, '[DERIBIT] Book summary fetched');
      return summaries;
    } catch (err: any) {
      this.consecutiveFailures++;
      logger.warn({ err: err.message, currency }, '[DERIBIT] Book summary fetch failed');
      return cached?.data ?? [];
    }
  }

  // ── ATM Implied Vol (interpolated from book summary) ──

  async getATMImpliedVol(currency: 'BTC' | 'ETH', hoursToExpiry: number): Promise<number | null> {
    const summary = await this.getBookSummary(currency);
    if (summary.length === 0) return null;

    const underlyingPrice = summary[0]?.underlyingPrice;
    if (!underlyingPrice) return null;

    // Find options with expiry closest to requested hoursToExpiry
    // Group by expiry, find ATM strike (closest to underlying)
    const byExpiry: Record<string, OptionSummary[]> = {};
    for (const opt of summary) {
      if (!byExpiry[opt.expiry]) byExpiry[opt.expiry] = [];
      byExpiry[opt.expiry].push(opt);
    }

    // For each expiry, find ATM call IV
    const expiryVols: { daysToExpiry: number; atmIv: number }[] = [];
    for (const [expiry, options] of Object.entries(byExpiry)) {
      const calls = options.filter(o => o.type === 'call' && o.markIv > 0);
      if (calls.length === 0) continue;

      // Find call closest to ATM
      const atm = calls.reduce((best, opt) =>
        Math.abs(opt.strike - underlyingPrice) < Math.abs(best.strike - underlyingPrice) ? opt : best
      );

      // Estimate days to expiry from expiry string (rough)
      const daysToExpiry = this.estimateDaysToExpiry(expiry);
      if (daysToExpiry > 0) {
        expiryVols.push({ daysToExpiry, atmIv: atm.markIv });
      }
    }

    if (expiryVols.length === 0) return null;

    // Interpolate: find two expiries bracketing the requested hours
    const targetDays = hoursToExpiry / 24;
    expiryVols.sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    // If before first expiry, use first
    if (targetDays <= expiryVols[0].daysToExpiry) return expiryVols[0].atmIv;
    // If after last, use last
    if (targetDays >= expiryVols[expiryVols.length - 1].daysToExpiry) return expiryVols[expiryVols.length - 1].atmIv;

    // Linear interpolation between bracketing expiries
    for (let i = 0; i < expiryVols.length - 1; i++) {
      if (targetDays >= expiryVols[i].daysToExpiry && targetDays <= expiryVols[i + 1].daysToExpiry) {
        const range = expiryVols[i + 1].daysToExpiry - expiryVols[i].daysToExpiry;
        const frac = (targetDays - expiryVols[i].daysToExpiry) / range;
        return expiryVols[i].atmIv + frac * (expiryVols[i + 1].atmIv - expiryVols[i].atmIv);
      }
    }

    return expiryVols[0].atmIv;
  }

  // ── Historical Volatility ──

  async getHistoricalVol(currency: 'BTC' | 'ETH'): Promise<number | null> {
    const cached = this.histVolCache[currency];
    if (cached && Date.now() - cached.fetchedAt < HIST_VOL_TTL_MS) {
      return cached.data;
    }

    try {
      const res = await this.limiter.schedule(() =>
        fetch(`${BASE_URL}/public/get_historical_volatility?currency=${currency}`)
      );

      if (!res.ok) throw new Error(`Deribit hist vol ${res.status}`);
      const json = await res.json();
      const data = json?.result;
      if (!Array.isArray(data) || data.length === 0) return cached?.data ?? null;

      // Returns array of [timestamp, vol]. Take most recent.
      const latest = data[data.length - 1];
      const vol = latest[1]; // annualized realized vol (%)

      this.histVolCache[currency] = { data: vol, fetchedAt: Date.now() };
      this.lastSuccessAt = Date.now();
      return vol;
    } catch (err: any) {
      logger.warn({ err: err.message, currency }, '[DERIBIT] Historical vol fetch failed');
      return cached?.data ?? null;
    }
  }

  // ── Health / Status ──

  getStatus(): {
    healthy: boolean;
    lastSuccessAt: string | null;
    consecutiveFailures: number;
    btcDvol: number | null;
    ethDvol: number | null;
  } {
    return {
      healthy: this.consecutiveFailures < 5 && this.lastSuccessAt > 0,
      lastSuccessAt: this.lastSuccessAt > 0 ? new Date(this.lastSuccessAt).toISOString() : null,
      consecutiveFailures: this.consecutiveFailures,
      btcDvol: this.dvolCache['BTC']?.data?.dvol ?? null,
      ethDvol: this.dvolCache['ETH']?.data?.dvol ?? null,
    };
  }

  // ── Helpers ──

  private estimateDaysToExpiry(expiryStr: string): number {
    // Parse Deribit expiry format: "28MAR26" → days from now
    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };
    const match = expiryStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
    if (!match) return 30; // fallback

    const day = parseInt(match[1]);
    const month = months[match[2]];
    const year = 2000 + parseInt(match[3]);
    if (month === undefined) return 30;

    const expiryDate = new Date(year, month, day);
    const days = (expiryDate.getTime() - Date.now()) / 86400000;
    return Math.max(0, days);
  }

  /**
   * Initialize: fetch DVOL for BTC and ETH, log on startup.
   */
  async init(): Promise<void> {
    const [btc, eth] = await Promise.all([
      this.getDVOL('BTC'),
      this.getDVOL('ETH'),
    ]);

    if (btc || eth) {
      logger.info({
        btcDvol: btc?.dvol?.toFixed(1) ?? 'N/A',
        ethDvol: eth?.dvol?.toFixed(1) ?? 'N/A',
        btcDailyMove: btc ? `±${btc.expectedDailyMove.toFixed(1)}%` : 'N/A',
        ethDailyMove: eth ? `±${eth.expectedDailyMove.toFixed(1)}%` : 'N/A',
      }, '[DERIBIT] Connected — implied volatility data loaded');
    } else {
      logger.warn('[DERIBIT] Failed to fetch initial DVOL data — will retry on next request');
    }
  }
}

export const deribit = new DeribitProvider();
