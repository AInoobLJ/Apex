import type { PreflightResult, RiskLimitConfig } from './types';
import type { BaseExecutor } from './executors/base';

export interface PreflightContext {
  /** Trade size in dollars */
  tradeSize: number;
  /** Current edge magnitude (re-fetched) */
  currentEdge: number;
  /** Platform fee for this trade */
  fee: number;
  /** Is this edge type graduated from paper? (Phase 5 — pass true until then) */
  graduated: boolean;
  /** Total new trade volume today */
  dailyNewTradeVolume: number;
  /** Number of currently open positions */
  openPositionCount: number;
  /** Risk limits */
  limits: RiskLimitConfig;
  /** Executor for balance check */
  executor: BaseExecutor;
}

/**
 * Run all 7 preflight gates. ALL must pass.
 */
export async function runPreflight(ctx: PreflightContext): Promise<PreflightResult> {
  // Gate 1: Risk gate — position size within limits
  if (ctx.tradeSize > ctx.limits.maxPerTrade) {
    return {
      pass: false,
      failedGate: 'RISK_GATE',
      reason: `Trade size $${ctx.tradeSize} exceeds max per trade $${ctx.limits.maxPerTrade}`,
      details: { tradeSize: ctx.tradeSize, maxPerTrade: ctx.limits.maxPerTrade },
    };
  }

  // Gate 2: Balance check — enough funds on platform
  try {
    const balance = await ctx.executor.getBalance();
    if (balance.available < ctx.tradeSize) {
      return {
        pass: false,
        failedGate: 'BALANCE_CHECK',
        reason: `Insufficient balance: $${balance.available.toFixed(2)} available, need $${ctx.tradeSize}`,
        details: { available: balance.available, needed: ctx.tradeSize },
      };
    }

    // Also check total deployed limit
    if (balance.deployed + ctx.tradeSize > ctx.limits.maxTotalDeployed) {
      return {
        pass: false,
        failedGate: 'BALANCE_CHECK',
        reason: `Would exceed max total deployed: $${(balance.deployed + ctx.tradeSize).toFixed(2)} > $${ctx.limits.maxTotalDeployed}`,
        details: { deployed: balance.deployed, tradeSize: ctx.tradeSize, maxTotalDeployed: ctx.limits.maxTotalDeployed },
      };
    }
  } catch (err) {
    return {
      pass: false,
      failedGate: 'BALANCE_CHECK',
      reason: `Balance check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Gate 3: Edge still valid — re-fetched price, recalculate, still > threshold
  if (ctx.currentEdge <= 0) {
    return {
      pass: false,
      failedGate: 'EDGE_VALID',
      reason: `Edge evaporated: current edge = ${ctx.currentEdge.toFixed(4)}`,
      details: { currentEdge: ctx.currentEdge },
    };
  }

  // Gate 4: Fee check — edge > platform fees
  if (ctx.currentEdge * ctx.tradeSize <= ctx.fee) {
    return {
      pass: false,
      failedGate: 'FEE_CHECK',
      reason: `Edge ($${(ctx.currentEdge * ctx.tradeSize).toFixed(4)}) doesn't cover fee ($${ctx.fee.toFixed(4)})`,
      details: { edgeValue: ctx.currentEdge * ctx.tradeSize, fee: ctx.fee },
    };
  }

  // Gate 5: Graduation check — edge type graduated from paper
  if (!ctx.graduated) {
    return {
      pass: false,
      failedGate: 'GRADUATION_CHECK',
      reason: 'Edge type has not graduated from paper trading',
    };
  }

  // Gate 6: Daily limit check — under daily cap
  if (ctx.dailyNewTradeVolume + ctx.tradeSize > ctx.limits.maxDailyNewTrades) {
    return {
      pass: false,
      failedGate: 'DAILY_LIMIT',
      reason: `Would exceed daily trade limit: $${(ctx.dailyNewTradeVolume + ctx.tradeSize).toFixed(2)} > $${ctx.limits.maxDailyNewTrades}`,
      details: { dailyVolume: ctx.dailyNewTradeVolume, tradeSize: ctx.tradeSize, maxDaily: ctx.limits.maxDailyNewTrades },
    };
  }

  // Gate 7: Position count check — under max simultaneous positions
  if (ctx.openPositionCount >= ctx.limits.maxSimultaneousPositions) {
    return {
      pass: false,
      failedGate: 'POSITION_COUNT',
      reason: `At max positions: ${ctx.openPositionCount} >= ${ctx.limits.maxSimultaneousPositions}`,
      details: { openPositions: ctx.openPositionCount, maxPositions: ctx.limits.maxSimultaneousPositions },
    };
  }

  return { pass: true };
}
