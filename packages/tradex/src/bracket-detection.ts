import type { BracketPosition, BracketGroup } from './types';

/**
 * Known crypto assets that appear in bracket markets.
 * Used for title-based bracket detection.
 */
const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'HYPE'] as const;

/**
 * Pattern to detect bracket market titles.
 * Matches formats like:
 *   "ETH $1,970-$2,010 MAR 29 5PM"
 *   "BTC $67,050-$67,550 Mar 26 9PM"
 *   "SOL $150-$155 APR 01 12PM"
 */
const BRACKET_TITLE_RE = new RegExp(
  `(${CRYPTO_ASSETS.join('|')})\\s+\\$[\\d,.]+\\s*-\\s*\\$[\\d,.]+\\s+(\\w{3}\\s+\\d{1,2}\\s+\\d{1,2}(?:AM|PM))`,
  'i',
);

/**
 * Extract asset and expiry from a bracket market title.
 * Returns null if the title is not a bracket market.
 */
export function parseBracketTitle(title: string): { asset: string; expiry: string; expiryDisplay: string } | null {
  const match = title.match(BRACKET_TITLE_RE);
  if (!match) return null;

  const asset = match[1].toUpperCase();
  const expiryDisplay = match[2].toUpperCase();
  // Normalize expiry for grouping: strip spaces, uppercase
  const expiry = expiryDisplay.replace(/\s+/g, '');

  return { asset, expiry, expiryDisplay };
}

/**
 * Group open bracket positions by asset + expiry.
 * Each group contains mutually exclusive positions (only one bracket can win).
 */
export function groupBracketPositions(positions: BracketPosition[]): BracketGroup[] {
  const groups = new Map<string, BracketGroup>();

  for (const pos of positions) {
    const parsed = parseBracketTitle(pos.title);
    if (!parsed) continue;

    const key = `${parsed.asset}:${parsed.expiry}`;
    if (!groups.has(key)) {
      groups.set(key, {
        asset: parsed.asset,
        expiry: parsed.expiry,
        expiryDisplay: parsed.expiryDisplay,
        positions: [],
        totalCost: 0,
        maxPayout: 1.0, // ~100¢ per contract
      });
    }

    const group = groups.get(key)!;
    group.positions.push(pos);
    // Only count BUY_YES positions toward total cost (buying YES on multiple brackets)
    if (pos.direction === 'BUY_YES') {
      group.totalCost += pos.entryPrice;
    }
  }

  return Array.from(groups.values()).filter(g => g.positions.length > 0);
}

/**
 * Check if adding a new bracket position to an existing group is +EV.
 *
 * Logic: if you buy YES on N mutually exclusive brackets, exactly one wins (~$1 payout).
 * Combined EV = maxPayout - totalCost. If totalCost >= maxPayout, you're guaranteed to lose.
 *
 * We also consider that not all brackets are equally likely. If the new bracket's
 * entry price reflects a reasonable probability, the combined portfolio should still
 * have positive expected value: sum(prices) < 1.0 (with margin for fees).
 */
export function checkBracketConflict(
  existingPositions: BracketPosition[],
  proposedTitle: string,
  proposedEntryPrice: number,
  proposedDirection: string,
): {
  conflict: boolean;
  reason: string;
  totalCost: number;
  combinedEV: number;
  bracketCount: number;
} {
  const parsed = parseBracketTitle(proposedTitle);
  if (!parsed) {
    return { conflict: false, reason: 'Not a bracket market', totalCost: 0, combinedEV: 0, bracketCount: 0 };
  }

  // Find existing positions in the same bracket group
  const sameGroup = existingPositions.filter(pos => {
    const p = parseBracketTitle(pos.title);
    return p && p.asset === parsed.asset && p.expiry === parsed.expiry;
  });

  if (sameGroup.length === 0) {
    return { conflict: false, reason: 'No existing bracket positions for this group', totalCost: proposedEntryPrice, combinedEV: 0, bracketCount: 1 };
  }

  // Calculate combined cost (existing BUY_YES + proposed)
  const existingCost = sameGroup
    .filter(p => p.direction === 'BUY_YES')
    .reduce((sum, p) => sum + p.entryPrice, 0);

  const proposedCost = proposedDirection === 'BUY_YES' ? proposedEntryPrice : 0;
  const totalCost = existingCost + proposedCost;
  const bracketCount = sameGroup.length + 1;

  // Max payout is ~$1 (one bracket wins at $1, others at $0)
  const maxPayout = 1.0;
  const combinedEV = maxPayout - totalCost;

  // Block if combined position is -EV (total cost >= max payout)
  // Use a small margin (0.02 = 2¢) to account for fees on the winning bracket
  const FEE_MARGIN = 0.02;
  if (totalCost >= maxPayout - FEE_MARGIN) {
    return {
      conflict: true,
      reason: `Bracket conflict: ${bracketCount} positions on ${parsed.asset} ${parsed.expiryDisplay} brackets. `
        + `Combined cost ${(totalCost * 100).toFixed(1)}¢ >= max payout ${((maxPayout - FEE_MARGIN) * 100).toFixed(1)}¢ (net of fees). `
        + `Only one bracket can win — combined position is -EV.`,
      totalCost,
      combinedEV,
      bracketCount,
    };
  }

  return {
    conflict: false,
    reason: `Adding bracket position to existing group: ${parsed.asset} ${parsed.expiryDisplay}. `
      + `Combined cost: ${(totalCost * 100).toFixed(1)}¢, estimated combined EV: ${(combinedEV * 100).toFixed(1)}¢`,
    totalCost,
    combinedEV,
    bracketCount,
  };
}
