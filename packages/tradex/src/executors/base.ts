import type { Platform } from '@apex/shared';
import type { OrderRequest, OrderResult } from '../types';

export abstract class BaseExecutor {
  abstract readonly platform: Platform;
  abstract readonly isDemoMode: boolean;

  abstract placeOrder(request: OrderRequest): Promise<OrderResult>;
  abstract cancelOrder(orderId: string): Promise<void>;
  abstract getPositions(): Promise<{ ticker: string; side: string; quantity: number; avgPrice: number }[]>;
  abstract getBalance(): Promise<{ available: number; deployed: number }>;
  abstract calculateFee(contracts: number, price: number): number;
}
