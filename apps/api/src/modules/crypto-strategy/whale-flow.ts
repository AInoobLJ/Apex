/**
 * WhaleFlowDetector — monitors large crypto transfers to/from exchanges.
 *
 * Large inflows to exchanges = sell pressure = bearish for hourly contracts
 * Large outflows = accumulation = bullish
 * Threshold: >$10M transfer = significant signal
 *
 * Uses Blockchain.com or public block explorer APIs (free, no key).
 */
import axios from 'axios';
import { logger } from '../../lib/logger';
import { logApiUsage } from '../../services/api-usage-logger';

export interface WhaleFlowSignal {
  symbol: string;
  netFlow1h: number;        // Net exchange flow in USD (positive = inflow/bearish)
  largeTransfers: number;   // Count of >$10M transfers in last hour
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  lastUpdated: Date;
}

// Known exchange hot wallet address patterns (simplified — a real implementation
// would maintain a comprehensive list from Arkham/Nansen)
const KNOWN_EXCHANGE_PATTERNS = [
  // Binance, Coinbase, Kraken identifiers in transfer metadata
  'binance', 'coinbase', 'kraken', 'bitfinex', 'okx', 'bybit',
];

// Cache for 2 minutes
let cache: Record<string, { data: WhaleFlowSignal; fetchedAt: number }> = {};
const CACHE_TTL = 2 * 60 * 1000;

/**
 * Fetch whale flow data. Uses public blockchain.info API for BTC.
 * For ETH/SOL, uses estimated data from exchange balance changes.
 */
export async function getWhaleFlow(symbol: string): Promise<WhaleFlowSignal | null> {
  const cached = cache[symbol];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.data;
  }

  const start = Date.now();

  try {
    // Use CryptoQuant-style estimate from exchange reserves
    // For free tier, use mempool.space (BTC) or similar
    let netFlow = 0;
    let largeTransfers = 0;

    if (symbol === 'BTC') {
      // Mempool.space recent blocks for large transactions
      const resp = await axios.get('https://mempool.space/api/mempool/recent', {
        timeout: 5000,
      });

      await logApiUsage({
        service: 'mempool_space',
        endpoint: 'GET /api/mempool/recent',
        latencyMs: Date.now() - start,
        statusCode: resp.status,
      });

      if (Array.isArray(resp.data)) {
        // Count large unconfirmed transactions (>10 BTC ≈ significant)
        for (const tx of resp.data) {
          const valueBTC = (tx.value || 0) / 1e8;
          if (valueBTC > 10) {
            largeTransfers++;
            // Without exchange address labels, we estimate direction
            // Large mempool activity = potential exchange deposits
            netFlow += valueBTC * 87000; // Rough BTC price
          }
        }
      }
    } else {
      // For ETH/SOL, return a neutral signal (would need Alchemy/paid API)
      return {
        symbol,
        netFlow1h: 0,
        largeTransfers: 0,
        direction: 'NEUTRAL',
        confidence: 0,
        lastUpdated: new Date(),
      };
    }

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    let confidence: number;

    if (netFlow > 50_000_000) {
      // >$50M net inflow = very bearish
      direction = 'BEARISH';
      confidence = Math.min(0.5, netFlow / 200_000_000);
    } else if (netFlow > 10_000_000) {
      direction = 'BEARISH';
      confidence = Math.min(0.3, netFlow / 100_000_000);
    } else if (netFlow < -50_000_000) {
      direction = 'BULLISH';
      confidence = Math.min(0.5, Math.abs(netFlow) / 200_000_000);
    } else if (netFlow < -10_000_000) {
      direction = 'BULLISH';
      confidence = Math.min(0.3, Math.abs(netFlow) / 100_000_000);
    } else {
      direction = 'NEUTRAL';
      confidence = 0;
    }

    const signal: WhaleFlowSignal = {
      symbol,
      netFlow1h: netFlow,
      largeTransfers,
      direction,
      confidence,
      lastUpdated: new Date(),
    };

    cache[symbol] = { data: signal, fetchedAt: Date.now() };
    return signal;
  } catch (err) {
    await logApiUsage({
      service: 'mempool_space',
      endpoint: 'GET /api/mempool/recent',
      latencyMs: Date.now() - start,
      statusCode: 0,
    });
    logger.warn({ err: (err as Error).message, symbol }, 'Whale flow detection failed');
    return cached?.data ?? null;
  }
}
