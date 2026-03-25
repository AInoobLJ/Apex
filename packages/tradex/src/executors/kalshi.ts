import { BaseExecutor } from './base';
import type { OrderRequest, OrderResult } from '../types';

const KALSHI_DEMO_URL = 'https://demo-api.kalshi.co/trade-api/v2';
const KALSHI_PROD_URL = 'https://trading-api.kalshi.com/trade-api/v2';

export interface KalshiExecutorConfig {
  apiKey: string;
  apiSecret: string;
  useDemo: boolean;
}

export class KalshiExecutor extends BaseExecutor {
  readonly platform = 'KALSHI' as const;
  readonly isDemoMode: boolean;

  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(config: KalshiExecutorConfig) {
    super();
    this.isDemoMode = config.useDemo;
    this.baseUrl = config.useDemo ? KALSHI_DEMO_URL : KALSHI_PROD_URL;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
  }

  // Fee: ceil(0.07 × contracts × price × (1 - price))
  calculateFee(contracts: number, price: number): number {
    if (price <= 0 || price >= 1) return 0;
    return Math.ceil(0.07 * contracts * price * (1 - price) * 100) / 100;
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    const start = Date.now();

    try {
      const priceCents = Math.round(request.price * 100);

      const body = JSON.stringify({
        ticker: request.ticker,
        action: request.action,
        side: request.side,
        type: request.type === 'market_limit' ? 'market' : 'limit',
        count: Math.round(request.size),
        yes_price: request.side === 'yes' ? priceCents : undefined,
        no_price: request.side === 'no' ? priceCents : undefined,
      });

      const path = '/portfolio/orders';
      const headers = this.getAuthHeaders('POST', path, body);

      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body,
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const errorText = await response.text();
        return {
          orderId: '',
          platform: 'KALSHI',
          status: 'FAILED',
          filledPrice: null,
          filledSize: null,
          fee: 0,
          latencyMs,
          errorMessage: `HTTP ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json() as {
        order: {
          order_id: string;
          status: string;
          yes_price: number;
          no_price: number;
          remaining_count: number;
          action: string;
          side: string;
          count: number;
        };
      };
      const order = data.order;

      const filledCount = order.count - order.remaining_count;
      const filledPrice = order.side === 'yes'
        ? order.yes_price / 100
        : order.no_price / 100;
      const fee = this.calculateFee(filledCount, filledPrice);

      return {
        orderId: order.order_id,
        platform: 'KALSHI',
        status: order.remaining_count === 0 ? 'FILLED' : filledCount > 0 ? 'PARTIAL' : 'PENDING',
        filledPrice: filledCount > 0 ? filledPrice : null,
        filledSize: filledCount > 0 ? filledCount : null,
        fee,
        latencyMs,
      };
    } catch (err) {
      return {
        orderId: '',
        platform: 'KALSHI',
        status: 'FAILED',
        filledPrice: null,
        filledSize: null,
        fee: 0,
        latencyMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    const path = `/portfolio/orders/${orderId}`;
    const headers = this.getAuthHeaders('DELETE', path);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel order ${orderId}: HTTP ${response.status}: ${errorText}`);
    }
  }

  async getPositions(): Promise<{ ticker: string; side: string; quantity: number; avgPrice: number }[]> {
    const path = '/portfolio/positions';
    const headers = this.getAuthHeaders('GET', path);

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`Failed to get positions: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      market_positions: {
        ticker: string;
        position: number;
        market_exposure: number;
      }[];
    };

    return (data.market_positions ?? []).map(p => ({
      ticker: p.ticker,
      side: p.position > 0 ? 'yes' : 'no',
      quantity: Math.abs(p.position),
      avgPrice: 0, // Kalshi doesn't return avg entry price in positions endpoint
    }));
  }

  async getBalance(): Promise<{ available: number; deployed: number }> {
    const path = '/portfolio/balance';
    const headers = this.getAuthHeaders('GET', path);

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      throw new Error(`Failed to get balance: HTTP ${response.status}`);
    }

    const data = await response.json() as {
      balance: number;       // cents
      payout: number;        // cents
    };

    return {
      available: (data.balance ?? 0) / 100,
      deployed: (data.payout ?? 0) / 100,
    };
  }

  // ── Auth ──

  private getAuthHeaders(method: string, path: string, body: string = ''): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}${method.toUpperCase()}${path}${body}`;

    // Use Node.js crypto for HMAC
    const crypto = require('node:crypto');
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');

    return {
      'KALSHI-ACCESS-KEY': this.apiKey,
      'KALSHI-ACCESS-SIGNATURE': signature,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };
  }
}
