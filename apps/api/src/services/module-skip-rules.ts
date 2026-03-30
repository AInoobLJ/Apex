/**
 * Module Skip Rules — Cost-efficient signal generation.
 *
 * Prevents LLM modules from running on market types where they can't
 * contribute meaningful signal. Bracket markets resolve on numeric
 * thresholds (price feeds, scores), not subjective criteria, so
 * LEGEX (contract ambiguity) wastes LLM spend on them.
 *
 * ALTEX runs on ALL categories — news drives crypto prices (Fed announcements,
 * exchange hacks, regulatory actions can swing BTC 5-10% in minutes).
 *
 * Quantitative modules (COGEX, FLOWEX, SPEEDEX, ARBEX) run on everything.
 */
import type { ModuleId } from '@apex/shared';
import { logger } from '../lib/logger';

// ── Bracket Detection ──

// Title patterns that indicate a bracket/range market resolving on a numeric feed.
// These markets have zero resolution ambiguity — a price feed determines the outcome.
const BRACKET_TITLE_PATTERNS = [
  /\$[\d,.]+[\s-]+\$[\d,.]+/,          // "$2,030-$2,070" or "$2,030 - $2,070"
  /\bprice\b.*\b(at|range|between)\b/i, // "price at", "price range", "price between"
  /\bbetween\b.*\$[\d,.]+/i,            // "between $60,000 and $61,000"
  /\b(above|below|over|under)\b.*\$[\d,.]+/i, // "above $60,000" (floor/ceiling markets)
  /\b(higher|lower)\s+than\b.*\$[\d,.]+/i,
];

// Crypto assets appearing in bracket market titles
const CRYPTO_ASSETS = /\b(bitcoin|btc|ethereum|eth|solana|sol|ripple|xrp|dogecoin|doge|bnb|hype)\b/i;

export function isBracketMarket(title: string): boolean {
  return BRACKET_TITLE_PATTERNS.some(pattern => pattern.test(title));
}

export function isCryptoBracket(title: string, category: string): boolean {
  if (category === 'CRYPTO' && isBracketMarket(title)) return true;
  // Also catch crypto price markets by asset name + price pattern
  if (CRYPTO_ASSETS.test(title) && isBracketMarket(title)) return true;
  return false;
}

// ── Skip Rules ──

export interface SkipRule {
  /** Skip when title matches a bracket market pattern */
  bracket?: boolean;
  /** Skip when category AND bracket both match */
  categories?: string[];
  /** Skip when market closes within this many hours */
  maxHoursToClose?: number;
  /** Human-readable reason (logged at debug level) */
  reason: string;
}

/**
 * Skip rules per LLM module. Only LLM modules need skip rules —
 * quantitative modules (COGEX, FLOWEX, SPEEDEX, ARBEX) run on everything.
 */
export const MODULE_SKIP_RULES: Partial<Record<ModuleId, SkipRule[]>> = {
  LEGEX: [
    {
      bracket: true,
      reason: 'Bracket markets resolve on numeric thresholds — no contract ambiguity to analyze',
    },
  ],
  ALTEX: [
    {
      bracket: true,
      maxHoursToClose: 24,
      reason: 'Short-duration bracket — no news impact on sub-24h price ranges',
    },
  ],
};

export interface SkipResult {
  skipped: boolean;
  reason?: string;
}

/**
 * Check whether a module should be skipped for a given market.
 * Returns { skipped: false } if no skip rule matches.
 */
export function shouldSkipModule(
  moduleId: ModuleId,
  market: { title: string; category: string; closesAt?: Date | null },
): SkipResult {
  const rules = MODULE_SKIP_RULES[moduleId];
  if (!rules) return { skipped: false };

  const bracket = isBracketMarket(market.title);
  const hoursToClose = market.closesAt
    ? (market.closesAt.getTime() - Date.now()) / 3600000
    : Infinity;

  for (const rule of rules) {
    // All conditions in a rule must match for the rule to fire
    const bracketMatch = rule.bracket ? bracket : true;
    const categoryMatch = rule.categories ? rule.categories.includes(market.category) : true;
    const hoursMatch = rule.maxHoursToClose != null ? hoursToClose <= rule.maxHoursToClose : true;

    // At least one condition must be specified (not just all defaults)
    const hasCondition = rule.bracket || rule.categories || rule.maxHoursToClose != null;

    if (hasCondition && bracketMatch && categoryMatch && hoursMatch) {
      return { skipped: true, reason: rule.reason };
    }
  }

  return { skipped: false };
}

// ── Cycle Metrics ──

export interface SkipMetrics {
  totalSkips: number;
  byModule: Record<string, number>;
  estimatedLLMCallsSaved: number;
}

export function createSkipTracker(): {
  recordSkip: (moduleId: string, marketId: string, reason: string) => void;
  getMetrics: () => SkipMetrics;
} {
  const skips: Record<string, number> = {};
  let totalSkips = 0;

  return {
    recordSkip(moduleId: string, marketId: string, reason: string) {
      skips[moduleId] = (skips[moduleId] || 0) + 1;
      totalSkips++;
      logger.debug({ moduleId, marketId, reason }, `Skipping ${moduleId} — ${reason}`);
    },
    getMetrics(): SkipMetrics {
      // LEGEX uses 2 LLM calls per market (screen + analysis), ALTEX uses 1
      const legexSaved = (skips['LEGEX'] || 0) * 2;
      const altexSaved = skips['ALTEX'] || 0;
      return {
        totalSkips,
        byModule: { ...skips },
        estimatedLLMCallsSaved: legexSaved + altexSaved,
      };
    },
  };
}
