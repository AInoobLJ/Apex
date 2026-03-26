import { describe, it, expect } from 'vitest';
import { findMatchingMarkets } from '../services/market-matcher';
import type { Market } from '@apex/db';

function mockMarket(overrides: Partial<Market>): Market {
  return {
    id: 'test-id',
    platform: 'KALSHI',
    platformMarketId: 'test',
    title: 'Test Market',
    description: null,
    category: 'POLITICS',
    status: 'ACTIVE',
    resolutionText: null,
    resolutionSource: null,
    resolutionDate: null,
    resolution: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    closesAt: null,
    volume: 0,
    liquidity: 0,
    ...overrides,
  } as Market;
}

describe('Market Matcher', () => {
  it('matches markets with similar titles across platforms', async () => {
    const kalshi = [
      mockMarket({ id: 'k1', platform: 'KALSHI', title: 'Fed rate cut June 2025' }),
    ];
    const poly = [
      mockMarket({ id: 'p1', platform: 'POLYMARKET', title: 'Fed rate cut June 2025 decision' }),
      mockMarket({ id: 'p2', platform: 'POLYMARKET', title: 'Bitcoin price above $100K by July' }),
    ];

    const matches = await findMatchingMarkets(kalshi, poly, 0.3);
    expect(matches.length).toBe(1);
    expect(matches[0].kalshiMarketId).toBe('k1');
    expect(matches[0].polymarketMarketId).toBe('p1');
    expect(matches[0].similarity).toBeGreaterThan(0.3);
  });

  it('returns no matches for unrelated markets', async () => {
    const kalshi = [
      mockMarket({ id: 'k1', platform: 'KALSHI', title: 'Will Bitcoin exceed $200K?' }),
    ];
    const poly = [
      mockMarket({ id: 'p1', platform: 'POLYMARKET', title: 'Will the Lakers win the NBA championship?' }),
    ];

    const matches = await findMatchingMarkets(kalshi, poly, 0.5);
    expect(matches.length).toBe(0);
  });

  it('respects threshold parameter', async () => {
    const kalshi = [
      mockMarket({ id: 'k1', platform: 'KALSHI', title: 'Fed rate decision June' }),
    ];
    const poly = [
      mockMarket({ id: 'p1', platform: 'POLYMARKET', title: 'FOMC rate decision June meeting' }),
    ];

    const matchesLow = await findMatchingMarkets(kalshi, poly, 0.2);
    const matchesHigh = await findMatchingMarkets(kalshi, poly, 0.9);
    expect(matchesLow.length).toBeGreaterThanOrEqual(matchesHigh.length);
  });
});
