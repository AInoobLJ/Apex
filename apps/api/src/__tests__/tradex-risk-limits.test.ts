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
      maxPerTrade: 999999,
      maxDailyNewTrades: 999999,
      maxSimultaneousPositions: 999999,
      maxTotalDeployed: 999999,
      consecutiveLossHalt: 999,
      dailyPnlHalt: -999999,
      maxArbExecutionsPerHour: 999,
    };

    const enforced = enforceHardCeilings(overLimit);
    expect(enforced.maxPerTrade).toBe(HARD_CEILINGS.maxPerTrade);
    expect(enforced.maxDailyNewTrades).toBe(HARD_CEILINGS.maxDailyNewTrades);
    expect(enforced.maxSimultaneousPositions).toBe(HARD_CEILINGS.maxSimultaneousPositions);
    expect(enforced.maxTotalDeployed).toBe(HARD_CEILINGS.maxTotalDeployed);
    expect(enforced.consecutiveLossHalt).toBe(HARD_CEILINGS.consecutiveLossHalt);
    expect(enforced.dailyPnlHalt).toBe(HARD_CEILINGS.dailyPnlHalt);
    expect(enforced.maxArbExecutionsPerHour).toBe(HARD_CEILINGS.maxArbExecutionsPerHour);
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

  it('hard ceilings are >= defaults (defaults must fit within ceilings)', () => {
    expect(HARD_CEILINGS.maxPerTrade).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.maxPerTrade);
    expect(HARD_CEILINGS.maxDailyNewTrades).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.maxDailyNewTrades);
    expect(HARD_CEILINGS.maxSimultaneousPositions).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.maxSimultaneousPositions);
    expect(HARD_CEILINGS.maxTotalDeployed).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.maxTotalDeployed);
    expect(HARD_CEILINGS.consecutiveLossHalt).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.consecutiveLossHalt);
    // dailyPnlHalt is negative — ceiling is more negative (more permissive)
    expect(HARD_CEILINGS.dailyPnlHalt).toBeLessThanOrEqual(DEFAULT_RISK_LIMITS.dailyPnlHalt);
    expect(HARD_CEILINGS.maxArbExecutionsPerHour).toBeGreaterThanOrEqual(DEFAULT_RISK_LIMITS.maxArbExecutionsPerHour);
  });
});
