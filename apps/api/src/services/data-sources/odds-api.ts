/**
 * The Odds API (the-odds-api.com) — free tier: 500 requests/month.
 * Provides live odds, injury news, and recent records for sports markets.
 *
 * Tiered caching based on time to event:
 *   >7 days:  6 hours  (futures — odds barely move)
 *   1-7 days: 2 hours  (odds start moving as game approaches)
 *   <24 hours: 15 min  (game day — injuries, line movement, sharp money)
 *   Live:      2 min   (in-progress games)
 *
 * Monthly usage tracked in SystemConfig to monitor against 500 free tier limit.
 */
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// ── Tiered cache TTLs based on time to event ──
const CACHE_TTL = {
  FUTURES:  6 * 60 * 60 * 1000,  // >7 days out: 6 hours
  UPCOMING: 2 * 60 * 60 * 1000,  // 1-7 days out: 2 hours
  GAMEDAY:  15 * 60 * 1000,      // <24 hours: 15 minutes
  LIVE:     2 * 60 * 1000,       // in-progress: 2 minutes
} as const;

interface OddsData {
  home_team: string;
  away_team: string;
  sport_key: string;
  commence_time: string;
  bookmakers: { key: string; title: string; markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[] }[];
}

export interface SportsContext {
  context: string;
  freshness: 'live' | 'cached' | 'stale' | 'none';
  sources: string[];
}

// ── In-memory cache: sport key → { games, fetchedAt } ──
const oddsCache = new Map<string, { games: OddsData[]; fetchedAt: number }>();

// ── Monthly usage tracking (in-memory + DB persistence) ──
const USAGE_CONFIG_KEY = 'odds_api_monthly_usage';
let cachedMonthlyUsage = { month: '', calls: 0, remaining: 500 };

interface OddsApiUsage {
  month: string;      // "2026-03"
  calls: number;
  remaining: number;
  lastUpdated: string; // ISO timestamp
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "2026-03"
}

async function recordApiCall(remaining?: number): Promise<void> {
  const month = getCurrentMonth();

  // Reset counter on new month
  if (cachedMonthlyUsage.month !== month) {
    cachedMonthlyUsage = { month, calls: 0, remaining: 500 };
  }

  cachedMonthlyUsage.calls++;
  if (remaining !== undefined) {
    cachedMonthlyUsage.remaining = remaining;
  }

  // Persist to DB every 5 calls (avoid DB hit on every request)
  if (cachedMonthlyUsage.calls % 5 === 0 || remaining !== undefined) {
    try {
      const usage: OddsApiUsage = {
        month,
        calls: cachedMonthlyUsage.calls,
        remaining: cachedMonthlyUsage.remaining,
        lastUpdated: new Date().toISOString(),
      };
      await prisma.systemConfig.upsert({
        where: { key: USAGE_CONFIG_KEY },
        create: { key: USAGE_CONFIG_KEY, value: usage as any },
        update: { value: usage as any },
      });
    } catch {
      // Non-critical — usage tracking failure shouldn't block odds fetching
    }
  }

  // Warn when running low
  if (cachedMonthlyUsage.remaining <= 50) {
    logger.warn({
      calls: cachedMonthlyUsage.calls,
      remaining: cachedMonthlyUsage.remaining,
      month,
    }, 'Odds API quota running low — consider upgrading or reducing polling');
  }
}

/**
 * Get current Odds API usage stats.
 */
export async function getOddsApiUsage(): Promise<OddsApiUsage> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: USAGE_CONFIG_KEY },
    });
    if (config?.value) {
      const usage = config.value as unknown as OddsApiUsage;
      // Sync in-memory cache
      cachedMonthlyUsage = { month: usage.month, calls: usage.calls, remaining: usage.remaining };
      return usage;
    }
  } catch { /* fall through */ }

  return {
    month: getCurrentMonth(),
    calls: cachedMonthlyUsage.calls,
    remaining: cachedMonthlyUsage.remaining,
    lastUpdated: new Date().toISOString(),
  };
}

// Sport key mapping for common prediction market terms
const SPORT_KEYWORDS: Record<string, string> = {
  'nba': 'basketball_nba',
  'nfl': 'americanfootball_nfl',
  'mlb': 'baseball_mlb',
  'nhl': 'icehockey_nhl',
  'soccer': 'soccer_epl',
  'premier league': 'soccer_epl',
  'epl': 'soccer_epl',
  // EPL team names — these markets rarely say "soccer" or "premier league"
  'man united': 'soccer_epl',
  'manchester united': 'soccer_epl',
  'man city': 'soccer_epl',
  'manchester city': 'soccer_epl',
  'arsenal': 'soccer_epl',
  'liverpool': 'soccer_epl',
  'chelsea': 'soccer_epl',
  'tottenham': 'soccer_epl',
  'spurs': 'soccer_epl',
  'newcastle': 'soccer_epl',
  'aston villa': 'soccer_epl',
  'west ham': 'soccer_epl',
  'brighton': 'soccer_epl',
  'everton': 'soccer_epl',
  'wolves': 'soccer_epl',
  'nottingham': 'soccer_epl',
  'crystal palace': 'soccer_epl',
  'fulham': 'soccer_epl',
  'bournemouth': 'soccer_epl',
  'brentford': 'soccer_epl',
  // Other major soccer leagues
  'la liga': 'soccer_spain_la_liga',
  'real madrid': 'soccer_spain_la_liga',
  'barcelona': 'soccer_spain_la_liga',
  'atletico': 'soccer_spain_la_liga',
  'bundesliga': 'soccer_germany_bundesliga',
  'bayern': 'soccer_germany_bundesliga',
  'dortmund': 'soccer_germany_bundesliga',
  'serie a': 'soccer_italy_serie_a',
  'juventus': 'soccer_italy_serie_a',
  'ac milan': 'soccer_italy_serie_a',
  'inter milan': 'soccer_italy_serie_a',
  'napoli': 'soccer_italy_serie_a',
  'ligue 1': 'soccer_france_ligue_one',
  'psg': 'soccer_france_ligue_one',
  'champions league': 'soccer_uefa_champs_league',
  'europa league': 'soccer_uefa_europa_league',
  'mls': 'soccer_usa_mls',
  'ncaa': 'americanfootball_ncaaf',
  'college football': 'americanfootball_ncaaf',
  'college basketball': 'basketball_ncaab',
  'ufc': 'mma_mixed_martial_arts',
  'mma': 'mma_mixed_martial_arts',
  'tennis': 'tennis_atp_french_open',
  'f1': 'motorsport_formula_one',
  'formula 1': 'motorsport_formula_one',
};

// NBA team names → detect as basketball_nba
const NBA_TEAM_NAMES = [
  'hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'cavs', 'mavericks', 'mavs',
  'nuggets', 'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers', 'grizzlies',
  'heat', 'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder', 'magic', '76ers', 'sixers',
  'suns', 'blazers', 'trail blazers', 'kings', 'raptors', 'jazz', 'wizards',
];
const NFL_TEAM_NAMES = [
  'cardinals', 'falcons', 'ravens', 'bills', 'panthers', 'bears', 'bengals', 'browns',
  'cowboys', 'broncos', 'lions', 'packers', 'texans', 'colts', 'jaguars', 'chiefs',
  'raiders', 'chargers', 'rams', 'dolphins', 'vikings', 'patriots', 'saints', 'giants',
  'jets', 'eagles', 'steelers', '49ers', 'niners', 'seahawks', 'buccaneers', 'bucs',
  'titans', 'commanders',
];
const MLB_TEAM_NAMES = [
  'diamondbacks', 'dbacks', 'braves', 'orioles', 'red sox', 'cubs', 'white sox', 'reds',
  'guardians', 'rockies', 'tigers', 'astros', 'royals', 'angels', 'dodgers', 'marlins',
  'brewers', 'twins', 'mets', 'yankees', 'athletics', 'phillies', 'pirates', 'padres',
  'mariners', 'cardinals', 'rays', 'rangers', 'blue jays', 'nationals',
];
const NHL_TEAM_NAMES = [
  'ducks', 'bruins', 'sabres', 'flames', 'hurricanes', 'blackhawks', 'avalanche',
  'blue jackets', 'stars', 'red wings', 'oilers', 'panthers', 'kings', 'wild',
  'canadiens', 'predators', 'devils', 'islanders', 'senators', 'flyers',
  'penguins', 'sharks', 'kraken', 'blues', 'lightning', 'maple leafs', 'canucks',
  'golden knights', 'capitals',
];

export function detectSport(title: string): string | null {
  const lower = title.toLowerCase();

  // First check explicit league/sport keywords
  for (const [keyword, sport] of Object.entries(SPORT_KEYWORDS)) {
    if (lower.includes(keyword)) return sport;
  }

  // Fallback: check team names from major leagues
  if (NBA_TEAM_NAMES.some(t => lower.includes(t))) return 'basketball_nba';
  if (NFL_TEAM_NAMES.some(t => lower.includes(t))) return 'americanfootball_nfl';
  if (MLB_TEAM_NAMES.some(t => lower.includes(t))) return 'baseball_mlb';
  if (NHL_TEAM_NAMES.some(t => lower.includes(t))) return 'icehockey_nhl';

  return null;
}

export function extractTeamNames(title: string): string[] {
  // Try to extract team names from prediction market titles
  // Common formats: "Will the Lakers beat the Celtics?", "Lakers vs Celtics", "NBA: Lakers - Celtics"
  const vsMatch = title.match(/(\w[\w\s]+?)\s+(?:vs\.?|v\.?|versus|-)\s+(\w[\w\s]+?)(?:\?|$|,|\s+(?:in|on|at))/i);
  if (vsMatch) return [vsMatch[1].trim(), vsMatch[2].trim()];
  return [];
}

/** Convert American odds to implied probability (0-1) */
function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Determine cache TTL based on the nearest event start time in the game list.
 *
 * Tiered:
 *   >7 days:   6 hours  (futures)
 *   1-7 days:  2 hours  (upcoming)
 *   <24 hours: 15 min   (game day)
 *   Live:      2 min    (in-progress)
 */
function getCacheTtl(games: OddsData[]): number {
  if (games.length === 0) return CACHE_TTL.UPCOMING; // default if no games

  const now = Date.now();
  let nearestMs = Infinity;

  for (const game of games) {
    const start = new Date(game.commence_time).getTime();
    const diff = start - now;
    if (Math.abs(diff) < Math.abs(nearestMs)) {
      nearestMs = diff;
    }
  }

  // Game already started (negative diff) → live
  if (nearestMs < 0) return CACHE_TTL.LIVE;

  const hoursOut = nearestMs / (60 * 60 * 1000);
  if (hoursOut < 24) return CACHE_TTL.GAMEDAY;
  if (hoursOut < 7 * 24) return CACHE_TTL.UPCOMING;
  return CACHE_TTL.FUTURES;
}

/**
 * Fetch odds for a sport, with tiered caching based on time to event.
 */
async function fetchOddsCached(sport: string, apiKey: string): Promise<OddsData[]> {
  const cached = oddsCache.get(sport);
  if (cached) {
    // Calculate TTL based on the cached games' event times
    const ttl = getCacheTtl(cached.games);
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.games;
    }
  }

  const axios = require('axios');
  const resp = await axios.get(`${ODDS_API_BASE}/sports/${sport}/odds`, {
    params: {
      apiKey,
      regions: 'us',
      markets: 'h2h,spreads,totals',
      oddsFormat: 'american',
    },
    timeout: 10000,
  });

  const games: OddsData[] = resp.data || [];
  oddsCache.set(sport, { games, fetchedAt: Date.now() });

  // Track API usage from response headers
  const remaining = resp.headers?.['x-requests-remaining'];
  const remainingNum = remaining !== undefined ? parseInt(remaining, 10) : undefined;
  await recordApiCall(remainingNum);

  const ttl = getCacheTtl(games);
  const ttlLabel = ttl >= CACHE_TTL.FUTURES ? '6h (futures)'
    : ttl >= CACHE_TTL.UPCOMING ? '2h (upcoming)'
    : ttl >= CACHE_TTL.GAMEDAY ? '15m (game day)'
    : '2m (live)';

  logger.info({
    sport, games: games.length, remaining: remainingNum,
    cacheTtl: ttlLabel, monthCalls: cachedMonthlyUsage.calls,
  }, `Odds API fetched (cached ${ttlLabel})`);

  return games;
}

export async function getSportsOdds(title: string, description: string | null): Promise<SportsContext> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { context: '', freshness: 'none', sources: [] };
  }

  const sources: string[] = [];
  const parts: string[] = [];

  try {
    const sport = detectSport(title);

    if (!sport) {
      return { context: '', freshness: 'none', sources: [] };
    }

    const games = await fetchOddsCached(sport, apiKey);
    const teamNames = extractTeamNames(title);

    // Find the most relevant game
    let matchedGame: OddsData | null = null;
    for (const game of games) {
      const gameTeams = [game.home_team.toLowerCase(), game.away_team.toLowerCase()];
      const titleLower = title.toLowerCase();
      if (teamNames.some(t => gameTeams.some(gt => gt.includes(t.toLowerCase()) || t.toLowerCase().includes(gt)))) {
        matchedGame = game;
        break;
      }
      if (gameTeams.some(gt => titleLower.includes(gt))) {
        matchedGame = game;
        break;
      }
    }

    if (matchedGame) {
      parts.push(`## Live Sports Odds (The Odds API)`);
      parts.push(`- Matchup: ${matchedGame.home_team} (HOME) vs ${matchedGame.away_team} (AWAY)`);
      parts.push(`- Sport: ${matchedGame.sport_key}`);
      parts.push(`- Start: ${new Date(matchedGame.commence_time).toLocaleString()}`);

      // Aggregate odds from bookmakers
      const h2hOdds: Record<string, number[]> = {};
      for (const bm of matchedGame.bookmakers.slice(0, 5)) {
        const h2h = bm.markets.find(m => m.key === 'h2h');
        if (h2h) {
          for (const o of h2h.outcomes) {
            (h2hOdds[o.name] = h2hOdds[o.name] || []).push(o.price);
          }
        }
      }

      if (Object.keys(h2hOdds).length > 0) {
        parts.push(`### Moneyline Odds (consensus across ${matchedGame.bookmakers.length} books)`);
        for (const [name, prices] of Object.entries(h2hOdds)) {
          const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
          const impliedProb = americanToImplied(avg);
          parts.push(`- ${name}: avg ${avg > 0 ? '+' : ''}${avg.toFixed(0)} (implied: ${(impliedProb * 100).toFixed(1)}%)`);
        }
      }

      // Add spread info
      const spreads = matchedGame.bookmakers[0]?.markets.find(m => m.key === 'spreads');
      if (spreads) {
        parts.push(`### Spread`);
        for (const o of spreads.outcomes) {
          parts.push(`- ${o.name}: ${o.point != null ? (o.point > 0 ? '+' : '') + o.point : ''} (${o.price > 0 ? '+' : ''}${o.price})`);
        }
      }

      // Add totals info
      const totals = matchedGame.bookmakers[0]?.markets.find(m => m.key === 'totals');
      if (totals) {
        parts.push(`### Over/Under`);
        for (const o of totals.outcomes) {
          parts.push(`- ${o.name} ${o.point ?? ''}: ${o.price > 0 ? '+' : ''}${o.price}`);
        }
      }

      sources.push('The Odds API');
    } else if (games.length > 0) {
      // No exact match, but show upcoming games in the sport
      parts.push(`## Upcoming ${sport} Games (The Odds API)`);
      for (const game of games.slice(0, 3)) {
        parts.push(`- ${game.home_team} vs ${game.away_team} (${new Date(game.commence_time).toLocaleDateString()})`);
      }
      sources.push('The Odds API');
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, 'Odds API fetch failed');
  }

  return {
    context: parts.join('\n'),
    freshness: sources.length > 0 ? 'live' : 'none',
    sources,
  };
}
