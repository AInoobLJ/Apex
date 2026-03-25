import { prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';

const SYSTEM_CONFIG_KEY = 'llm_daily_budget';
const DEFAULT_DAILY_BUDGET = 5.00; // $5/day default
const ALERT_THRESHOLD = 0.80; // 80%

interface LLMBudgetConfig {
  dailyBudget: number;
  todaySpend: number;
  lastResetDate: string; // YYYY-MM-DD
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toJsonValue(obj: LLMBudgetConfig): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj));
}

async function getBudgetConfig(): Promise<LLMBudgetConfig> {
  const config = await prisma.systemConfig.findUnique({
    where: { key: SYSTEM_CONFIG_KEY },
  });

  const today = getTodayDate();

  if (!config) {
    const defaultConfig: LLMBudgetConfig = {
      dailyBudget: DEFAULT_DAILY_BUDGET,
      todaySpend: 0,
      lastResetDate: today,
    };
    await prisma.systemConfig.create({
      data: { key: SYSTEM_CONFIG_KEY, value: toJsonValue(defaultConfig) },
    });
    return defaultConfig;
  }

  const budgetConfig = config.value as unknown as LLMBudgetConfig;

  // Reset if new day
  if (budgetConfig.lastResetDate !== today) {
    budgetConfig.todaySpend = 0;
    budgetConfig.lastResetDate = today;
    await prisma.systemConfig.update({
      where: { key: SYSTEM_CONFIG_KEY },
      data: { value: toJsonValue(budgetConfig) },
    });
  }

  return budgetConfig;
}

export async function recordLLMSpend(cost: number): Promise<{ remaining: number; overBudget: boolean; alertTriggered: boolean }> {
  const config = await getBudgetConfig();
  config.todaySpend += cost;

  await prisma.systemConfig.update({
    where: { key: SYSTEM_CONFIG_KEY },
    data: { value: toJsonValue(config) },
  });

  const remaining = config.dailyBudget - config.todaySpend;
  const percentUsed = config.todaySpend / config.dailyBudget;
  const alertTriggered = percentUsed >= ALERT_THRESHOLD;
  const overBudget = remaining <= 0;

  if (alertTriggered && !overBudget) {
    logger.warn({
      todaySpend: config.todaySpend,
      dailyBudget: config.dailyBudget,
      percentUsed: Math.round(percentUsed * 100),
    }, 'LLM budget alert: 80% consumed');
  }

  if (overBudget) {
    logger.error({
      todaySpend: config.todaySpend,
      dailyBudget: config.dailyBudget,
    }, 'LLM daily budget exceeded');
  }

  return { remaining, overBudget, alertTriggered };
}

export async function getLLMBudgetStatus(): Promise<{
  dailyBudget: number;
  todaySpend: number;
  remaining: number;
  percentUsed: number;
}> {
  const config = await getBudgetConfig();
  const remaining = config.dailyBudget - config.todaySpend;
  const percentUsed = config.dailyBudget > 0 ? config.todaySpend / config.dailyBudget : 0;

  return {
    dailyBudget: config.dailyBudget,
    todaySpend: config.todaySpend,
    remaining,
    percentUsed: Math.round(percentUsed * 100),
  };
}

export async function setLLMDailyBudget(budget: number): Promise<void> {
  const config = await getBudgetConfig();
  config.dailyBudget = budget;

  await prisma.systemConfig.update({
    where: { key: SYSTEM_CONFIG_KEY },
    data: { value: toJsonValue(config) },
  });

  logger.info({ newBudget: budget }, 'LLM daily budget updated');
}
