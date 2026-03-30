import { BaseExecutor } from '@apex/tradex';
import { kalshiFee, polymarketFee } from '@apex/shared';
import type { Platform } from '@apex/shared';
import type { OrderRequest, OrderResult } from '@apex/tradex';
import { syncPrisma as prisma } from '../lib/prisma';

const PAPER_BALANCE = 10000; // $10,000 simulated balance per platform (matches portfolio BANKROLL)

/**
 * PaperExecutor — implements BaseExecutor for paper trading mode.
 *
 * Instead of placing real orders, it:
 * - Returns a fake successful OrderResult (ExecutionManager runs preflight first)
 * - getBalance() returns paper balance based on open paper positions
 * - calculateFee() uses the shared fee calculator
 *
 * This allows ExecutionManager.execute() to run all 7 preflight gates
 * before the paper trade is created by the caller.
 */
export class PaperExecutor extends BaseExecutor {
  readonly platform: Platform;
  readonly isDemoMode = true;

  constructor(platform: Platform) {
    super();
    this.platform = platform;
  }

  calculateFee(contracts: number, pricePaid: number): number {
    return this.platform === 'KALSHI'
      ? kalshiFee(pricePaid, contracts)
      : polymarketFee(pricePaid, contracts);
  }

  async placeOrder(request: OrderRequest): Promise<OrderResult> {
    // Paper mode: return a simulated fill (the actual paper position creation
    // is handled by the TradingService after execute() returns).
    return {
      orderId: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      platform: request.platform,
      status: 'FILLED',
      filledPrice: request.price,
      filledSize: request.size,
      fee: this.calculateFee(Math.ceil(request.size / request.price), request.price),
      latencyMs: 0,
    };
  }

  async cancelOrder(_orderId: string): Promise<void> {
    // No-op for paper trades
  }

  async getPositions(): Promise<{ ticker: string; side: string; quantity: number; avgPrice: number }[]> {
    // Return open paper positions as "positions"
    const positions = await prisma.paperPosition.findMany({
      where: { isOpen: true },
    });
    return positions.map(p => ({
      ticker: p.marketId,
      side: p.direction === 'BUY_YES' ? 'yes' : 'no',
      quantity: p.kellySize,
      avgPrice: p.entryPrice,
    }));
  }

  async getBalance(): Promise<{ available: number; deployed: number }> {
    // Calculate deployed from open paper positions
    const positions = await prisma.paperPosition.findMany({
      where: { isOpen: true },
    });
    const deployed = positions.reduce((sum, p) => sum + p.kellySize * p.entryPrice, 0);
    return {
      available: Math.max(0, PAPER_BALANCE - deployed),
      deployed,
    };
  }
}
