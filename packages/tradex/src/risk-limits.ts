import type { RiskLimitConfig } from './types';
import { DEFAULT_RISK_LIMITS, HARD_CEILINGS } from './types';

const SYSTEM_CONFIG_KEY = 'tradex_risk_limits';

/**
 * Enforce hard ceilings on risk limit values.
 * Any value exceeding the ceiling is clamped.
 */
export function enforceHardCeilings(limits: RiskLimitConfig): RiskLimitConfig {
  return {
    maxPerTrade: Math.min(limits.maxPerTrade, HARD_CEILINGS.maxPerTrade),
    maxDailyNewTrades: Math.min(limits.maxDailyNewTrades, HARD_CEILINGS.maxDailyNewTrades),
    maxSimultaneousPositions: Math.min(limits.maxSimultaneousPositions, HARD_CEILINGS.maxSimultaneousPositions),
    maxTotalDeployed: Math.min(limits.maxTotalDeployed, HARD_CEILINGS.maxTotalDeployed),
    consecutiveLossHalt: Math.min(limits.consecutiveLossHalt, HARD_CEILINGS.consecutiveLossHalt),
    // dailyPnlHalt is negative — more negative = more lenient, so use max (closest to 0)
    dailyPnlHalt: Math.max(limits.dailyPnlHalt, HARD_CEILINGS.dailyPnlHalt),
    maxArbExecutionsPerHour: Math.min(limits.maxArbExecutionsPerHour, HARD_CEILINGS.maxArbExecutionsPerHour),
  };
}

/**
 * Load risk limits from SystemConfig (via provided getter).
 * Falls back to defaults if not found.
 */
export async function loadRiskLimits(
  getConfig: (key: string) => Promise<unknown | null>
): Promise<RiskLimitConfig> {
  const stored = await getConfig(SYSTEM_CONFIG_KEY);

  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_RISK_LIMITS };
  }

  const limits = { ...DEFAULT_RISK_LIMITS, ...(stored as Partial<RiskLimitConfig>) };
  return enforceHardCeilings(limits);
}

/**
 * Save risk limits to SystemConfig (via provided setter).
 * Enforces hard ceilings before saving.
 */
export async function saveRiskLimits(
  limits: Partial<RiskLimitConfig>,
  getConfig: (key: string) => Promise<unknown | null>,
  setConfig: (key: string, value: unknown) => Promise<void>
): Promise<{ limits: RiskLimitConfig; changes: { setting: string; previousValue: string; newValue: string }[] }> {
  const current = await loadRiskLimits(getConfig);
  const merged = enforceHardCeilings({ ...current, ...limits });
  const changes: { setting: string; previousValue: string; newValue: string }[] = [];

  // Track what changed
  for (const key of Object.keys(merged) as (keyof RiskLimitConfig)[]) {
    if (current[key] !== merged[key]) {
      changes.push({
        setting: key,
        previousValue: String(current[key]),
        newValue: String(merged[key]),
      });
    }
  }

  await setConfig(SYSTEM_CONFIG_KEY, merged);

  return { limits: merged, changes };
}

export { SYSTEM_CONFIG_KEY };
