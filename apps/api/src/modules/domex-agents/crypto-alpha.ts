import { createDomexAgent } from './base-agent';
import { logger } from '../../lib/logger';

/**
 * Context provider that injects live crypto market data from existing services.
 */
async function getCryptoContext(title: string): Promise<{ context: string; freshness: 'live' | 'cached' | 'stale' | 'none'; sources: string[] }> {
  const sources: string[] = [];
  const parts: string[] = [];

  try {
    // Import Binance WS service for live prices
    const { getLatestPrices } = require('../../services/data-sources/binance-ws');
    const prices = getLatestPrices();

    if (prices && Object.keys(prices).length > 0) {
      parts.push('## Live Crypto Prices (Binance)');
      for (const [symbol, data] of Object.entries(prices) as [string, any][]) {
        if (data && data.price) {
          parts.push(`- ${symbol}: $${Number(data.price).toLocaleString()} (24h change: ${data.change24h ? `${(data.change24h * 100).toFixed(2)}%` : 'N/A'}, volume: ${data.volume24h ? `$${Number(data.volume24h).toLocaleString()}` : 'N/A'})`);
        }
      }
      sources.push('Binance WebSocket');
    }
  } catch {
    // Binance WS not available
  }

  try {
    // Try to get funding rates if available
    const { getFundingRates } = require('../../services/data-sources/binance-ws');
    const rates = getFundingRates?.();
    if (rates && Object.keys(rates).length > 0) {
      parts.push('## Perpetual Futures Funding Rates');
      for (const [symbol, rate] of Object.entries(rates) as [string, any][]) {
        if (rate !== undefined) {
          parts.push(`- ${symbol}: ${(Number(rate) * 100).toFixed(4)}% (annualized: ${(Number(rate) * 100 * 365 * 3).toFixed(1)}%)`);
        }
      }
      sources.push('Binance Funding Rates');
    }
  } catch {
    // Funding rates not available
  }

  return {
    context: parts.join('\n'),
    freshness: sources.length > 0 ? 'live' as const : 'none' as const,
    sources,
  };
}

export const cryptoAlphaAgent = createDomexAgent({
  name: 'CRYPTO-ALPHA',
  promptFile: 'domex-crypto-alpha.md',
  categories: ['CRYPTO'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: getCryptoContext,
});
