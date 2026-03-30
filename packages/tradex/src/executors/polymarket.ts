import { BaseExecutor } from './base';
import { polymarketFee } from '@apex/shared';
import type { OrderRequest, OrderResult } from '../types';

export interface PolymarketExecutorConfig {
  privateKey: string;
  rpcUrl: string;
}

/**
 * PolymarketExecutor — Phase 3 implementation.
 * Uses CLOB API with EIP-712 signing and on-chain settlement on Polygon.
 * Currently stubbed with NotImplementedError for all methods.
 */
export class PolymarketExecutor extends BaseExecutor {
  readonly platform = 'POLYMARKET' as const;
  readonly isDemoMode = true; // always demo until Phase 3

  constructor(_config: PolymarketExecutorConfig) {
    super();
  }

  calculateFee(contracts: number, pricePaid: number): number {
    return polymarketFee(pricePaid, contracts);
  }

  async placeOrder(_request: OrderRequest): Promise<OrderResult> {
    throw new Error('PolymarketExecutor.placeOrder not implemented — Phase 3');
  }

  async cancelOrder(_orderId: string): Promise<void> {
    throw new Error('PolymarketExecutor.cancelOrder not implemented — Phase 3');
  }

  async getPositions(): Promise<{ ticker: string; side: string; quantity: number; avgPrice: number }[]> {
    throw new Error('PolymarketExecutor.getPositions not implemented — Phase 3');
  }

  async getBalance(): Promise<{ available: number; deployed: number }> {
    throw new Error('PolymarketExecutor.getBalance not implemented — Phase 3');
  }

  async approveAllowance(_amount: number): Promise<string> {
    throw new Error('PolymarketExecutor.approveAllowance not implemented — Phase 3');
  }
}
