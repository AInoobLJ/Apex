import { MarketCategory } from '@apex/db';

/**
 * Detect market category from title, description, and optional platform hints.
 * @param title Market title
 * @param description Market description
 * @param eventTicker Optional event ticker (Kalshi) for stronger categorization
 */
export function detectCategory(title: string, description?: string | null, eventTicker?: string): MarketCategory {
  // Kalshi event category or ticker prefix detection (strongest signal)
  if (eventTicker) {
    const et = eventTicker.toLowerCase();
    // Direct Kalshi category strings from Events API
    if (et === 'elections' || et === 'politics') return 'POLITICS';
    if (et === 'financials' || et === 'economics') return 'FINANCE';
    if (et === 'crypto') return 'CRYPTO';
    if (et === 'science and technology') return 'SCIENCE';
    if (et === 'climate and weather') return 'SCIENCE';
    if (et === 'entertainment' || et === 'social') return 'CULTURE';
    if (et === 'sports') return 'SPORTS';
    if (et === 'world') return 'POLITICS';
    // Fallback: event ticker prefix detection
    if (et.includes('sport') || et.includes('nba') || et.includes('nfl') || et.includes('mlb') || et.includes('nhl') || et.includes('ufc')) return 'SPORTS';
    if (et.includes('elect') || et.includes('politic')) return 'POLITICS';
    if (et.includes('financ') || et.includes('fed') || et.includes('fomc')) return 'FINANCE';
    if (et.includes('crypto') || et.includes('bitcoin') || et.includes('btc')) return 'CRYPTO';
    if (et.includes('climate') || et.includes('weather') || et.includes('science') || et.includes('tech')) return 'SCIENCE';
    if (et.includes('entertain') || et.includes('culture')) return 'CULTURE';
    if (et.includes('crosscategory') || et.includes('mve')) return 'SPORTS';
  }

  // Title + description keyword detection
  const text = `${title} ${description ?? ''}`.toLowerCase();

  // Sports detection first — catches player stats patterns like "Murray: 1+", "Jokić: 10+", team names
  if (/\b(nfl|nba|mlb|nhl|world cup|super bowl|championship|playoff|series|ufc|boxing|tennis|golf|olympics|pga|ncaa|march madness)\b/.test(text)) return 'SPORTS';
  if (/\b(win|wins|score|scored|points|goals|assists|rebounds|yards|touchdowns|strikeouts|saves|knockout)\b.*\b(by over|under|over \d|: \d)/i.test(text)) return 'SPORTS';
  if (/\b(ducks|hurricanes|avalanche|bruins|sharks|lakers|celtics|warriors|nuggets|knicks|cavaliers|clippers)\b/i.test(text)) return 'SPORTS';

  if (/\b(election|president|senate|congress|governor|democrat|republican|biden|trump|vote|poll|inaugur|primary|gop|dnc|rnc|mayor|ballot|pope|nominee|nomination)\b/.test(text)) return 'POLITICS';
  if (/\b(fed|fomc|rate cut|rate hike|inflation|gdp|unemployment|treasury|nasdaq|s&p|stock|recession|cpi|pce|bls|labor|payroll|dow|russell|tariff)\b/.test(text)) return 'FINANCE';
  if (/\b(bitcoin|btc|ethereum|eth|crypto|defi|blockchain|token|nft|solana|sol|cardano|ripple|xrp|binance|coinbase|halving|stablecoin)\b/.test(text)) return 'CRYPTO';
  if (/\b(climate|temperature|hurricane|earthquake|space|nasa|vaccine|virus|pandemic|study|research|science|ai model|artificial intelligence|supervolcano|mars)\b/.test(text)) return 'SCIENCE';
  if (/\b(oscar|grammy|emmy|box office|movie|album|celebrity|tiktok|youtube|spotify|streaming|tv show|netflix)\b/.test(text)) return 'CULTURE';
  return 'OTHER';
}
