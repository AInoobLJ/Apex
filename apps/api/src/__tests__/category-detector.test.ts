import { describe, it, expect } from 'vitest';
import { detectCategory } from '../services/category-detector';

describe('Category Detector', () => {
  it('detects POLITICS markets', () => {
    expect(detectCategory('Will Trump win the 2024 election?')).toBe('POLITICS');
    expect(detectCategory('Biden approval rating above 45%')).toBe('POLITICS');
    expect(detectCategory('Republican primary winner')).toBe('POLITICS');
  });

  it('detects FINANCE markets', () => {
    expect(detectCategory('Fed rate decision June FOMC meeting')).toBe('FINANCE');
    expect(detectCategory('Will inflation CPI exceed 3%?')).toBe('FINANCE');
    expect(detectCategory('S&P 500 above 5000')).toBe('FINANCE');
    expect(detectCategory('Will there be a recession in 2025?')).toBe('FINANCE');
  });

  it('detects CRYPTO markets', () => {
    expect(detectCategory('Bitcoin price above $100K')).toBe('CRYPTO');
    expect(detectCategory('Will Ethereum ETH reach $5000?')).toBe('CRYPTO');
    expect(detectCategory('Solana SOL market cap exceeds $100B')).toBe('CRYPTO');
  });

  it('detects SCIENCE markets', () => {
    expect(detectCategory('NASA Artemis moon landing by 2026')).toBe('SCIENCE');
    expect(detectCategory('Will a new vaccine be approved?')).toBe('SCIENCE');
    expect(detectCategory('Hurricane category 5 to hit Florida')).toBe('SCIENCE');
  });

  it('detects SPORTS markets', () => {
    expect(detectCategory('Lakers NBA championship 2025')).toBe('SPORTS');
    expect(detectCategory('Super Bowl winner')).toBe('SPORTS');
    expect(detectCategory('World Cup final score')).toBe('SPORTS');
  });

  it('detects CULTURE markets', () => {
    expect(detectCategory('Oscar best picture winner 2025')).toBe('CULTURE');
    expect(detectCategory('Netflix subscriber count above 300M')).toBe('CULTURE');
  });

  it('defaults to OTHER for unrecognized markets', () => {
    expect(detectCategory('Something completely random')).toBe('OTHER');
    expect(detectCategory('Will it rain tomorrow in my backyard')).toBe('OTHER');
  });

  it('uses description as fallback', () => {
    expect(detectCategory('Generic title', 'This is about the Fed rate decision')).toBe('FINANCE');
  });
});
