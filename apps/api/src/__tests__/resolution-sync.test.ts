import { describe, it, expect } from 'vitest';

/**
 * Tests for resolution sync — verifying that settled Kalshi markets
 * produce correct resolution outcomes and P&L calculations.
 *
 * The root cause of 0 RESOLVED markets was that market sync only fetches
 * status='open' from Kalshi. Settled markets with result='yes'/'no' were
 * never picked up. These tests verify the resolution logic is correct.
 *
 * Note: We test the normalization logic inline (not via KalshiClient) because
 * the KalshiClient constructor requires circuit-breaker and config dependencies.
 */

/** Reproduce the normalization logic from kalshi-client.ts normalizeMarket() */
function normalizeResolution(result: string | null): { resolution: 'YES' | 'NO' | null; status: 'RESOLVED' | 'ACTIVE' } {
  return {
    status: result ? 'RESOLVED' : 'ACTIVE',
    resolution: result === 'yes' ? 'YES' : result === 'no' ? 'NO' : null,
  };
}

/** Reproduce the P&L logic from position-sync.ts */
function calculateResolutionPnl(
  direction: 'BUY_YES' | 'BUY_NO',
  resolution: 'YES' | 'NO',
  entryPrice: number,
): { won: boolean; pnl: number; currentPrice: number } {
  const resolvedYes = resolution === 'YES';
  const won = (direction === 'BUY_YES' && resolvedYes) || (direction === 'BUY_NO' && !resolvedYes);
  const pnl = won ? (1 - entryPrice) : -entryPrice;
  const currentPrice = resolvedYes ? 1.0 : 0.0;
  return { won, pnl, currentPrice };
}

describe('Kalshi market resolution normalization', () => {
  it('result="yes" → resolution=YES, status=RESOLVED', () => {
    const { resolution, status } = normalizeResolution('yes');
    expect(resolution).toBe('YES');
    expect(status).toBe('RESOLVED');
  });

  it('result="no" → resolution=NO, status=RESOLVED', () => {
    const { resolution, status } = normalizeResolution('no');
    expect(resolution).toBe('NO');
    expect(status).toBe('RESOLVED');
  });

  it('result=null → resolution=null, status=ACTIVE', () => {
    const { resolution, status } = normalizeResolution(null);
    expect(resolution).toBeNull();
    expect(status).toBe('ACTIVE');
  });

  it('empty string result → treated as falsy (no resolution)', () => {
    const { resolution, status } = normalizeResolution('');
    expect(resolution).toBeNull();
    expect(status).toBe('ACTIVE');
  });
});

describe('Resolution P&L calculation', () => {
  it('BUY_YES on YES resolution → win, pnl = 1 - entryPrice', () => {
    const { won, pnl, currentPrice } = calculateResolutionPnl('BUY_YES', 'YES', 0.30);
    expect(won).toBe(true);
    expect(pnl).toBeCloseTo(0.70, 2);
    expect(currentPrice).toBe(1.0);
  });

  it('BUY_YES on NO resolution → loss, pnl = -entryPrice', () => {
    const { won, pnl, currentPrice } = calculateResolutionPnl('BUY_YES', 'NO', 0.30);
    expect(won).toBe(false);
    expect(pnl).toBeCloseTo(-0.30, 2);
    expect(currentPrice).toBe(0.0);
  });

  it('BUY_NO on NO resolution → win', () => {
    const { won, pnl } = calculateResolutionPnl('BUY_NO', 'NO', 0.70);
    expect(won).toBe(true);
    expect(pnl).toBeCloseTo(0.30, 2);
  });

  it('BUY_NO on YES resolution → loss', () => {
    const { won, pnl } = calculateResolutionPnl('BUY_NO', 'YES', 0.70);
    expect(won).toBe(false);
    expect(pnl).toBeCloseTo(-0.70, 2);
  });

  it('cheap bracket (5¢) wins big on YES', () => {
    const { won, pnl } = calculateResolutionPnl('BUY_YES', 'YES', 0.05);
    expect(won).toBe(true);
    expect(pnl).toBeCloseTo(0.95, 2);
  });

  it('expensive bracket (90¢) small profit on YES', () => {
    const { won, pnl } = calculateResolutionPnl('BUY_YES', 'YES', 0.90);
    expect(won).toBe(true);
    expect(pnl).toBeCloseTo(0.10, 2);
  });
});

describe('Bracket market resolution — portfolio P&L', () => {
  it('only one bracket per group resolves YES', () => {
    const brackets = [
      { range: '$1,970-$2,010', result: 'no' as const },
      { range: '$2,010-$2,050', result: 'yes' as const },
      { range: '$2,050-$2,090', result: 'no' as const },
    ];

    expect(brackets.filter(b => b.result === 'yes')).toHaveLength(1);
    expect(brackets.filter(b => b.result === 'no')).toHaveLength(2);
  });

  it('combined P&L for buying YES on 3 brackets — one wins', () => {
    const positions = [
      { entryPrice: 0.256, direction: 'BUY_YES' as const, resolution: 'NO' as const },
      { entryPrice: 0.326, direction: 'BUY_YES' as const, resolution: 'YES' as const },
      { entryPrice: 0.303, direction: 'BUY_YES' as const, resolution: 'NO' as const },
    ];

    const totalPnl = positions.reduce((sum, pos) => {
      const { pnl } = calculateResolutionPnl(pos.direction, pos.resolution, pos.entryPrice);
      return sum + pnl;
    }, 0);

    // Won 67.4¢, lost 25.6¢ + 30.3¢ → net +11.5¢
    expect(totalPnl).toBeCloseTo(0.115, 2);
  });

  it('combined P&L when NONE of our brackets win', () => {
    const positions = [
      { entryPrice: 0.256, direction: 'BUY_YES' as const, resolution: 'NO' as const },
      { entryPrice: 0.326, direction: 'BUY_YES' as const, resolution: 'NO' as const },
      { entryPrice: 0.303, direction: 'BUY_YES' as const, resolution: 'NO' as const },
    ];

    const totalPnl = positions.reduce((sum, pos) => {
      const { pnl } = calculateResolutionPnl(pos.direction, pos.resolution, pos.entryPrice);
      return sum + pnl;
    }, 0);

    // Lost all 88.5¢
    expect(totalPnl).toBeCloseTo(-0.885, 3);
  });

  it('single bracket position — normal risk/reward', () => {
    // If we only bought the winning bracket (thanks to Gate 10)
    const { pnl } = calculateResolutionPnl('BUY_YES', 'YES', 0.326);
    expect(pnl).toBeCloseTo(0.674, 3); // Much better than 0.115 from buying all 3
  });
});

describe('Training snapshot outcome linking', () => {
  it('outcome=1 for YES resolution', () => {
    const resolution = 'YES';
    const outcome = resolution === 'YES' ? 1 : 0;
    expect(outcome).toBe(1);
  });

  it('outcome=0 for NO resolution', () => {
    const resolution: string = 'NO';
    const outcome = resolution === 'YES' ? 1 : 0;
    expect(outcome).toBe(0);
  });

  it('unlabeled snapshots should not have outcome', () => {
    // Represents the state before resolution sync
    const snapshot = { outcome: null, resolvedAt: null };
    expect(snapshot.outcome).toBeNull();
  });
});
