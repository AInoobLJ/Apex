/**
 * PortfolioAllocator — position sizing based on portfolio constraints and category budgets.
 *
 * Manages: daily capital budget per category, max position size, max simultaneous positions,
 * max total deployed, correlation-adjusted exposure.
 */

export interface CategoryBudget {
  category: string;
  budgetPct: number;      // % of total capital allocated to this category
  deployed: number;        // $ currently deployed
  budgetAmount: number;    // $ budget for this category
  remaining: number;       // $ remaining in budget
  positionCount: number;   // active positions in this category
}

export interface AllocationDecision {
  approved: boolean;
  positionSize: number;    // $ to deploy
  reason: string;
  categoryBudget: CategoryBudget;
}

export interface PortfolioState {
  totalCapital: number;
  totalDeployed: number;
  totalRemaining: number;
  dailyNewTradesAmount: number;
  dailyNewTradesCap: number;
  simultaneousPositions: number;
  maxSimultaneousPositions: number;
  categoryBudgets: CategoryBudget[];
}

// Default category allocations (configurable via SystemConfig)
const DEFAULT_ALLOCATIONS: Record<string, number> = {
  CRYPTO: 0.30,         // crypto speed trades
  POLITICS: 0.15,
  SPORTS: 0.20,
  FINANCE: 0.15,
  OTHER: 0.10,
  SCIENCE: 0.05,
  ENTERTAINMENT: 0.05,
};

// Hard limits (from TRADEX risk config)
const DEFAULTS = {
  maxPerTrade: 10,            // $ per position
  maxDailyNewTrades: 30,      // $ per day in new trades
  maxSimultaneous: 5,          // max open positions
  maxTotalDeployed: 100,       // $ total across all positions
  totalCapital: 200,           // total paper capital
};

let currentState: PortfolioState = {
  totalCapital: DEFAULTS.totalCapital,
  totalDeployed: 0,
  totalRemaining: DEFAULTS.totalCapital,
  dailyNewTradesAmount: 0,
  dailyNewTradesCap: DEFAULTS.maxDailyNewTrades,
  simultaneousPositions: 0,
  maxSimultaneousPositions: DEFAULTS.maxSimultaneous,
  categoryBudgets: Object.entries(DEFAULT_ALLOCATIONS).map(([category, pct]) => ({
    category,
    budgetPct: pct,
    deployed: 0,
    budgetAmount: DEFAULTS.totalCapital * pct,
    remaining: DEFAULTS.totalCapital * pct,
    positionCount: 0,
  })),
};

/**
 * Request allocation for a new position.
 */
export function requestAllocation(
  category: string,
  kellySize: number,       // suggested size from Kelly criterion
  edgeMagnitude: number,
  confidence: number,
): AllocationDecision {
  const state = currentState;

  // Find category budget
  let catBudget = state.categoryBudgets.find(b => b.category === category);
  if (!catBudget) {
    // Default to OTHER
    catBudget = state.categoryBudgets.find(b => b.category === 'OTHER')!;
  }

  // Check global constraints
  if (state.simultaneousPositions >= state.maxSimultaneousPositions) {
    return { approved: false, positionSize: 0, reason: `Max ${state.maxSimultaneousPositions} simultaneous positions reached`, categoryBudget: catBudget };
  }

  if (state.dailyNewTradesAmount >= state.dailyNewTradesCap) {
    return { approved: false, positionSize: 0, reason: `Daily new trade cap $${state.dailyNewTradesCap} reached`, categoryBudget: catBudget };
  }

  if (state.totalDeployed >= DEFAULTS.maxTotalDeployed) {
    return { approved: false, positionSize: 0, reason: `Max total deployed $${DEFAULTS.maxTotalDeployed} reached`, categoryBudget: catBudget };
  }

  // Check category budget
  if (catBudget.remaining <= 0) {
    return { approved: false, positionSize: 0, reason: `${category} budget exhausted ($${catBudget.budgetAmount})`, categoryBudget: catBudget };
  }

  // Calculate position size: min(Kelly, maxPerTrade, remaining budget, remaining daily cap)
  const size = Math.min(
    kellySize * state.totalCapital,
    DEFAULTS.maxPerTrade,
    catBudget.remaining,
    state.dailyNewTradesCap - state.dailyNewTradesAmount,
    DEFAULTS.maxTotalDeployed - state.totalDeployed,
  );

  if (size < 1) { // minimum $1 position
    return { approved: false, positionSize: 0, reason: 'Position size below $1 minimum', categoryBudget: catBudget };
  }

  return {
    approved: true,
    positionSize: Math.floor(size * 100) / 100, // round to cents
    reason: `Allocated $${size.toFixed(2)} in ${category} (${(catBudget.deployed / catBudget.budgetAmount * 100).toFixed(0)}% of budget used)`,
    categoryBudget: catBudget,
  };
}

/**
 * Record a new position (updates state).
 */
export function recordPosition(category: string, size: number): void {
  currentState.totalDeployed += size;
  currentState.totalRemaining -= size;
  currentState.dailyNewTradesAmount += size;
  currentState.simultaneousPositions++;

  const catBudget = currentState.categoryBudgets.find(b => b.category === category)
    || currentState.categoryBudgets.find(b => b.category === 'OTHER')!;
  catBudget.deployed += size;
  catBudget.remaining -= size;
  catBudget.positionCount++;
}

/**
 * Close a position (updates state).
 */
export function closePosition(category: string, size: number, pnl: number): void {
  currentState.totalDeployed -= size;
  currentState.totalRemaining += size + pnl;
  currentState.totalCapital += pnl;
  currentState.simultaneousPositions = Math.max(0, currentState.simultaneousPositions - 1);

  const catBudget = currentState.categoryBudgets.find(b => b.category === category)
    || currentState.categoryBudgets.find(b => b.category === 'OTHER')!;
  catBudget.deployed -= size;
  catBudget.remaining += size;
  catBudget.positionCount = Math.max(0, catBudget.positionCount - 1);
}

/**
 * Reset daily counters (called at midnight).
 */
export function resetDaily(): void {
  currentState.dailyNewTradesAmount = 0;
}

/**
 * Get current portfolio state for dashboard.
 */
export function getPortfolioState(): PortfolioState {
  return { ...currentState };
}

/**
 * Update allocation percentages from SystemConfig.
 */
export function updateAllocations(allocations: Record<string, number>, totalCapital?: number): void {
  if (totalCapital) currentState.totalCapital = totalCapital;

  for (const [category, pct] of Object.entries(allocations)) {
    const existing = currentState.categoryBudgets.find(b => b.category === category);
    if (existing) {
      existing.budgetPct = pct;
      existing.budgetAmount = currentState.totalCapital * pct;
      existing.remaining = existing.budgetAmount - existing.deployed;
    } else {
      currentState.categoryBudgets.push({
        category,
        budgetPct: pct,
        deployed: 0,
        budgetAmount: currentState.totalCapital * pct,
        remaining: currentState.totalCapital * pct,
        positionCount: 0,
      });
    }
  }
}
