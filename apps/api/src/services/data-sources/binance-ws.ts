/**
 * BinanceWebSocketService — real-time crypto price feed via Binance public WebSocket.
 * No API key required. Provides millisecond-latency prices for SPEEDEX.
 * Falls back to CoinGecko (30s cache) if WebSocket disconnects.
 */
import WebSocket from 'ws';
import { logger } from '../../lib/logger';
import { getCryptoPrices } from '../crypto-price';

interface TradeUpdate {
  symbol: string;   // 'BTC', 'ETH', 'SOL'
  price: number;
  timestamp: number; // ms
  volume: number;    // trade size in base asset
}

interface PriceState {
  price: number;
  timestamp: number;
  change1m: number;    // % change over last 60 seconds
  volume1m: number;    // volume in last 60 seconds
  tradeCount1m: number;
}

const STREAMS: Record<string, string> = {
  btcusdt: 'BTC',
  ethusdt: 'ETH',
  solusdt: 'SOL',
};

// Rolling 60-second price window for change calculation
const PRICE_WINDOW_MS = 60_000;

class BinanceWebSocketService {
  private ws: WebSocket | null = null;
  private prices: Record<string, PriceState> = {};
  private recentTrades: Record<string, { price: number; ts: number; vol: number }[]> = {};
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastMessageAt = 0;
  private connectionAttempts = 0;
  private enabled = false;

  /** Start the WebSocket connection */
  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();

    // Health check every 30s — reconnect if no messages for 60s
    setInterval(() => {
      if (this.connected && Date.now() - this.lastMessageAt > 60_000) {
        logger.warn('Binance WS stale — reconnecting');
        this.reconnect();
      }
    }, 30_000);
  }

  stop() {
    this.enabled = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
  }

  private connect() {
    const streams = Object.keys(STREAMS).map(s => `${s}@trade`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      logger.error(err, 'Binance WS connection failed');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.connectionAttempts = 0;
      logger.info('Binance WebSocket connected — real-time crypto prices active');
    });

    this.ws.on('message', (data: Buffer) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        if (msg.data && msg.data.e === 'trade') {
          this.handleTrade(msg.data);
        }
      } catch { /* skip parse errors */ }
    });

    this.ws.on('close', () => {
      this.connected = false;
      logger.warn('Binance WebSocket disconnected');
      if (this.enabled) this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, 'Binance WebSocket error');
    });
  }

  private handleTrade(trade: { s: string; p: string; q: string; T: number }) {
    const streamKey = trade.s.toLowerCase();
    const symbol = STREAMS[streamKey];
    if (!symbol) return;

    const price = parseFloat(trade.p);
    const volume = parseFloat(trade.q);
    const ts = trade.T;

    // Add to rolling window
    if (!this.recentTrades[symbol]) this.recentTrades[symbol] = [];
    this.recentTrades[symbol].push({ price, ts, vol: volume });

    // Prune old trades outside window
    const cutoff = ts - PRICE_WINDOW_MS;
    this.recentTrades[symbol] = this.recentTrades[symbol].filter(t => t.ts >= cutoff);

    const trades = this.recentTrades[symbol];
    const oldestInWindow = trades[0];
    const change1m = oldestInWindow ? ((price - oldestInWindow.price) / oldestInWindow.price) * 100 : 0;
    const volume1m = trades.reduce((s, t) => s + t.vol * t.price, 0); // USD volume
    const tradeCount1m = trades.length;

    this.prices[symbol] = {
      price,
      timestamp: ts,
      change1m,
      volume1m,
      tradeCount1m,
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.connectionAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30_000);
    logger.info({ delay, attempt: this.connectionAttempts }, 'Binance WS reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private reconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
    this.connect();
  }

  /** Get real-time price, falling back to CoinGecko if WS is down */
  async getPrice(symbol: string): Promise<{ price: number; source: 'binance_ws' | 'coingecko'; latencyMs: number; change1m?: number }> {
    const wsPrice = this.prices[symbol];
    if (wsPrice && Date.now() - wsPrice.timestamp < 10_000) {
      return {
        price: wsPrice.price,
        source: 'binance_ws',
        latencyMs: Date.now() - wsPrice.timestamp,
        change1m: wsPrice.change1m,
      };
    }

    // Fallback to CoinGecko
    const cgPrices = await getCryptoPrices();
    const cg = cgPrices[symbol];
    if (cg) {
      return { price: cg.price, source: 'coingecko', latencyMs: 30_000 };
    }

    throw new Error(`No price available for ${symbol}`);
  }

  /** Get all current prices */
  getAllPrices(): Record<string, PriceState> {
    return { ...this.prices };
  }

  /** Health status for System Monitor */
  getStatus(): { connected: boolean; lastMessageAt: number; symbols: string[]; latencyMs: number } {
    return {
      connected: this.connected,
      lastMessageAt: this.lastMessageAt,
      symbols: Object.keys(this.prices),
      latencyMs: this.lastMessageAt > 0 ? Date.now() - this.lastMessageAt : -1,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const binanceWs = new BinanceWebSocketService();
