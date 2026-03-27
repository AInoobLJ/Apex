import { MarketCategory } from '@apex/db';

// Map platform-provided category strings to our MarketCategory enum.
// Both Kalshi (event.category) and Polymarket (market.category) provide these.
const PLATFORM_CATEGORY_MAP: Record<string, MarketCategory> = {
  // Kalshi event categories
  'elections': 'POLITICS',
  'politics': 'POLITICS',
  'world': 'POLITICS',
  'financials': 'FINANCE',
  'economics': 'FINANCE',
  'crypto': 'CRYPTO',
  'science and technology': 'SCIENCE',
  'climate and weather': 'SCIENCE',
  'entertainment': 'CULTURE',
  'social': 'CULTURE',
  'sports': 'SPORTS',
  // Polymarket categories
  'us-current-affairs': 'POLITICS',
  'pop-culture': 'CULTURE',
  'pop-culture ': 'CULTURE', // Polymarket has trailing space
  'tech': 'SCIENCE',
  'coronavirus': 'SCIENCE',
  'nfts': 'CRYPTO',
  'nba playoffs': 'SPORTS',
  'olympics': 'SPORTS',
  'business': 'FINANCE',
  'science': 'SCIENCE',
};

/**
 * Detect market category from platform-provided category, title, and description.
 *
 * Priority:
 * 1. Platform-provided category (Kalshi event.category, Polymarket market.category)
 * 2. Title + description keyword matching (fallback)
 *
 * @param title Market title
 * @param description Market description
 * @param platformCategory Category string from the platform's API (preferred)
 */
export function detectCategory(title: string, description?: string | null, platformCategory?: string): MarketCategory {
  // Tier 1: Platform-provided category (strongest signal — the platform knows its own markets)
  if (platformCategory) {
    const mapped = PLATFORM_CATEGORY_MAP[platformCategory.toLowerCase().trim()];
    if (mapped) return mapped;
  }

  // Tier 2: Title + description keyword detection (fallback for missing/unmapped platform categories)
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // Sports detection first — catches player stats patterns like "Murray: 1+", "Jokić: 10+", team names
  if (/\b(nfl|nba|mlb|nhl|world cup|super bowl|championship|playoff|series|ufc|boxing|tennis|golf|olympics|pga|ncaa|march madness|epl|la liga|champions league|serie a|bundesliga|premier league|mls)\b/.test(text)) return 'SPORTS';
  if (/\b(win|wins|score|scored|points|goals|assists|rebounds|yards|touchdowns|strikeouts|saves|knockout)\b.*\b(by over|under|over \d|: \d)/i.test(text)) return 'SPORTS';
  if (/\b(ducks|hurricanes|avalanche|bruins|sharks|lakers|celtics|warriors|nuggets|knicks|cavaliers|clippers|manchester united|manchester city|liverpool|arsenal|chelsea|barcelona|real madrid|bayern|juventus|psg)\b/i.test(text)) return 'SPORTS';
  if (/\b(rookie of the year|mvp|dpoy|sixth man|all.star|draft pick|free agent|transfer window|top \d.*standings|finish in.*top \d)\b/i.test(text)) return 'SPORTS';

  if (/\b(election|president|senate|congress|governor|democrat|republican|biden|trump|vote|poll|inaugur|primary|gop|dnc|rnc|mayor|ballot|pope|nominee|nomination|prime minister|parliamentary)\b/.test(text)) return 'POLITICS';
  if (/\b(fed|fomc|rate cut|rate hike|inflation|gdp|unemployment|treasury|nasdaq|s&p|stock|recession|cpi|pce|bls|labor|payroll|dow|russell|tariff)\b/.test(text)) return 'FINANCE';
  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|blockchain|token|nft|solana|sol|cardano|ripple|xrp|binance|coinbase|halving|stablecoin)\b/.test(text)) return 'CRYPTO';
  if (/\b(climate|temperature|hurricane|earthquake|space|nasa|vaccine|virus|pandemic|study|research|science|ai model|artificial intelligence|supervolcano|mars)\b/.test(text)) return 'SCIENCE';
  if (/\b(oscar|grammy|emmy|box office|movie|album|celebrity|tiktok|youtube|spotify|streaming|tv show|netflix)\b/.test(text)) return 'CULTURE';
  return 'OTHER';
}
