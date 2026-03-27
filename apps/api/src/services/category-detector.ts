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

// ── HIGH-CONFIDENCE keyword patterns ──
// These override EVERYTHING, including platform category, because they are
// unambiguous indicators. "Democratic presidential nomination" is ALWAYS politics,
// even if the platform says "Sports" or "Pop Culture".

const POLITICS_OVERRIDE = /\b(election|president|presidential|senate|congress|senator|governor|democrat|democratic|republican|biden|trump|nomination|nominee|inaugur|primary|gop|dnc|rnc|ballot|impeach|indicted|pardon|veto|executive order|cabinet|supreme court|scotus|parliament|prime minister|speaker of the house|electoral|geopolitical|ceasefire|invasion|sanctions|nato|hezbollah|hamas)\b/i;

const FINANCE_OVERRIDE = /\b(fed\b|fomc|rate cut|rate hike|inflation|gdp|unemployment|treasury|nasdaq|s&p 500|stock market|recession|cpi\b|tariff|interest rate|bond yield|dow jones)\b/i;

const CRYPTO_OVERRIDE = /\b(bitcoin|btc|ethereum|eth|crypto|defi|blockchain|solana|sol\b|cardano|ripple|xrp|binance|coinbase|halving|stablecoin)\b/i;

/**
 * Detect market category from platform-provided category, title, and description.
 *
 * Priority (changed from v1):
 * 1. HIGH-CONFIDENCE keyword override — politics/finance/crypto keywords that are never
 *    ambiguous. "Democratic presidential nomination" → POLITICS regardless of platform tag.
 *    This fixes: "Chelsea Clinton" (person) being tagged SPORTS due to Chelsea FC regex.
 * 2. Platform-provided category (Kalshi event.category, Polymarket market.category)
 * 3. Title + description keyword matching (fallback)
 *
 * @param title Market title
 * @param description Market description
 * @param platformCategory Category string from the platform's API
 */
export function detectCategory(title: string, description?: string | null, platformCategory?: string): MarketCategory {
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // ── Tier 0: High-confidence keyword overrides ──
  // These are NEVER ambiguous and override platform category.
  // Solves: "Chelsea Clinton nomination" tagged SPORTS (Chelsea FC regex),
  //         "Trump out as President before GTA VI" tagged SPORTS.
  if (POLITICS_OVERRIDE.test(text)) return 'POLITICS';
  if (FINANCE_OVERRIDE.test(text)) return 'FINANCE';
  if (CRYPTO_OVERRIDE.test(text)) return 'CRYPTO';

  // ── Tier 1: Platform-provided category ──
  if (platformCategory) {
    const mapped = PLATFORM_CATEGORY_MAP[platformCategory.toLowerCase().trim()];
    if (mapped) return mapped;
  }

  // ── Tier 2: Title + description keyword detection (fallback) ──

  // Sports — ONLY check after high-confidence overrides have been tested.
  // League names are safe (NBA, NFL, etc.), but team names cause false positives:
  // "Chelsea", "Cardinals", "Kings", "Panthers" are all common words/names.
  if (/\b(nfl|nba|mlb|nhl|world cup|super bowl|playoff|ufc|boxing|tennis|golf|olympics|pga|ncaa|march madness|epl|la liga|champions league|serie a|bundesliga|premier league|mls)\b/.test(text)) return 'SPORTS';
  if (/\b(win|wins|score|scored|points|goals|assists|rebounds|yards|touchdowns|strikeouts|saves|knockout)\b.*\b(by over|under|over \d|: \d)/i.test(text)) return 'SPORTS';
  // Team names — only match after politics/finance/crypto already failed
  if (/\b(lakers|celtics|warriors|nuggets|knicks|cavaliers|clippers|manchester united|manchester city|liverpool|arsenal|barcelona|real madrid|bayern|juventus|psg|cowboys|eagles|chiefs|patriots|dodgers|yankees|red sox|cubs)\b/i.test(text)) return 'SPORTS';
  if (/\b(rookie of the year|mvp|dpoy|sixth man|all.star|draft pick|free agent|transfer window|top \d.*standings|finish in.*top \d)\b/i.test(text)) return 'SPORTS';

  // Science
  if (/\b(climate|temperature|hurricane|earthquake|space|nasa|vaccine|virus|pandemic|study|research|science|ai model|artificial intelligence|supervolcano|mars)\b/.test(text)) return 'SCIENCE';

  // Culture — games, entertainment, media
  if (/\b(oscar|grammy|emmy|box office|movie|album|celebrity|tiktok|youtube|spotify|streaming|tv show|netflix|gta|video game|playstation|xbox|nintendo|released before)\b/.test(text)) return 'CULTURE';

  return 'OTHER';
}
