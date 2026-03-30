import type { PreflightResult, RiskLimitConfig, ConcentrationLimits, PositionSnapshot, BracketPosition, BracketConflictContext } from './types';
import { DEFAULT_CONCENTRATION_LIMITS } from './types';
import { checkBracketConflict } from './bracket-detection';
import type { BaseExecutor } from './executors/base';
import type { Platform } from '@apex/shared';

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
  /** Market close time — used by MARKET_OPEN gate */
  marketClosesAt?: Date;
  /** Market status — used by MARKET_OPEN gate */
  marketStatus?: string;
  /** Concentration check context (optional — skipped if not provided) */
  concentration?: {
    /** Platform for this trade */
    platform: Platform;
    /** Category for this trade's market */
    category: string;
    /** Market ID for this trade */
    marketId: string;
    /** All currently open positions */
    positions: PositionSnapshot[];
    /** Total portfolio value (balance + deployed) */
    portfolioValue: number;
    /** Concentration limits (defaults used if omitted) */
    limits?: ConcentrationLimits;
  };
  /** Bracket conflict check context (optional — skipped if not provided) */
  bracketConflict?: BracketConflictContext;
  /** Paper mode — relaxes Gate 10 (bracket conflict) to warn-only for data collection */
  paperMode?: boolean;
}

/** Minimum time-to-close buffer: reject markets closing within 5 minutes */
const MARKET_CLOSE_BUFFER_MS = 5 * 60 * 1000;

/**
 * Run all 10 preflight gates. ALL must pass.
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

  // Gate 8: Concentration check — portfolio diversification limits
  if (ctx.concentration) {
    const concResult = checkConcentration(ctx.concentration, ctx.tradeSize);
    if (!concResult.pass) return concResult;
  }

  // Gate 9: Market open check — reject expired or nearly-expired markets
  if (ctx.marketClosesAt) {
    const now = Date.now();
    const closesAtMs = ctx.marketClosesAt.getTime();

    if (ctx.marketStatus && ctx.marketStatus !== 'ACTIVE') {
      return {
        pass: false,
        failedGate: 'MARKET_OPEN',
        reason: `Market status is '${ctx.marketStatus}', expected 'ACTIVE'`,
        details: { marketStatus: ctx.marketStatus },
      };
    }

    if (closesAtMs <= now) {
      return {
        pass: false,
        failedGate: 'MARKET_OPEN',
        reason: `Market already closed at ${ctx.marketClosesAt.toISOString()}`,
        details: { closesAt: ctx.marketClosesAt.toISOString(), now: new Date(now).toISOString() },
      };
    }

    if (closesAtMs - now < MARKET_CLOSE_BUFFER_MS) {
      const minutesLeft = ((closesAtMs - now) / 60_000).toFixed(1);
      return {
        pass: false,
        failedGate: 'MARKET_OPEN',
        reason: `Market closes at ${ctx.marketClosesAt.toISOString()}, only ${minutesLeft}min left (5min buffer required)`,
        details: { closesAt: ctx.marketClosesAt.toISOString(), minutesRemaining: Number(minutesLeft), bufferMinutes: 5 },
      };
    }
  }

  // Gate 10: Bracket conflict — detect mutually exclusive bracket positions
  // Paper mode: warn-only (allows trades for data collection). Live mode: blocks.
  if (ctx.bracketConflict) {
    const bracketResult = checkBracketConflict(
      ctx.bracketConflict.existingBracketPositions,
      ctx.bracketConflict.marketTitle,
      ctx.bracketConflict.proposedEntryPrice,
      ctx.bracketConflict.proposedDirection,
    );

    if (bracketResult.conflict && !ctx.paperMode) {
      return {
        pass: false,
        failedGate: 'BRACKET_CONFLICT',
        reason: bracketResult.reason,
        details: {
          totalCost: bracketResult.totalCost,
          combinedEV: bracketResult.combinedEV,
          bracketCount: bracketResult.bracketCount,
        },
      };
    }
    // In paper mode, conflicts are allowed (data collection) — caller logs the warning
  }

  return { pass: true };
}

// ── Concentration Check ──

/**
 * Checks portfolio concentration limits:
 * 1. Category exposure — no more than maxPerCategory of portfolio in one category
 * 2. Single event exposure — no more than maxPerEvent in one market
 * 3. Platform exposure — no more than maxPerPlatform on one platform
 * 4. Open position count — hard cap on total positions
 */
export function checkConcentration(
  ctx: NonNullable<PreflightContext['concentration']>,
  tradeSize: number,
): PreflightResult {
  const limits = ctx.limits ?? DEFAULT_CONCENTRATION_LIMITS;
  const portfolioValue = ctx.portfolioValue;

  // Avoid division by zero
  if (portfolioValue <= 0) {
    return { pass: true }; // can't check ratios without portfolio value
  }

  const tradeNotional = tradeSize;

  // Check 1: Category exposure
  const categoryExposure = ctx.positions
    .filter(p => p.category === ctx.category)
    .reduce((sum, p) => sum + p.notional, 0);

  if ((categoryExposure + tradeNotional) / portfolioValue > limits.maxPerCategory) {
    return {
      pass: false,
      failedGate: 'CONCENTRATION',
      reason: `Category '${ctx.category}' would reach ${(((categoryExposure + tradeNotional) / portfolioValue) * 100).toFixed(1)}%, exceeding ${limits.maxPerCategory * 100}% limit`,
      details: {
        category: ctx.category,
        currentExposure: categoryExposure,
        tradeNotional,
        portfolioValue,
        limitPct: limits.maxPerCategory * 100,
        wouldBePct: ((categoryExposure + tradeNotional) / portfolioValue) * 100,
      },
    };
  }

  // Check 2: Single event/market exposure
  const eventExposure = ctx.positions
    .filter(p => p.marketId === ctx.marketId)
    .reduce((sum, p) => sum + p.notional, 0);

  if ((eventExposure + tradeNotional) / portfolioValue > limits.maxPerEvent) {
    return {
      pass: false,
      failedGate: 'CONCENTRATION',
      reason: `Market '${ctx.marketId}' would reach ${(((eventExposure + tradeNotional) / portfolioValue) * 100).toFixed(1)}%, exceeding ${limits.maxPerEvent * 100}% limit`,
      details: {
        marketId: ctx.marketId,
        currentExposure: eventExposure,
        tradeNotional,
        portfolioValue,
        limitPct: limits.maxPerEvent * 100,
        wouldBePct: ((eventExposure + tradeNotional) / portfolioValue) * 100,
      },
    };
  }

  // Check 3: Platform exposure
  const platformExposure = ctx.positions
    .filter(p => p.platform === ctx.platform)
    .reduce((sum, p) => sum + p.notional, 0);

  if ((platformExposure + tradeNotional) / portfolioValue > limits.maxPerPlatform) {
    return {
      pass: false,
      failedGate: 'CONCENTRATION',
      reason: `Platform '${ctx.platform}' would reach ${(((platformExposure + tradeNotional) / portfolioValue) * 100).toFixed(1)}%, exceeding ${limits.maxPerPlatform * 100}% limit`,
      details: {
        platform: ctx.platform,
        currentExposure: platformExposure,
        tradeNotional,
        portfolioValue,
        limitPct: limits.maxPerPlatform * 100,
        wouldBePct: ((platformExposure + tradeNotional) / portfolioValue) * 100,
      },
    };
  }

  // Check 4: Total open positions hard cap
  if (ctx.positions.length >= limits.maxOpenPositions) {
    return {
      pass: false,
      failedGate: 'CONCENTRATION',
      reason: `Would exceed max open positions: ${ctx.positions.length} >= ${limits.maxOpenPositions}`,
      details: { openPositions: ctx.positions.length, maxOpenPositions: limits.maxOpenPositions },
    };
  }

  return { pass: true };
}
