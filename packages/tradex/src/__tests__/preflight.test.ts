import { describe, it, expect } from 'vitest';
import { runPreflight, checkConcentration, PreflightContext } from '../preflight';
import type { RiskLimitConfig, ConcentrationLimits, PositionSnapshot } from '../types';
import { DEFAULT_CONCENTRATION_LIMITS } from '../types';
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

  it('Gate 8 — CONCENTRATION: skipped when concentration context not provided', async () => {
    const result = await runPreflight(makeCtx());
    expect(result.pass).toBe(true);
  });

  // Test concentration limits with explicit tight limits (production defaults are relaxed for data collection)
  const tightConcentrationLimits = { maxPerCategory: 0.25, maxPerEvent: 0.15, maxPerPlatform: 0.60, maxOpenPositions: 20 };

  it('Gate 8 — CONCENTRATION: blocks when category limit exceeded', async () => {
    const result = await runPreflight(makeCtx({
      tradeSize: 5,
      concentration: {
        platform: 'KALSHI',
        category: 'POLITICS',
        marketId: 'mkt-new',
        portfolioValue: 100,
        positions: [
          { marketId: 'mkt-1', platform: 'KALSHI', category: 'POLITICS', notional: 22 },
        ],
        limits: tightConcentrationLimits,
        // 22 + 5 = 27 / 100 = 27% > 25% limit
      },
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('CONCENTRATION');
    expect(result.reason).toContain('Category');
    expect(result.reason).toContain('POLITICS');
  });

  it('Gate 8 — CONCENTRATION: blocks when event limit exceeded', async () => {
    const result = await runPreflight(makeCtx({
      tradeSize: 5,
      concentration: {
        platform: 'KALSHI',
        category: 'POLITICS',
        marketId: 'mkt-same',
        portfolioValue: 100,
        positions: [
          { marketId: 'mkt-same', platform: 'KALSHI', category: 'POLITICS', notional: 12 },
        ],
        limits: tightConcentrationLimits,
        // 12 + 5 = 17 / 100 = 17% > 15% event limit
      },
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('CONCENTRATION');
    expect(result.reason).toContain('Market');
  });

  it('Gate 8 — CONCENTRATION: blocks when platform limit exceeded', async () => {
    const result = await runPreflight(makeCtx({
      tradeSize: 10,
      concentration: {
        platform: 'KALSHI',
        category: 'SCIENCE',
        marketId: 'mkt-new',
        portfolioValue: 100,
        positions: [
          { marketId: 'mkt-1', platform: 'KALSHI', category: 'POLITICS', notional: 25 },
          { marketId: 'mkt-2', platform: 'KALSHI', category: 'CRYPTO', notional: 27 },
        ],
        limits: tightConcentrationLimits,
        // Kalshi total: 25 + 27 + 10 = 62 / 100 = 62% > 60% limit
      },
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('CONCENTRATION');
    expect(result.reason).toContain('Platform');
    expect(result.reason).toContain('KALSHI');
  });
});

describe('Gate 9 — MARKET_OPEN', () => {
  it('market open with plenty of time → passes', async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'ACTIVE' }));
    expect(result.pass).toBe(true);
  });

  it('market already closed → fails', async () => {
    const closesAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'ACTIVE' }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('MARKET_OPEN');
    expect(result.reason).toContain('already closed');
  });

  it('market closing in 3 min (within 5 min buffer) → fails', async () => {
    const closesAt = new Date(Date.now() + 3 * 60 * 1000); // 3 min from now
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'ACTIVE' }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('MARKET_OPEN');
    expect(result.reason).toContain('5min buffer');
  });

  it('market closing in 10 min (outside buffer) → passes', async () => {
    const closesAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'ACTIVE' }));
    expect(result.pass).toBe(true);
  });

  it('market status is CLOSED → fails', async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000); // future close time but status CLOSED
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'CLOSED' }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('MARKET_OPEN');
    expect(result.reason).toContain("'CLOSED'");
  });

  it('market status is RESOLVED → fails', async () => {
    const closesAt = new Date(Date.now() + 60 * 60 * 1000);
    const result = await runPreflight(makeCtx({ marketClosesAt: closesAt, marketStatus: 'RESOLVED' }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('MARKET_OPEN');
    expect(result.reason).toContain("'RESOLVED'");
  });

  it('no marketClosesAt provided → gate skipped, passes', async () => {
    const result = await runPreflight(makeCtx());
    expect(result.pass).toBe(true);
  });
});

describe('Gate 10 — BRACKET_CONFLICT', () => {
  it('blocks when combined bracket cost exceeds max payout', async () => {
    const result = await runPreflight(makeCtx({
      bracketConflict: {
        marketTitle: 'ETH $2,090-$2,130 MAR 29 5PM',
        proposedEntryPrice: 0.15,
        proposedDirection: 'BUY_YES',
        existingBracketPositions: [
          { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.256, direction: 'BUY_YES' },
          { marketId: 'm2', title: 'ETH $2,050-$2,090 MAR 29 5PM', entryPrice: 0.303, direction: 'BUY_YES' },
          { marketId: 'm3', title: 'ETH $2,010-$2,050 MAR 29 5PM', entryPrice: 0.326, direction: 'BUY_YES' },
        ],
      },
    }));
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('BRACKET_CONFLICT');
    expect(result.reason).toContain('Bracket conflict');
  });

  it('allows when combined bracket cost is still +EV', async () => {
    const result = await runPreflight(makeCtx({
      bracketConflict: {
        marketTitle: 'ETH $2,010-$2,050 MAR 29 5PM',
        proposedEntryPrice: 0.30,
        proposedDirection: 'BUY_YES',
        existingBracketPositions: [
          { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.256, direction: 'BUY_YES' },
        ],
      },
    }));
    expect(result.pass).toBe(true);
  });

  it('skipped when bracketConflict context not provided', async () => {
    const result = await runPreflight(makeCtx());
    expect(result.pass).toBe(true);
  });

  it('passes for non-bracket markets', async () => {
    const result = await runPreflight(makeCtx({
      bracketConflict: {
        marketTitle: 'Will Biden win?',
        proposedEntryPrice: 0.55,
        proposedDirection: 'BUY_YES',
        existingBracketPositions: [
          { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.90, direction: 'BUY_YES' },
        ],
      },
    }));
    expect(result.pass).toBe(true);
  });
});

describe('checkConcentration (standalone)', () => {
  // Use explicit tight limits for testing (production defaults are relaxed for data collection)
  const limits: ConcentrationLimits = { maxPerCategory: 0.25, maxPerEvent: 0.15, maxPerPlatform: 0.60, maxOpenPositions: 20 };

  it('first trade in empty portfolio → passes all checks', () => {
    const result = checkConcentration({
      platform: 'KALSHI',
      category: 'POLITICS',
      marketId: 'mkt-1',
      positions: [],
      portfolioValue: 100,
      limits,
    }, 5);
    expect(result.pass).toBe(true);
  });

  it('trades spread across categories → all pass', () => {
    const positions: PositionSnapshot[] = [
      { marketId: 'mkt-1', platform: 'KALSHI', category: 'POLITICS', notional: 10 },
      { marketId: 'mkt-2', platform: 'POLYMARKET', category: 'CRYPTO', notional: 10 },
      { marketId: 'mkt-3', platform: 'KALSHI', category: 'SPORTS', notional: 10 },
    ];

    // Adding $5 to SCIENCE — well diversified
    const result = checkConcentration({
      platform: 'POLYMARKET',
      category: 'SCIENCE',
      marketId: 'mkt-4',
      positions,
      portfolioValue: 100,
      limits,
    }, 5);
    expect(result.pass).toBe(true);
  });

  it('21st position when maxOpenPositions is 20 → blocked', () => {
    const positions: PositionSnapshot[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `mkt-${i}`,
      platform: (i % 2 === 0 ? 'KALSHI' : 'POLYMARKET') as 'KALSHI' | 'POLYMARKET',
      category: ['POLITICS', 'CRYPTO', 'SPORTS', 'SCIENCE'][i % 4],
      notional: 2,
    }));

    const result = checkConcentration({
      platform: 'KALSHI',
      category: 'CULTURE',
      marketId: 'mkt-21',
      positions,
      portfolioValue: 1000,
      limits,
    }, 5);
    expect(result.pass).toBe(false);
    expect(result.failedGate).toBe('CONCENTRATION');
    expect(result.reason).toContain('max open positions');
  });

  it('category at exactly 25% → passes, above 25% → blocks', () => {
    const positions: PositionSnapshot[] = [
      { marketId: 'mkt-1', platform: 'KALSHI', category: 'POLITICS', notional: 20 },
    ];

    // Adding $5 = 25/100 = 25% exactly — should pass (equal, not exceeding)
    const result1 = checkConcentration({
      platform: 'KALSHI', category: 'POLITICS', marketId: 'mkt-2',
      positions, portfolioValue: 100, limits,
    }, 5);
    expect(result1.pass).toBe(true);

    // Adding $6 = 26/100 = 26% — should block
    const result2 = checkConcentration({
      platform: 'KALSHI', category: 'POLITICS', marketId: 'mkt-2',
      positions, portfolioValue: 100, limits,
    }, 6);
    expect(result2.pass).toBe(false);
    expect(result2.failedGate).toBe('CONCENTRATION');
  });

  it('portfolioValue of 0 → passes (cannot compute ratios)', () => {
    const result = checkConcentration({
      platform: 'KALSHI', category: 'POLITICS', marketId: 'mkt-1',
      positions: [], portfolioValue: 0, limits,
    }, 5);
    expect(result.pass).toBe(true);
  });
});
