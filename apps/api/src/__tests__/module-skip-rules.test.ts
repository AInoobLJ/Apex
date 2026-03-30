import { describe, it, expect } from 'vitest';
import {
  isBracketMarket,
  isCryptoBracket,
  shouldSkipModule,
  createSkipTracker,
} from '../services/module-skip-rules';

describe('isBracketMarket', () => {
  it('detects price range patterns ($X-$Y)', () => {
    expect(isBracketMarket('Ethereum price $2,030-$2,070 Mar 28 9PM')).toBe(true);
    expect(isBracketMarket('Bitcoin price $67,050-$67,550 Mar 26 5PM')).toBe(true);
    expect(isBracketMarket('Will BTC be between $69,000-$69,500?')).toBe(true);
  });

  it('detects "price at/range/between" patterns', () => {
    expect(isBracketMarket('Ripple price at Mar 29, 2026 at 12am EDT?')).toBe(true);
    expect(isBracketMarket('Ethereum price range Mar 28')).toBe(true);
    expect(isBracketMarket('Bitcoin price between $60K and $65K')).toBe(true);
  });

  it('detects above/below floor/ceiling patterns', () => {
    expect(isBracketMarket('Will Bitcoin be above $100,000?')).toBe(true);
    expect(isBracketMarket('Ethereum below $2,000 by Friday')).toBe(true);
    expect(isBracketMarket('SOL over $200 end of March')).toBe(true);
  });

  it('does NOT flag non-bracket markets', () => {
    expect(isBracketMarket('Will the Fed cut rates in June?')).toBe(false);
    expect(isBracketMarket('Trump wins 2026 midterms')).toBe(false);
    expect(isBracketMarket('Orlando Magic NBA Playoffs')).toBe(false);
    expect(isBracketMarket('Hungary PM Orban removed from office')).toBe(false);
    expect(isBracketMarket('Will Napoli win the 2025-26 Serie A?')).toBe(false);
  });
});

describe('isCryptoBracket', () => {
  it('crypto category + bracket title → true', () => {
    expect(isCryptoBracket('Ethereum price $2,030-$2,070 Mar 28', 'CRYPTO')).toBe(true);
  });

  it('crypto asset name + bracket pattern → true even without CRYPTO category', () => {
    expect(isCryptoBracket('Bitcoin price above $100,000', 'OTHER')).toBe(true);
  });

  it('non-bracket crypto market → false', () => {
    expect(isCryptoBracket('Will Bitcoin ETF be approved?', 'CRYPTO')).toBe(false);
  });
});

describe('shouldSkipModule — LEGEX', () => {
  it('skips LEGEX for crypto bracket market', () => {
    const result = shouldSkipModule('LEGEX', {
      title: 'Ethereum price $2,030-$2,070 Mar 28 9PM',
      category: 'CRYPTO',
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('numeric thresholds');
  });

  it('skips LEGEX for ANY bracket market (sports, finance)', () => {
    const sports = shouldSkipModule('LEGEX', {
      title: 'Lakers score above $220.5 tonight',
      category: 'SPORTS',
    });
    // Sports total points with $ sign would match; in practice sports brackets
    // don't use $ but this tests the rule applies across categories
    expect(sports.skipped).toBe(true);

    const finance = shouldSkipModule('LEGEX', {
      title: 'S&P 500 above $5,800 Friday close',
      category: 'FINANCE',
    });
    expect(finance.skipped).toBe(true);
  });

  it('runs LEGEX for politics markets', () => {
    const result = shouldSkipModule('LEGEX', {
      title: 'Will the Fed cut rates in June?',
      category: 'POLITICS',
    });
    expect(result.skipped).toBe(false);
  });

  it('runs LEGEX for corporate/legal markets', () => {
    const result = shouldSkipModule('LEGEX', {
      title: 'Will TikTok be banned by July?',
      category: 'CULTURE',
    });
    expect(result.skipped).toBe(false);
  });
});

describe('shouldSkipModule — ALTEX (skip short-duration brackets only)', () => {
  it('skips ALTEX on short-duration crypto brackets (< 24h)', () => {
    const result = shouldSkipModule('ALTEX', {
      title: 'Bitcoin price $67,050-$67,550 Mar 26 5PM',
      category: 'CRYPTO',
      closesAt: new Date(Date.now() + 2 * 3600000), // 2h from now
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('Short-duration bracket');
  });

  it('runs ALTEX on long-duration crypto brackets (> 24h)', () => {
    const result = shouldSkipModule('ALTEX', {
      title: 'Bitcoin price $67,050-$67,550 Apr 5',
      category: 'CRYPTO',
      closesAt: new Date(Date.now() + 7 * 24 * 3600000), // 7 days
    });
    expect(result.skipped).toBe(false);
  });

  it('runs ALTEX on brackets with no closesAt', () => {
    const result = shouldSkipModule('ALTEX', {
      title: 'Bitcoin price $67,050-$67,550',
      category: 'CRYPTO',
    });
    expect(result.skipped).toBe(false);
  });

  it('runs ALTEX for politics markets regardless of duration', () => {
    const result = shouldSkipModule('ALTEX', {
      title: 'Will Trump pardon Jan 6 defendants?',
      category: 'POLITICS',
      closesAt: new Date(Date.now() + 2 * 3600000), // even if short
    });
    expect(result.skipped).toBe(false);
  });

  it('runs ALTEX for non-bracket crypto markets regardless of duration', () => {
    const result = shouldSkipModule('ALTEX', {
      title: 'Will Bitcoin ETF be approved by SEC?',
      category: 'CRYPTO',
      closesAt: new Date(Date.now() + 2 * 3600000),
    });
    expect(result.skipped).toBe(false);
  });
});

describe('shouldSkipModule — quantitative modules never skipped', () => {
  const bracketMarket = { title: 'Bitcoin price $67,050-$67,550', category: 'CRYPTO' };

  it('COGEX not skipped', () => {
    expect(shouldSkipModule('COGEX', bracketMarket).skipped).toBe(false);
  });

  it('FLOWEX not skipped', () => {
    expect(shouldSkipModule('FLOWEX', bracketMarket).skipped).toBe(false);
  });

  it('SPEEDEX not skipped', () => {
    expect(shouldSkipModule('SPEEDEX', bracketMarket).skipped).toBe(false);
  });

  it('ARBEX not skipped', () => {
    expect(shouldSkipModule('ARBEX', bracketMarket).skipped).toBe(false);
  });
});

describe('createSkipTracker', () => {
  it('tracks skips per module', () => {
    const tracker = createSkipTracker();
    tracker.recordSkip('LEGEX', 'mkt-1', 'bracket');
    tracker.recordSkip('LEGEX', 'mkt-2', 'bracket');

    const metrics = tracker.getMetrics();
    expect(metrics.totalSkips).toBe(2);
    expect(metrics.byModule).toEqual({ LEGEX: 2 });
  });

  it('estimates LLM calls saved (LEGEX=2 per skip)', () => {
    const tracker = createSkipTracker();
    tracker.recordSkip('LEGEX', 'mkt-1', 'bracket');
    tracker.recordSkip('LEGEX', 'mkt-2', 'bracket');

    const metrics = tracker.getMetrics();
    // LEGEX saves 2 calls per skip (screen + analysis)
    expect(metrics.estimatedLLMCallsSaved).toBe(4);
  });

  it('returns zeros when nothing skipped', () => {
    const tracker = createSkipTracker();
    const metrics = tracker.getMetrics();
    expect(metrics.totalSkips).toBe(0);
    expect(metrics.estimatedLLMCallsSaved).toBe(0);
  });
});
