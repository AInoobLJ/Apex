/**
 * CryptoWebSocketService — real-time crypto price feed via Coinbase Exchange WebSocket.
 * No API key required. Provides millisecond-latency prices for SPEEDEX.
 * Falls back to Coinbase REST API if WebSocket disconnects.
 *
 * Uses Coinbase Exchange (wss://ws-feed.exchange.coinbase.com) — US-based, no geo-blocking.
 *
 * NOTE: File kept as binance-ws.ts to avoid changing all import paths.
 * The exported singleton is still named `binanceWs` for backward compatibility.
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../../lib/logger';

interface PriceEntry {
  price: number;
  timestamp: number; // ms
}

export interface PriceState {
  price: number;
  timestamp: number;
  change1m: number;    // % change over last 60 seconds
  volume1m: number;    // volume in last 60 seconds (USD)
  tradeCount1m: number;
}

// Coinbase product IDs → APEX symbols
const PRODUCTS: Record<string, string> = {
  'BTC-USD': 'BTC',
  'ETH-USD': 'ETH',
  'SOL-USD': 'SOL',
};

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const REST_URL = 'https://api.exchange.coinbase.com/products';

// Rolling 30-minute price buffer for volatility and movement detection
const PRICE_BUFFER_MS = 30 * 60 * 1000;
// Rolling 60-second window for change calculation
const PRICE_WINDOW_MS = 60_000;
// Stale data threshold — mark unhealthy if no update in 10 seconds
const STALE_THRESHOLD_MS = 10_000;
// Max reconnection attempts before circuit breaker opens
const MAX_RECONNECT_ATTEMPTS = 15;
// Circuit breaker reset time: 5 minutes
const CIRCUIT_BREAKER_RESET_MS = 5 * 60 * 1000;
// Throttle: max one price update per symbol per 200ms (Coinbase sends hundreds/sec for BTC)
const THROTTLE_MS = 200;

class CryptoWebSocketService extends EventEmitter {
  private ws: WebSocket | null = null;
  private prices: Record<string, PriceState> = {};
  private recentTrades: Record<string, { price: number; ts: number; vol: number }[]> = {};
  private priceBuffer: Record<string, PriceEntry[]> = {};
  private reconnectTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastMessageAt = 0;
  private connectionAttempts = 0;
  private enabled = false;
  private circuitOpen = false;
  private circuitOpenedAt = 0;
  private lastEmitTs: Record<string, number> = {};

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.connect();

    this.healthCheckTimer = setInterval(() => {
      if (this.circuitOpen && Date.now() - this.circuitOpenedAt > CIRCUIT_BREAKER_RESET_MS) {
        logger.info('Coinbase WS circuit breaker reset — retrying');
        this.circuitOpen = false;
        this.connectionAttempts = 0;
        this.connect();
        return;
      }

      if (this.connected && Date.now() - this.lastMessageAt > STALE_THRESHOLD_MS) {
        logger.warn('Coinbase WS stale (no data in 10s) — reconnecting');
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
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.connected = false;
  }

  private connect() {
    if (this.circuitOpen) return;

    try {
      this.ws = new WebSocket(WS_URL);
    } catch (err) {
      logger.error(err, 'Coinbase WS connection failed');
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.connectionAttempts = 0;

      // Subscribe to ticker channel for real-time prices
      const subscribe = {
        type: 'subscribe',
        product_ids: Object.keys(PRODUCTS),
        channels: ['ticker'],
      };
      this.ws!.send(JSON.stringify(subscribe));

      const symbols = Object.values(PRODUCTS).join(' ');
      logger.info(`[SPEED] Connected to Coinbase WebSocket, tracking ${symbols}`);
      this.emit('connected');
    });

    this.ws.on('message', (data: Buffer) => {
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ticker' && msg.product_id && msg.price) {
          this.handleTicker(msg);
        }
      } catch { /* skip parse errors */ }
    });

    this.ws.on('close', () => {
      this.connected = false;
      logger.warn('Coinbase WebSocket disconnected');
      this.emit('disconnected');
      if (this.enabled) this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error({ err: err.message }, 'Coinbase WebSocket error');
    });
  }

  private handleTicker(msg: { product_id: string; price: string; last_size?: string; time?: string }) {
    const symbol = PRODUCTS[msg.product_id];
    if (!symbol) return;

    const price = parseFloat(msg.price);
    if (!price || price <= 0) return;
    const volume = parseFloat(msg.last_size || '0');
    const ts = Date.now();

    // Throttle: skip if last emit was < 200ms ago for this symbol
    const lastEmit = this.lastEmitTs[symbol] || 0;
    if (ts - lastEmit < THROTTLE_MS) return;
    this.lastEmitTs[symbol] = ts;

    // Rolling 1-minute trade window
    if (!this.recentTrades[symbol]) this.recentTrades[symbol] = [];
    this.recentTrades[symbol].push({ price, ts, vol: volume });
    const cutoff1m = ts - PRICE_WINDOW_MS;
    this.recentTrades[symbol] = this.recentTrades[symbol].filter(t => t.ts >= cutoff1m);

    // Rolling 30-minute price buffer for volatility
    if (!this.priceBuffer[symbol]) this.priceBuffer[symbol] = [];
    this.priceBuffer[symbol].push({ price, timestamp: ts });
    const cutoff30m = ts - PRICE_BUFFER_MS;
    this.priceBuffer[symbol] = this.priceBuffer[symbol].filter(e => e.timestamp >= cutoff30m);

    const trades = this.recentTrades[symbol];
    const oldestInWindow = trades[0];
    const change1m = oldestInWindow ? ((price - oldestInWindow.price) / oldestInWindow.price) * 100 : 0;
    const volume1m = trades.reduce((s, t) => s + t.vol * t.price, 0);
    const tradeCount1m = trades.length;

    this.prices[symbol] = { price, timestamp: ts, change1m, volume1m, tradeCount1m };

    // Emit price tick for SPEEDEX
    this.emit('price', symbol, price, ts);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.connectionAttempts++;

    if (this.connectionAttempts > MAX_RECONNECT_ATTEMPTS) {
      logger.error({ attempts: this.connectionAttempts }, 'Coinbase WS circuit breaker OPEN — too many reconnect failures');
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30_000);
    logger.info({ delay, attempt: this.connectionAttempts }, 'Coinbase WS reconnecting');
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

  /** Get real-time price, falling back to Coinbase REST if WS is down */
  async getPrice(symbol: string): Promise<{ price: number; source: 'coinbase_ws' | 'coinbase_rest'; latencyMs: number; change1m?: number }> {
    const wsPrice = this.prices[symbol];
    if (wsPrice && Date.now() - wsPrice.timestamp < STALE_THRESHOLD_MS) {
      return {
        price: wsPrice.price,
        source: 'coinbase_ws',
        latencyMs: Date.now() - wsPrice.timestamp,
        change1m: wsPrice.change1m,
      };
    }

    // Fallback to Coinbase REST
    const productId = Object.entries(PRODUCTS).find(([, s]) => s === symbol)?.[0];
    if (productId) {
      try {
        const res = await fetch(`${REST_URL}/${productId}/ticker`);
        if (res.ok) {
          const data = await res.json();
          const price = parseFloat(data.price);
          if (price > 0) return { price, source: 'coinbase_rest', latencyMs: 1000 };
        }
      } catch { /* fall through */ }
    }

    throw new Error(`No price available for ${symbol}`);
  }

  getPriceAt(symbol: string, secondsAgo: number): number | null {
    const buffer = this.priceBuffer[symbol];
    if (!buffer || buffer.length === 0) return null;
    const targetTs = Date.now() - secondsAgo * 1000;
    let closest: PriceEntry | null = null;
    let closestDiff = Infinity;
    for (const entry of buffer) {
      const diff = Math.abs(entry.timestamp - targetTs);
      if (diff < closestDiff) { closestDiff = diff; closest = entry; }
    }
    if (closest && closestDiff < 5000) return closest.price;
    return null;
  }

  getVolatility(symbol: string, minutes: number): number | null {
    const buffer = this.priceBuffer[symbol];
    if (!buffer || buffer.length < 10) return null;
    const cutoff = Date.now() - minutes * 60 * 1000;
    const relevantPrices = buffer.filter(e => e.timestamp >= cutoff);
    if (relevantPrices.length < 5) return null;

    const sampledPrices: number[] = [];
    let lastSampledTs = 0;
    for (const entry of relevantPrices) {
      if (entry.timestamp - lastSampledTs >= 10_000) {
        sampledPrices.push(entry.price);
        lastSampledTs = entry.timestamp;
      }
    }
    if (sampledPrices.length < 3) return null;

    const logReturns: number[] = [];
    for (let i = 1; i < sampledPrices.length; i++) {
      logReturns.push(Math.log(sampledPrices[i] / sampledPrices[i - 1]));
    }

    const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
    const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    const periodsPerYear = 6 * 60 * 8760;
    return stdDev * Math.sqrt(periodsPerYear);
  }

  getLatestPrice(symbol: string): number | null {
    const state = this.prices[symbol];
    if (!state) return null;
    if (Date.now() - state.timestamp > STALE_THRESHOLD_MS) return null;
    return state.price;
  }

  getAllPrices(): Record<string, PriceState> {
    return { ...this.prices };
  }

  isHealthy(): boolean {
    return this.connected && !this.circuitOpen && Date.now() - this.lastMessageAt < STALE_THRESHOLD_MS;
  }

  getStatus(): { connected: boolean; healthy: boolean; lastMessageAt: number; symbols: string[]; latencyMs: number; circuitOpen: boolean } {
    return {
      connected: this.connected,
      healthy: this.isHealthy(),
      lastMessageAt: this.lastMessageAt,
      symbols: Object.keys(this.prices),
      latencyMs: this.lastMessageAt > 0 ? Date.now() - this.lastMessageAt : -1,
      circuitOpen: this.circuitOpen,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Exported as `binanceWs` for backward compatibility — all importers use this name
export const binanceWs = new CryptoWebSocketService();
