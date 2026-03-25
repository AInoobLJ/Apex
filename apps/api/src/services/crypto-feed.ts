import axios from 'axios';
import { logger } from '../lib/logger';
import { binanceWs } from './data-sources/binance-ws';

interface CryptoPrice {
  symbol: string;
  price: number;
  timestamp: number;
  source?: 'binance_ws' | 'coingecko';
}

const cache: Map<string, CryptoPrice> = new Map();

/**
 * Fetch current crypto price — prefers Binance WebSocket (ms latency),
 * falls back to CoinGecko (30s cache) if WS is disconnected.
 */
export async function getCryptoPrice(symbol: 'BTC' | 'ETH' | 'SOL'): Promise<CryptoPrice | null> {
  // Try Binance WebSocket first (millisecond latency)
  if (binanceWs.isConnected()) {
    const wsPrices = binanceWs.getAllPrices();
    if (wsPrices[symbol] && Date.now() - wsPrices[symbol].timestamp < 10_000) {
      const data: CryptoPrice = {
        symbol,
        price: wsPrices[symbol].price,
        timestamp: wsPrices[symbol].timestamp,
        source: 'binance_ws',
      };
      cache.set(symbol, data);
      return data;
    }
  }

  // Fallback: CoinGecko (30s cache)
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.timestamp < 30000) return cached;

  const coinMap: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' };
  const coinId = coinMap[symbol];

  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
      params: { ids: coinId, vs_currencies: 'usd' },
      timeout: 5000,
    });

    const price = response.data[coinId]?.usd;
    if (price) {
      const data: CryptoPrice = { symbol, price, timestamp: Date.now(), source: 'coingecko' };
      cache.set(symbol, data);
      return data;
    }
    return cached ?? null;
  } catch {
    return cached ?? null;
  }
}

/**
 * Get all tracked crypto prices.
 */
export async function getAllCryptoPrices(): Promise<CryptoPrice[]> {
  const symbols: ('BTC' | 'ETH' | 'SOL')[] = ['BTC', 'ETH', 'SOL'];
  const results = await Promise.all(symbols.map(getCryptoPrice));
  return results.filter((r): r is CryptoPrice => r !== null);
}
