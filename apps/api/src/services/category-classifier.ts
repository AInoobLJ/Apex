/**
 * Reclassifies markets using keyword-based pattern matching.
 * Fast, no LLM needed.
 *
 * Two modes:
 * 1. HIGH-CONFIDENCE OVERRIDE: Political/financial/crypto keywords override ANY category
 *    (fixes "Chelsea Clinton" tagged SPORTS due to Chelsea FC name collision).
 * 2. FALLBACK: Markets tagged OTHER get reclassified via broader patterns.
 */

import type { MarketCategory } from '@apex/db';

// ── SPORTS override — unambiguous league/competition names ──
// Checked on TITLE ONLY before politics to prevent false positives from description boilerplate.
const SPORTS_OVERRIDE = /\b(nba|nfl|mlb|nhl|mls|epl|la liga|serie a|bundesliga|ligue 1|premier league|champions league|europa league|world cup|world series|super bowl|stanley cup|march madness|ncaa tournament|masters tournament|pga tour|pga championship|us open golf|the open championship|ryder cup|ufc|f1|formula 1|grand prix)\b/i;

// ── HIGH-CONFIDENCE overrides — these override ANY current category ──
// "Democratic presidential nomination" is ALWAYS POLITICS, even if tagged SPORTS.
// NOTE: "primary" removed as standalone — Polymarket descriptions contain "primary resolution source"
const POLITICS_OVERRIDE = /\b(election|president|presidential|senate|congress|senator|governor|democrat|democratic|republican|biden|trump|nomination|nominee|inaugur|primary election|republican primary|democratic primary|gop|dnc|rnc|ballot|impeach|indicted|pardon|veto|executive order|cabinet|supreme court|scotus|parliament|prime minister|speaker of the house|electoral|geopolitical|ceasefire|invasion|sanctions|nato|hezbollah|hamas)\b/i;

const FINANCE_OVERRIDE = /\b(fed\b|fomc|rate cut|rate hike|inflation|gdp|unemployment|treasury|nasdaq|s&p 500|stock market|recession|cpi\b|tariff|interest rate|bond yield|dow jones)\b/i;

const CRYPTO_OVERRIDE = /\b(bitcoin|btc|ethereum|eth|crypto|defi|blockchain|solana|sol\b|cardano|ripple|xrp|binance|coinbase|halving|stablecoin)\b/i;

// ── SPORTS patterns — only used for OTHER→SPORTS reclassification ──
const SPORTS_PATTERNS = [
  /\b(NBA|NFL|MLB|NHL|MLS|UFC|MMA|PGA|ATP|WTA|FIFA|EPL|La Liga|Bundesliga|Serie A|Champions League)\b/i,
  /\b(touchdown|home run|slam dunk|goal scored|assists|rebounds|strikeout|rushing yards)\b/i,
  /\b(PPG|points\+|rebounds\+|assists\+|yards\+|TDs\+|goals\+)\b/,
  /\b(Lakers|Celtics|Warriors|Heat|Knicks|Nets|Bucks|76ers|Suns|Nuggets|Mavericks|Clippers|Bulls|Hawks|Cavaliers|Pacers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Rockets|Pistons|Hornets|Wizards|Kings|Spurs|Raptors|Trail Blazers|Jazz)\b/i,
  /\b(Chiefs|Eagles|Bills|49ers|Ravens|Cowboys|Lions|Dolphins|Bengals|Texans|Vikings|Packers|Jets|Steelers|Chargers|Rams|Broncos|Seahawks|Falcons|Commanders|Bears|Saints|Titans|Jaguars|Raiders|Browns|Panthers|Cardinals|Colts|Buccaneers|Giants|Patriots)\b/i,
  /\b(wins by over|wins by under|over \d+\.5 points|under \d+\.5 points)\b/i,
  /\b(MVP|Rookie of the Year|Defensive Player|Coach of the Year|Cy Young|Heisman)\b/i,
  /\b(ESL|LPL|LCS|Valorant|Dota|Counter-Strike|LoL|League of Legends|esports?)\b/i,
  /\b(Oilers|Avalanche|Senators|Devils|Wild|Blue Jackets|Ducks|Flames|Predators|Stars|Lightning|Rangers|Islanders|Bruins|Canadiens|Penguins|Capitals|Red Wings|Hurricanes|Kraken|Sabres|Blackhawks|Sharks|Flyers)\b/i,
  /yes .+,yes .+,yes /i, // Parlay format
];

const CULTURE_PATTERNS = [
  /\b(Oscar|Emmy|Grammy|Golden Globe|Tony Award|Cannes|Sundance|BAFTA)\b/i,
  /\b(box office|Billboard|Spotify|Apple Music|Netflix|Disney\+|streaming)\b/i,
  /\b(Taylor Swift|Drake|Kendrick|Beyoncé|Travis Kelce|wedding|baby|pregnant|divorce|dating)\b/i,
  /\b(Coachella|Super Bowl halftime|VMAs|Met Gala|Oscars|Grammy)\b/i,
  /\b(#1 (Paid |Free )?App|App Store|Play Store|download|trending)\b/i,
  /\b(James Bond|Marvel|DC|Star Wars|sequel|franchise|movie|film|album|song|single)\b/i,
  /\b(Instagram|TikTok|Twitter|X post|YouTube|follower|subscribers|views)\b/i,
  /\b(GTA|video game|playstation|xbox|nintendo|released before|release date)\b/i,
  /\b(Rihanna|album before|Carti)\b/i,
];

const SCIENCE_PATTERNS = [
  /\b(weather|temperature|hurricane|tornado|earthquake|tsunami|wildfire|flood|drought|snowfall|rainfall|heat wave|cold snap|storm)\b/i,
  /\b(NASA|SpaceX|rocket|launch|orbit|Mars|Moon|ISS|satellite|space)\b/i,
  /\b(COVID|pandemic|WHO|CDC|vaccine|clinical trial|FDA approval)\b/i,
  /\b(AI|artificial intelligence|GPT|language model|autonomous|robotics)\b/i,
  /\b(flight.* delay|flights? (cancelled|delayed))\b/i,
];

export function reclassifyMarket(title: string, currentCategory: string): MarketCategory {
  // ── SPORTS OVERRIDE — checked FIRST on title only ──
  // Unambiguous league/competition names always mean SPORTS.
  if (SPORTS_OVERRIDE.test(title)) return 'SPORTS';

  // ── HIGH-CONFIDENCE OVERRIDES — apply to ANY category, not just OTHER ──
  // "Chelsea Clinton win 2028 Democratic nomination?" was SPORTS → now POLITICS.
  if (POLITICS_OVERRIDE.test(title)) return 'POLITICS';
  if (FINANCE_OVERRIDE.test(title)) return 'FINANCE';
  if (CRYPTO_OVERRIDE.test(title)) return 'CRYPTO';

  // Don't change non-OTHER categories beyond the overrides above
  if (currentCategory !== 'OTHER') return currentCategory as MarketCategory;

  // ── FALLBACK: reclassify OTHER markets ──
  if (SPORTS_PATTERNS.some(p => p.test(title))) return 'SPORTS';
  if (CULTURE_PATTERNS.some(p => p.test(title))) return 'CULTURE';
  if (SCIENCE_PATTERNS.some(p => p.test(title))) return 'SCIENCE';

  return 'OTHER';
}
