import { prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import { logger } from '../lib/logger';

const SYSTEM_CONFIG_KEY = 'llm_daily_budget';
const DEFAULT_DAILY_BUDGET = 5.00;  // $5/day default — research mode
const HARD_LIMIT = 5.00;            // $5/day HARD KILL — no exceptions
const ALERT_THRESHOLD = 0.80;       // 80% = alert
const THROTTLE_50_THRESHOLD = 0.50; // 50% = reduce to 50 calls/hr
const THROTTLE_80_THRESHOLD = 0.80; // 80% = reduce to 10 calls/hr

interface LLMBudgetConfig {
  dailyBudget: number;
  todaySpend: number;
  lastResetDate: string; // YYYY-MM-DD
}

// ── In-memory fast path for budget check (avoid DB hit on every call) ──
let cachedSpend = 0;
let cachedBudget = HARD_LIMIT;
let cachedDate = '';
let callsThisHour = 0;
let currentHour = new Date().getHours();

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function toJsonValue(obj: LLMBudgetConfig): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check hourly call count — reset if hour changed
 */
function checkHourlyReset(): void {
  const now = new Date().getHours();
  if (now !== currentHour) {
    callsThisHour = 0;
    currentHour = now;
  }
}

/**
 * HARD BUDGET CHECK — must be called BEFORE every Claude call.
 * Returns false if the call should be BLOCKED.
 *
 * Uses in-memory cache for speed — only hits DB every 50 calls.
 */
export function shouldAllowCall(task: string): { allowed: boolean; reason?: string } {
  const today = getTodayDate();
  if (today !== cachedDate) {
    cachedSpend = 0;
    cachedDate = today;
    callsThisHour = 0;
  }

  // HARD KILL: if daily spend >= $20, block ALL calls
  if (cachedSpend >= HARD_LIMIT) {
    return { allowed: false, reason: `HARD LIMIT: daily spend $${cachedSpend.toFixed(2)} >= $${HARD_LIMIT} limit` };
  }

  checkHourlyReset();

  // Adaptive rate limiting based on budget consumption
  const percentUsed = cachedBudget > 0 ? cachedSpend / cachedBudget : 0;

  let maxCallsPerHour: number;
  if (percentUsed >= THROTTLE_80_THRESHOLD) {
    maxCallsPerHour = 10; // Critical: only alerts
  } else if (percentUsed >= THROTTLE_50_THRESHOLD) {
    maxCallsPerHour = 50; // Reduced
  } else {
    maxCallsPerHour = 100; // Normal
  }

  if (callsThisHour >= maxCallsPerHour) {
    return {
      allowed: false,
      reason: `RATE LIMIT: ${callsThisHour}/${maxCallsPerHour} calls/hr (budget ${(percentUsed * 100).toFixed(0)}% used)`,
    };
  }

  callsThisHour++;
  return { allowed: true };
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

  // Sync in-memory cache
  cachedSpend = budgetConfig.todaySpend;
  cachedBudget = budgetConfig.dailyBudget;
  cachedDate = today;

  return budgetConfig;
}

export async function recordLLMSpend(cost: number): Promise<{ remaining: number; overBudget: boolean; alertTriggered: boolean }> {
  // Update in-memory cache immediately
  cachedSpend += cost;

  const config = await getBudgetConfig();
  config.todaySpend += cost;

  await prisma.systemConfig.update({
    where: { key: SYSTEM_CONFIG_KEY },
    data: { value: toJsonValue(config) },
  });

  // Sync cached value from DB (canonical)
  cachedSpend = config.todaySpend;

  const remaining = config.dailyBudget - config.todaySpend;
  const percentUsed = config.todaySpend / config.dailyBudget;
  const alertTriggered = percentUsed >= ALERT_THRESHOLD;
  const overBudget = config.todaySpend >= HARD_LIMIT;

  if (overBudget) {
    logger.error({
      todaySpend: config.todaySpend.toFixed(4),
      hardLimit: HARD_LIMIT,
      dailyBudget: config.dailyBudget,
    }, '🚨 LLM HARD LIMIT HIT — all future calls blocked until midnight');
  } else if (alertTriggered) {
    logger.warn({
      todaySpend: config.todaySpend.toFixed(4),
      dailyBudget: config.dailyBudget,
      percentUsed: Math.round(percentUsed * 100),
      callsThisHour,
    }, 'LLM budget alert: 80% consumed — throttled to 10 calls/hr');
  }

  return { remaining, overBudget, alertTriggered };
}

export async function getLLMBudgetStatus(): Promise<{
  dailyBudget: number;
  todaySpend: number;
  remaining: number;
  percentUsed: number;
  hardLimit: number;
  callsThisHour: number;
  maxCallsPerHour: number;
}> {
  const config = await getBudgetConfig();
  const remaining = config.dailyBudget - config.todaySpend;
  const percentUsed = config.dailyBudget > 0 ? config.todaySpend / config.dailyBudget : 0;

  let maxCallsPerHour = 100;
  if (percentUsed >= THROTTLE_80_THRESHOLD) maxCallsPerHour = 10;
  else if (percentUsed >= THROTTLE_50_THRESHOLD) maxCallsPerHour = 50;

  return {
    dailyBudget: config.dailyBudget,
    todaySpend: config.todaySpend,
    remaining,
    percentUsed: Math.round(percentUsed * 100),
    hardLimit: HARD_LIMIT,
    callsThisHour,
    maxCallsPerHour,
  };
}

export async function setLLMDailyBudget(budget: number): Promise<void> {
  const config = await getBudgetConfig();
  config.dailyBudget = budget;

  await prisma.systemConfig.update({
    where: { key: SYSTEM_CONFIG_KEY },
    data: { value: toJsonValue(config) },
  });

  cachedBudget = budget;
  logger.info({ newBudget: budget }, 'LLM daily budget updated');
}

/**
 * Initialize budget tracker — call on worker startup to sync from DB.
 */
export async function initBudgetTracker(): Promise<void> {
  await getBudgetConfig();
  logger.info({
    cachedSpend: cachedSpend.toFixed(4),
    hardLimit: HARD_LIMIT,
    cachedBudget,
  }, 'LLM budget tracker initialized');
}
