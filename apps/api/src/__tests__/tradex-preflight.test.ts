import { describe, it, expect } from 'vitest';
import { runPreflight } from '@apex/tradex';
import type { PreflightContext } from '@apex/tradex';
import { DEFAULT_RISK_LIMITS } from '@apex/tradex';
import type { BaseExecutor } from '@apex/tradex';

function mockExecutor(balance: { available: number; deployed: number }): BaseExecutor {
  return {
    platform: 'KALSHI',
    isDemoMode: true,
    placeOrder: async () => ({ orderId: '', platform: 'KALSHI' as const, status: 'FILLED' as const, filledPrice: 0.50, filledSize: 10, fee: 0, latencyMs: 100 }),
    cancelOrder: async () => {},
    getPositions: async () => [],
    getBalance: async () => balance,
    calculateFee: (c: number, p: number) => Math.ceil(0.07 * c * p * (1 - p) * 100) / 100,
  } as BaseExecutor;
}

// Explicit test limits — do NOT rely on DEFAULT_RISK_LIMITS which may change.
// Tests validate gate logic, not specific production limit values.
const TEST_LIMITS = {
  ...DEFAULT_RISK_LIMITS,
  maxPerTrade: 10,
  maxDailyNewTrades: 30,
  maxSimultaneousPositions: 5,
  maxTotalDeployed: 100,
};

function makeContext(overrides: Partial<Omit<PreflightContext, 'executor'>> & { balance?: { available: number; deployed: number } }): PreflightContext {
  const { balance, ...rest } = overrides;
  return {
    tradeSize: 5,
    currentEdge: 0.05,
    fee: 0.10,
    graduated: true,
    dailyNewTradeVolume: 0,
    openPositionCount: 0,
    limits: { ...TEST_LIMITS },
    executor: mockExecutor(balance ?? { available: 100, deployed: 0 }),
    ...rest,
  };
}

describe('TRADEX Preflight Checks', () => {
  it('passes when all gates are within limits', async () => {
    const result = await runPreflight(makeContext({}));
    expect(result.pass).toBe(true);
  });

  it('fails RISK_GATE when trade exceeds max per trade', async () => {
    const result = await runPreflight(makeContext({ tradeSize: 15 })); // default max is $10
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('RISK_GATE');
  });

  it('fails BALANCE_CHECK when insufficient balance', async () => {
    const result = await runPreflight(makeContext({
      tradeSize: 5,
      balance: { available: 2, deployed: 0 },
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('BALANCE_CHECK');
  });

  it('fails BALANCE_CHECK when total deployed would exceed limit', async () => {
    const result = await runPreflight(makeContext({
      tradeSize: 5,
      balance: { available: 50, deployed: 98 }, // 98 + 5 > 100
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('BALANCE_CHECK');
  });

  it('fails EDGE_VALID when edge is zero', async () => {
    const result = await runPreflight(makeContext({ currentEdge: 0 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('EDGE_VALID');
  });

  it('fails EDGE_VALID when edge is negative', async () => {
    const result = await runPreflight(makeContext({ currentEdge: -0.01 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('EDGE_VALID');
  });

  it('fails FEE_CHECK when edge does not cover fee', async () => {
    // edge * size = 0.001 * 5 = 0.005, fee = 0.10
    const result = await runPreflight(makeContext({ currentEdge: 0.001, fee: 0.10 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('FEE_CHECK');
  });

  it('fails GRADUATION_CHECK when not graduated', async () => {
    const result = await runPreflight(makeContext({ graduated: false }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('GRADUATION_CHECK');
  });

  it('fails DAILY_LIMIT when daily volume exceeds cap', async () => {
    const result = await runPreflight(makeContext({
      tradeSize: 5,
      dailyNewTradeVolume: 28, // 28 + 5 > 30
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('DAILY_LIMIT');
  });

  it('fails POSITION_COUNT when at max positions', async () => {
    const result = await runPreflight(makeContext({ openPositionCount: 5 })); // max is 5
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('POSITION_COUNT');
  });
});
