import { describe, it, expect } from 'vitest';
import { enforceHardCeilings, HARD_CEILINGS, DEFAULT_RISK_LIMITS } from '@apex/tradex';
import type { RiskLimitConfig } from '@apex/tradex';

describe('TRADEX Risk Limits', () => {
  it('defaults are within hard ceilings', () => {
    const enforced = enforceHardCeilings(DEFAULT_RISK_LIMITS);
    expect(enforced).toEqual(DEFAULT_RISK_LIMITS);
  });

  it('clamps values exceeding hard ceilings', () => {
    const overLimit: RiskLimitConfig = {
      maxPerTrade: 999,
      maxDailyNewTrades: 9999,
      maxSimultaneousPositions: 100,
      maxTotalDeployed: 99999,
      consecutiveLossHalt: 50,
      dailyPnlHalt: -9999,
      maxArbExecutionsPerHour: 200,
    };

    const enforced = enforceHardCeilings(overLimit);
    expect(enforced.maxPerTrade).toBe(HARD_CEILINGS.maxPerTrade); // 500
    expect(enforced.maxDailyNewTrades).toBe(HARD_CEILINGS.maxDailyNewTrades); // 1000
    expect(enforced.maxSimultaneousPositions).toBe(HARD_CEILINGS.maxSimultaneousPositions); // 25
    expect(enforced.maxTotalDeployed).toBe(HARD_CEILINGS.maxTotalDeployed); // 5000
    expect(enforced.consecutiveLossHalt).toBe(HARD_CEILINGS.consecutiveLossHalt); // 10
    expect(enforced.dailyPnlHalt).toBe(HARD_CEILINGS.dailyPnlHalt); // -500
    expect(enforced.maxArbExecutionsPerHour).toBe(HARD_CEILINGS.maxArbExecutionsPerHour); // 50
  });

  it('allows values within ceilings', () => {
    const withinLimits: RiskLimitConfig = {
      maxPerTrade: 100,
      maxDailyNewTrades: 200,
      maxSimultaneousPositions: 10,
      maxTotalDeployed: 1000,
      consecutiveLossHalt: 5,
      dailyPnlHalt: -100,
      maxArbExecutionsPerHour: 20,
    };

    const enforced = enforceHardCeilings(withinLimits);
    expect(enforced).toEqual(withinLimits);
  });

  it('hard ceilings have correct values per spec', () => {
    expect(HARD_CEILINGS.maxPerTrade).toBe(500);
    expect(HARD_CEILINGS.maxDailyNewTrades).toBe(1000);
    expect(HARD_CEILINGS.maxSimultaneousPositions).toBe(25);
    expect(HARD_CEILINGS.maxTotalDeployed).toBe(5000);
    expect(HARD_CEILINGS.consecutiveLossHalt).toBe(10);
    expect(HARD_CEILINGS.dailyPnlHalt).toBe(-500);
    expect(HARD_CEILINGS.maxArbExecutionsPerHour).toBe(50);
  });
});
