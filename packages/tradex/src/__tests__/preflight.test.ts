import { describe, it, expect } from 'vitest';
import { runPreflight, PreflightContext } from '../preflight';
import type { RiskLimitConfig } from '../types';
import type { BaseExecutor } from '../executors/base';

const defaultLimits: RiskLimitConfig = {
  maxPerTrade: 10,
  maxDailyNewTrades: 30,
  maxSimultaneousPositions: 5,
  maxTotalDeployed: 100,
  consecutiveLossHalt: 3,
  dailyPnlHalt: -20,
  maxArbExecutionsPerHour: 10,
};

function mockExecutor(available = 100, deployed = 0): BaseExecutor {
  return {
    platform: 'KALSHI',
    getBalance: async () => ({ available, deployed, total: available + deployed }),
    placeOrder: async () => ({ orderId: '', platform: 'KALSHI' as any, status: 'FILLED' as any, filledPrice: 0.5, filledSize: 1, fee: 0.01, latencyMs: 50, errorMessage: null }),
    cancelOrder: async () => {},
    getPositions: async () => [],
  } as any;
}

function makeCtx(overrides: Partial<PreflightContext> = {}): PreflightContext {
  return {
    tradeSize: 5,
    currentEdge: 0.05,
    fee: 0.01,
    graduated: true,
    dailyNewTradeVolume: 0,
    openPositionCount: 0,
    limits: defaultLimits,
    executor: mockExecutor(),
    ...overrides,
  };
}

describe('preflight gates', () => {
  it('all gates pass → execution approved', async () => {
    const result = await runPreflight(makeCtx());
    expect(result.pass).toBe(true);
  });

  it('Gate 1 — RISK_GATE: trade size exceeds max', async () => {
    const result = await runPreflight(makeCtx({ tradeSize: 50 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('RISK_GATE');
  });

  it('Gate 2 — BALANCE_CHECK: insufficient balance', async () => {
    const result = await runPreflight(makeCtx({
      executor: mockExecutor(1, 0), // only $1 available
      tradeSize: 5,
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('BALANCE_CHECK');
  });

  it('Gate 2 — BALANCE_CHECK: would exceed max deployed', async () => {
    const result = await runPreflight(makeCtx({
      executor: mockExecutor(100, 98), // $98 deployed, adding $5 = $103 > $100 max
      tradeSize: 5,
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('BALANCE_CHECK');
  });

  it('Gate 3 — EDGE_VALID: edge is zero', async () => {
    const result = await runPreflight(makeCtx({ currentEdge: 0 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('EDGE_VALID');
  });

  it('Gate 3 — EDGE_VALID: edge is negative', async () => {
    const result = await runPreflight(makeCtx({ currentEdge: -0.05 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('EDGE_VALID');
  });

  it('Gate 4 — FEE_CHECK: edge does not cover fee', async () => {
    const result = await runPreflight(makeCtx({
      currentEdge: 0.001, // very small edge
      tradeSize: 5,
      fee: 0.10, // high fee
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('FEE_CHECK');
  });

  it('Gate 5 — GRADUATION_CHECK: not graduated', async () => {
    const result = await runPreflight(makeCtx({ graduated: false }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('GRADUATION_CHECK');
  });

  it('Gate 6 — DAILY_LIMIT: exceeds daily cap', async () => {
    const result = await runPreflight(makeCtx({
      dailyNewTradeVolume: 28, // $28 already, adding $5 = $33 > $30 max
      tradeSize: 5,
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('DAILY_LIMIT');
  });

  it('Gate 7 — POSITION_COUNT: at max positions', async () => {
    const result = await runPreflight(makeCtx({ openPositionCount: 5 }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('POSITION_COUNT');
  });
});
