import { describe, it, expect } from 'vitest';
import { parseBracketTitle, groupBracketPositions, checkBracketConflict } from '../bracket-detection';
import type { BracketPosition } from '../types';

describe('parseBracketTitle', () => {
  it('parses ETH bracket title', () => {
    const result = parseBracketTitle('ETH $1,970-$2,010 MAR 29 5PM');
    expect(result).toEqual({
      asset: 'ETH',
      expiry: 'MAR295PM',
      expiryDisplay: 'MAR 29 5PM',
    });
  });

  it('parses BTC bracket title', () => {
    const result = parseBracketTitle('BTC $67,050-$67,550 Mar 26 9PM');
    expect(result).toEqual({
      asset: 'BTC',
      expiry: 'MAR269PM',
      expiryDisplay: 'MAR 26 9PM',
    });
  });

  it('parses SOL bracket title', () => {
    const result = parseBracketTitle('SOL $150-$155 APR 01 12PM');
    expect(result).toEqual({
      asset: 'SOL',
      expiry: 'APR0112PM',
      expiryDisplay: 'APR 01 12PM',
    });
  });

  it('returns null for non-bracket titles', () => {
    expect(parseBracketTitle('Will Biden win?')).toBeNull();
    expect(parseBracketTitle('BTC above $65,000')).toBeNull();
    expect(parseBracketTitle('')).toBeNull();
  });

  it('returns null for floor contract titles', () => {
    expect(parseBracketTitle('ETH above $2,000 MAR 29 5PM')).toBeNull();
  });
});

describe('groupBracketPositions', () => {
  it('groups positions by asset + expiry', () => {
    const positions: BracketPosition[] = [
      { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.256, direction: 'BUY_YES' },
      { marketId: 'm2', title: 'ETH $2,010-$2,050 MAR 29 5PM', entryPrice: 0.326, direction: 'BUY_YES' },
      { marketId: 'm3', title: 'ETH $2,050-$2,090 MAR 29 5PM', entryPrice: 0.303, direction: 'BUY_YES' },
      { marketId: 'm4', title: 'BTC $67,050-$67,550 MAR 29 5PM', entryPrice: 0.15, direction: 'BUY_YES' },
    ];

    const groups = groupBracketPositions(positions);
    expect(groups).toHaveLength(2);

    const ethGroup = groups.find(g => g.asset === 'ETH');
    expect(ethGroup).toBeDefined();
    expect(ethGroup!.positions).toHaveLength(3);
    expect(ethGroup!.totalCost).toBeCloseTo(0.885, 3);
    expect(ethGroup!.maxPayout).toBe(1.0);

    const btcGroup = groups.find(g => g.asset === 'BTC');
    expect(btcGroup).toBeDefined();
    expect(btcGroup!.positions).toHaveLength(1);
    expect(btcGroup!.totalCost).toBeCloseTo(0.15, 3);
  });

  it('separates same asset with different expiry', () => {
    const positions: BracketPosition[] = [
      { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.30, direction: 'BUY_YES' },
      { marketId: 'm2', title: 'ETH $1,970-$2,010 MAR 30 5PM', entryPrice: 0.30, direction: 'BUY_YES' },
    ];

    const groups = groupBracketPositions(positions);
    expect(groups).toHaveLength(2);
  });

  it('excludes non-bracket positions', () => {
    const positions: BracketPosition[] = [
      { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.30, direction: 'BUY_YES' },
      { marketId: 'm2', title: 'Will Biden win?', entryPrice: 0.55, direction: 'BUY_YES' },
    ];

    const groups = groupBracketPositions(positions);
    expect(groups).toHaveLength(1);
    expect(groups[0].positions).toHaveLength(1);
  });

  it('only counts BUY_YES toward total cost', () => {
    const positions: BracketPosition[] = [
      { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.30, direction: 'BUY_YES' },
      { marketId: 'm2', title: 'ETH $2,010-$2,050 MAR 29 5PM', entryPrice: 0.60, direction: 'BUY_NO' },
    ];

    const groups = groupBracketPositions(positions);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCost).toBeCloseTo(0.30, 3);
  });

  it('returns empty array for no bracket positions', () => {
    const groups = groupBracketPositions([
      { marketId: 'm1', title: 'Will it rain?', entryPrice: 0.30, direction: 'BUY_YES' },
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('checkBracketConflict', () => {
  const existingPositions: BracketPosition[] = [
    { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.256, direction: 'BUY_YES' },
    { marketId: 'm2', title: 'ETH $2,050-$2,090 MAR 29 5PM', entryPrice: 0.303, direction: 'BUY_YES' },
    { marketId: 'm3', title: 'ETH $2,010-$2,050 MAR 29 5PM', entryPrice: 0.326, direction: 'BUY_YES' },
  ];

  it('detects -EV conflict when combined cost >= max payout', () => {
    // existing: 0.256 + 0.303 + 0.326 = 0.885
    // adding 0.15 → 1.035 > 0.98 (maxPayout - feeMargin)
    const result = checkBracketConflict(
      existingPositions,
      'ETH $2,090-$2,130 MAR 29 5PM',
      0.15,
      'BUY_YES',
    );
    expect(result.conflict).toBe(true);
    expect(result.totalCost).toBeCloseTo(1.035, 3);
    expect(result.bracketCount).toBe(4);
    expect(result.reason).toContain('Bracket conflict');
    expect(result.reason).toContain('-EV');
  });

  it('allows position when combined cost is still +EV', () => {
    // existing: 0.256 + 0.303 = 0.559
    const twoPositions = existingPositions.slice(0, 2);
    const result = checkBracketConflict(
      twoPositions,
      'ETH $2,010-$2,050 MAR 29 5PM',
      0.30,
      'BUY_YES',
    );
    // 0.559 + 0.30 = 0.859 < 0.98 → allowed
    expect(result.conflict).toBe(false);
    expect(result.totalCost).toBeCloseTo(0.859, 3);
    expect(result.bracketCount).toBe(3);
  });

  it('no conflict for non-bracket markets', () => {
    const result = checkBracketConflict(
      existingPositions,
      'Will Biden win the election?',
      0.55,
      'BUY_YES',
    );
    expect(result.conflict).toBe(false);
    expect(result.reason).toContain('Not a bracket market');
  });

  it('no conflict when no existing positions in same group', () => {
    const result = checkBracketConflict(
      existingPositions,
      'BTC $67,050-$67,550 MAR 29 5PM', // different asset
      0.30,
      'BUY_YES',
    );
    expect(result.conflict).toBe(false);
    expect(result.bracketCount).toBe(1);
  });

  it('no conflict for different expiry', () => {
    const result = checkBracketConflict(
      existingPositions,
      'ETH $1,970-$2,010 MAR 30 5PM', // different date
      0.30,
      'BUY_YES',
    );
    expect(result.conflict).toBe(false);
    expect(result.bracketCount).toBe(1);
  });

  it('does not count BUY_NO toward cost', () => {
    const result = checkBracketConflict(
      existingPositions,
      'ETH $2,090-$2,130 MAR 29 5PM',
      0.15,
      'BUY_NO', // buying NO doesn't add to combined bracket cost
    );
    // existing cost = 0.885, proposed adds 0 (BUY_NO) → total = 0.885
    expect(result.conflict).toBe(false);
    expect(result.totalCost).toBeCloseTo(0.885, 3);
  });

  it('exact threshold: cost at 0.98 is -EV (matches fee margin)', () => {
    // existing: 0.70
    const positions: BracketPosition[] = [
      { marketId: 'm1', title: 'ETH $1,970-$2,010 MAR 29 5PM', entryPrice: 0.70, direction: 'BUY_YES' },
    ];
    // adding 0.28 → total = 0.98 = maxPayout - feeMargin → conflict
    const result = checkBracketConflict(
      positions,
      'ETH $2,010-$2,050 MAR 29 5PM',
      0.28,
      'BUY_YES',
    );
    expect(result.conflict).toBe(true);
  });
});
