/**
 * PortfolioAllocator — position sizing with category budgets and portfolio constraints.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

interface AllocationResult {
  positionSize: number;       // dollars to allocate
  approved: boolean;
  reason: string;
  categoryBudgetUsed: number; // pct of category budget used after this trade
}

// Default category budgets (can be overridden in SystemConfig)
const DEFAULT_BUDGETS: Record<string, number> = {
  CRYPTO_SPEED: 0.30,
  POLITICS: 0.15,
  SPORTS: 0.20,
  FINANCE: 0.15,
  CRYPTO: 0.10,  // research crypto
  OTHER: 0.10,
};

export async function allocatePosition(params: {
  category: string;
  mode: 'RESEARCH' | 'SPEED';
  kellySize: number;
  totalBankroll: number;
}): Promise<AllocationResult> {
  const { category, mode, kellySize, totalBankroll } = params;

  // Get budgets from DB or use defaults
  const budgetKey = mode === 'SPEED' && category === 'CRYPTO' ? 'CRYPTO_SPEED' : category;
  const budget = await prisma.categoryBudget.findUnique({ where: { category: budgetKey } });

  const budgetPct = budget?.budgetPct ?? DEFAULT_BUDGETS[budgetKey] ?? 0.10;
  const deployed = budget?.deployedAmount ?? 0;
  const maxForCategory = totalBankroll * budgetPct;
  const remaining = maxForCategory - deployed;

  if (remaining <= 0) {
    return { positionSize: 0, approved: false, reason: `Category ${budgetKey} budget exhausted ($${deployed.toFixed(0)}/$${maxForCategory.toFixed(0)})`, categoryBudgetUsed: 1 };
  }

  // Position size = min(Kelly suggestion, category remaining, hard per-trade limit)
  const kellyDollars = kellySize * totalBankroll;
  const perTradeLimit = 10; // $10 default, matches TRADEX risk limit
  const positionSize = Math.min(kellyDollars, remaining, perTradeLimit);

  if (positionSize < 1) {
    return { positionSize: 0, approved: false, reason: `Position too small ($${positionSize.toFixed(2)})`, categoryBudgetUsed: deployed / maxForCategory };
  }

  return {
    positionSize,
    approved: true,
    reason: `Allocated $${positionSize.toFixed(2)} (${budgetKey}: $${(deployed + positionSize).toFixed(0)}/$${maxForCategory.toFixed(0)})`,
    categoryBudgetUsed: (deployed + positionSize) / maxForCategory,
  };
}

/**
 * Get portfolio allocation summary for dashboard.
 */
export async function getAllocationSummary(totalBankroll: number) {
  const budgets = await prisma.categoryBudget.findMany();
  const defaultEntries = Object.entries(DEFAULT_BUDGETS);

  const summary = defaultEntries.map(([cat, defaultPct]) => {
    const db = budgets.find(b => b.category === cat);
    return {
      category: cat,
      budgetPct: db?.budgetPct ?? defaultPct,
      budgetDollars: (db?.budgetPct ?? defaultPct) * totalBankroll,
      deployed: db?.deployedAmount ?? 0,
      utilization: db ? db.deployedAmount / ((db.budgetPct ?? defaultPct) * totalBankroll) : 0,
    };
  });

  return summary;
}
