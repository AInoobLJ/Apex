/**
 * Shared date context for LLM module prompts.
 * Ensures models reason about current dates, not training data dates.
 */

export function getDateContext(): string {
  const now = new Date();
  return `Today's date is ${now.toISOString().split('T')[0]}. The current year is ${now.getFullYear()}. All analysis must be based on the current date, not historical events from your training data.`;
}

export function getMarketDateContext(closesAt: Date | null | undefined): string {
  if (!closesAt) return 'Resolution date: Not specified.';
  const now = new Date();
  const daysUntil = Math.max(0, Math.ceil((closesAt.getTime() - now.getTime()) / 86400000));
  const dateStr = closesAt.toISOString().split('T')[0];
  if (daysUntil <= 0) return `This market was scheduled to resolve on ${dateStr} (already past).`;
  return `This market resolves on ${dateStr}. That is ${daysUntil} day${daysUntil === 1 ? '' : 's'} from now.`;
}

/**
 * Check LLM response for stale year references.
 * Returns a confidence penalty multiplier (0.5 if stale, 1.0 if fine).
 */
export function checkDateStaleness(text: string): { isStale: boolean; penalty: number; staleYears: number[] } {
  const currentYear = new Date().getFullYear();
  // Match 4-digit years in text
  const yearMatches = text.match(/\b(20[0-9]{2})\b/g);
  if (!yearMatches) return { isStale: false, penalty: 1.0, staleYears: [] };

  const staleYears = [...new Set(yearMatches.map(Number).filter(y => y < currentYear))];

  // Only flag if stale years appear WITHOUT current year context
  const hasCurrentYear = yearMatches.some(y => Number(y) >= currentYear);
  if (hasCurrentYear || staleYears.length === 0) {
    return { isStale: false, penalty: 1.0, staleYears: [] };
  }

  // All year references are pre-current-year — likely stale reasoning
  return { isStale: true, penalty: 0.5, staleYears };
}
