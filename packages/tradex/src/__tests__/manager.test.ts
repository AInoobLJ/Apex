import { describe, it, expect } from 'vitest';
import { ExecutionManager } from '../manager';
import type { BaseExecutor } from '../executors/base';
import type { OrderResult, RiskLimitConfig } from '../types';

function mockExecutor(platform: 'KALSHI' | 'POLYMARKET', shouldFail = false): BaseExecutor {
  return {
    platform,
    getBalance: async () => ({ available: 100, deployed: 0, total: 100 }),
    placeOrder: async () => {
      if (shouldFail) {
        return { orderId: '', platform, status: 'FAILED' as any, filledPrice: null, filledSize: null, fee: 0, latencyMs: 50, errorMessage: 'Mock failure' };
      }
      return { orderId: 'order-123', platform, status: 'FILLED' as any, filledPrice: 0.5, filledSize: 1, fee: 0.01, latencyMs: 50, errorMessage: null };
    },
    cancelOrder: async () => {},
    getPositions: async () => [],
  } as any;
}

const limits: RiskLimitConfig = {
  maxPerTrade: 10,
  maxDailyNewTrades: 30,
  maxSimultaneousPositions: 5,
  maxTotalDeployed: 100,
  consecutiveLossHalt: 3,
  dailyPnlHalt: -20,
  maxArbExecutionsPerHour: 10,
};

describe('ExecutionManager — circuit breaker', () => {
  it('circuit not open initially', () => {
    const mgr = new ExecutionManager();
    mgr.registerExecutor(mockExecutor('KALSHI'));
    expect(mgr.isCircuitOpen('KALSHI')).toBe(false);
  });

  it('circuit opens after threshold failures', async () => {
    const mgr = new ExecutionManager();
    const failing = mockExecutor('KALSHI', true);
    mgr.registerExecutor(failing);

    const ctx = { tradeSize: 5, currentEdge: 0.05, fee: 0.01, graduated: true, dailyNewTradeVolume: 0, openPositionCount: 0, limits };

    // 3 consecutive failures should trip the circuit breaker
    for (let i = 0; i < 3; i++) {
      await mgr.execute({ platform: 'KALSHI', ticker: 'test', side: 'yes' as any, action: 'buy', type: 'market_limit', price: 0.5, size: 1 }, ctx);
    }

    expect(mgr.isCircuitOpen('KALSHI')).toBe(true);
  });

  it('circuit open → execute fails fast', async () => {
    const mgr = new ExecutionManager();
    const failing = mockExecutor('KALSHI', true);
    mgr.registerExecutor(failing);

    const ctx = { tradeSize: 5, currentEdge: 0.05, fee: 0.01, graduated: true, dailyNewTradeVolume: 0, openPositionCount: 0, limits };

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await mgr.execute({ platform: 'KALSHI', ticker: 'test', side: 'yes' as any, action: 'buy', type: 'market_limit', price: 0.5, size: 1 }, ctx);
    }

    // Now it should fail fast
    const result = await mgr.execute(
      { platform: 'KALSHI', ticker: 'test', side: 'yes' as any, action: 'buy', type: 'market_limit', price: 0.5, size: 1 },
      ctx
    );
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toContain('Circuit breaker');
  });
});

describe('ExecutionManager — executeArb', () => {
  it('arb checks circuit breakers for both platforms', async () => {
    const mgr = new ExecutionManager();
    const failing = mockExecutor('KALSHI', true);
    mgr.registerExecutor(failing);
    mgr.registerExecutor(mockExecutor('POLYMARKET'));

    const ctx = { tradeSize: 5, currentEdge: 0.05, fee: 0.01, graduated: true, dailyNewTradeVolume: 0, openPositionCount: 0, limits };

    // Trip Kalshi breaker
    for (let i = 0; i < 3; i++) {
      await mgr.execute({ platform: 'KALSHI', ticker: 'test', side: 'yes' as any, action: 'buy', type: 'market_limit', price: 0.5, size: 1 }, ctx);
    }

    const arbResult = await mgr.executeArb({
      leg1: { platform: 'KALSHI', ticker: 'test1', side: 'yes', price: 0.5, size: 1 },
      leg2: { platform: 'POLYMARKET', ticker: 'test2', side: 'no', price: 0.4, size: 1 },
      edge: 0.10,
      roundTripFees: 0.02,
    } as any, ctx);

    expect(arbResult.status).toBe('FAILED');
    expect(arbResult.leg1.errorMessage).toContain('Circuit breaker');
  });

  it('arb with preflight failure → no legs executed', async () => {
    const mgr = new ExecutionManager();
    mgr.registerExecutor(mockExecutor('KALSHI'));
    mgr.registerExecutor(mockExecutor('POLYMARKET'));

    const ctx = {
      tradeSize: 50, // exceeds maxPerTrade of 10
      currentEdge: 0.05, fee: 0.01, graduated: true,
      dailyNewTradeVolume: 0, openPositionCount: 0, limits,
    };

    const arbResult = await mgr.executeArb({
      leg1: { platform: 'KALSHI', ticker: 'test1', side: 'yes', price: 0.5, size: 50 },
      leg2: { platform: 'POLYMARKET', ticker: 'test2', side: 'no', price: 0.4, size: 50 },
      edge: 0.10,
      roundTripFees: 0.02,
    } as any, ctx);

    expect(arbResult.status).toBe('FAILED');
    expect(arbResult.leg1.errorMessage).toContain('preflight');
  });
});
