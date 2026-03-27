/**
 * ESPN Public API — free, no API key required.
 * Provides injuries, standings, and team schedules for major sports.
 *
 * Endpoints:
 *   site.api.espn.com/apis/site/v2/sports/{sport}/{league}/injuries
 *   site.api.espn.com/apis/site/v2/sports/{sport}/{league}/standings
 *   site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{id}/schedule
 *
 * Cache: in-memory with 2h TTL (injuries) / 12h TTL (standings/schedule).
 */
import { logger } from '../../lib/logger';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const INJURY_CACHE_TTL = 2 * 60 * 60 * 1000;    // 2 hours
const STANDINGS_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours
const SCHEDULE_CACHE_TTL = 2 * 60 * 60 * 1000;   // 2 hours
const REQUEST_TIMEOUT = 8000;

interface EspnContext {
  context: string;
  freshness: 'live' | 'cached' | 'stale' | 'none';
  sources: string[];
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

// ── In-memory caches ──
const injuryCache = new Map<string, CacheEntry<any>>();
const standingsCache = new Map<string, CacheEntry<any>>();
const scheduleCache = new Map<string, CacheEntry<any>>();

// ── Sport keyword → ESPN path mapping ──
const ESPN_SPORT_MAP: Record<string, { sport: string; league: string }> = {
  'nba': { sport: 'basketball', league: 'nba' },
  'nfl': { sport: 'football', league: 'nfl' },
  'mlb': { sport: 'baseball', league: 'mlb' },
  'nhl': { sport: 'hockey', league: 'nhl' },
  'mls': { sport: 'soccer', league: 'usa.1' },
  'premier league': { sport: 'soccer', league: 'eng.1' },
  'epl': { sport: 'soccer', league: 'eng.1' },
  'la liga': { sport: 'soccer', league: 'esp.1' },
  'bundesliga': { sport: 'soccer', league: 'ger.1' },
  'serie a': { sport: 'soccer', league: 'ita.1' },
  'ligue 1': { sport: 'soccer', league: 'fra.1' },
  'champions league': { sport: 'soccer', league: 'uefa.champions' },
  'ncaa': { sport: 'football', league: 'college-football' },
  'college basketball': { sport: 'basketball', league: 'mens-college-basketball' },
};

// ── ESPN team IDs for major leagues ──
// NBA (30 teams)
const NBA_TEAMS: Record<string, { id: string; display: string }> = {
  'hawks': { id: '1', display: 'Atlanta Hawks' },
  'celtics': { id: '2', display: 'Boston Celtics' },
  'nets': { id: '17', display: 'Brooklyn Nets' },
  'hornets': { id: '30', display: 'Charlotte Hornets' },
  'bulls': { id: '4', display: 'Chicago Bulls' },
  'cavaliers': { id: '5', display: 'Cleveland Cavaliers' },
  'cavs': { id: '5', display: 'Cleveland Cavaliers' },
  'mavericks': { id: '6', display: 'Dallas Mavericks' },
  'mavs': { id: '6', display: 'Dallas Mavericks' },
  'nuggets': { id: '7', display: 'Denver Nuggets' },
  'pistons': { id: '8', display: 'Detroit Pistons' },
  'warriors': { id: '9', display: 'Golden State Warriors' },
  'rockets': { id: '10', display: 'Houston Rockets' },
  'pacers': { id: '11', display: 'Indiana Pacers' },
  'clippers': { id: '12', display: 'LA Clippers' },
  'lakers': { id: '13', display: 'Los Angeles Lakers' },
  'grizzlies': { id: '29', display: 'Memphis Grizzlies' },
  'heat': { id: '14', display: 'Miami Heat' },
  'bucks': { id: '15', display: 'Milwaukee Bucks' },
  'timberwolves': { id: '16', display: 'Minnesota Timberwolves' },
  'wolves': { id: '16', display: 'Minnesota Timberwolves' },
  'pelicans': { id: '3', display: 'New Orleans Pelicans' },
  'knicks': { id: '18', display: 'New York Knicks' },
  'thunder': { id: '25', display: 'Oklahoma City Thunder' },
  'magic': { id: '19', display: 'Orlando Magic' },
  '76ers': { id: '20', display: 'Philadelphia 76ers' },
  'sixers': { id: '20', display: 'Philadelphia 76ers' },
  'suns': { id: '21', display: 'Phoenix Suns' },
  'blazers': { id: '22', display: 'Portland Trail Blazers' },
  'trail blazers': { id: '22', display: 'Portland Trail Blazers' },
  'kings': { id: '23', display: 'Sacramento Kings' },
  'spurs': { id: '24', display: 'San Antonio Spurs' },
  'raptors': { id: '28', display: 'Toronto Raptors' },
  'jazz': { id: '26', display: 'Utah Jazz' },
  'wizards': { id: '27', display: 'Washington Wizards' },
};

// NFL (32 teams)
const NFL_TEAMS: Record<string, { id: string; display: string }> = {
  'cardinals': { id: '22', display: 'Arizona Cardinals' },
  'falcons': { id: '1', display: 'Atlanta Falcons' },
  'ravens': { id: '33', display: 'Baltimore Ravens' },
  'bills': { id: '2', display: 'Buffalo Bills' },
  'panthers': { id: '29', display: 'Carolina Panthers' },
  'bears': { id: '3', display: 'Chicago Bears' },
  'bengals': { id: '4', display: 'Cincinnati Bengals' },
  'browns': { id: '5', display: 'Cleveland Browns' },
  'cowboys': { id: '6', display: 'Dallas Cowboys' },
  'broncos': { id: '7', display: 'Denver Broncos' },
  'lions': { id: '8', display: 'Detroit Lions' },
  'packers': { id: '9', display: 'Green Bay Packers' },
  'texans': { id: '34', display: 'Houston Texans' },
  'colts': { id: '11', display: 'Indianapolis Colts' },
  'jaguars': { id: '30', display: 'Jacksonville Jaguars' },
  'chiefs': { id: '12', display: 'Kansas City Chiefs' },
  'raiders': { id: '13', display: 'Las Vegas Raiders' },
  'chargers': { id: '24', display: 'Los Angeles Chargers' },
  'rams': { id: '14', display: 'Los Angeles Rams' },
  'dolphins': { id: '15', display: 'Miami Dolphins' },
  'vikings': { id: '16', display: 'Minnesota Vikings' },
  'patriots': { id: '17', display: 'New England Patriots' },
  'saints': { id: '18', display: 'New Orleans Saints' },
  'giants': { id: '19', display: 'New York Giants' },
  'jets': { id: '20', display: 'New York Jets' },
  'eagles': { id: '21', display: 'Philadelphia Eagles' },
  'steelers': { id: '23', display: 'Pittsburgh Steelers' },
  '49ers': { id: '25', display: 'San Francisco 49ers' },
  'niners': { id: '25', display: 'San Francisco 49ers' },
  'seahawks': { id: '26', display: 'Seattle Seahawks' },
  'buccaneers': { id: '27', display: 'Tampa Bay Buccaneers' },
  'bucs': { id: '27', display: 'Tampa Bay Buccaneers' },
  'titans': { id: '10', display: 'Tennessee Titans' },
  'commanders': { id: '28', display: 'Washington Commanders' },
};

// MLB (30 teams)
const MLB_TEAMS: Record<string, { id: string; display: string }> = {
  'diamondbacks': { id: '29', display: 'Arizona Diamondbacks' },
  'dbacks': { id: '29', display: 'Arizona Diamondbacks' },
  'braves': { id: '15', display: 'Atlanta Braves' },
  'orioles': { id: '1', display: 'Baltimore Orioles' },
  'red sox': { id: '2', display: 'Boston Red Sox' },
  'cubs': { id: '16', display: 'Chicago Cubs' },
  'white sox': { id: '4', display: 'Chicago White Sox' },
  'reds': { id: '17', display: 'Cincinnati Reds' },
  'guardians': { id: '5', display: 'Cleveland Guardians' },
  'rockies': { id: '27', display: 'Colorado Rockies' },
  'tigers': { id: '6', display: 'Detroit Tigers' },
  'astros': { id: '18', display: 'Houston Astros' },
  'royals': { id: '7', display: 'Kansas City Royals' },
  'angels': { id: '3', display: 'Los Angeles Angels' },
  'dodgers': { id: '19', display: 'Los Angeles Dodgers' },
  'marlins': { id: '28', display: 'Miami Marlins' },
  'brewers': { id: '8', display: 'Milwaukee Brewers' },
  'twins': { id: '9', display: 'Minnesota Twins' },
  'mets': { id: '21', display: 'New York Mets' },
  'yankees': { id: '10', display: 'New York Yankees' },
  'athletics': { id: '11', display: 'Oakland Athletics' },
  'phillies': { id: '22', display: 'Philadelphia Phillies' },
  'pirates': { id: '23', display: 'Pittsburgh Pirates' },
  'padres': { id: '25', display: 'San Diego Padres' },
  'mariners': { id: '12', display: 'Seattle Mariners' },
  'cardinals': { id: '24', display: 'St. Louis Cardinals' },
  'rays': { id: '30', display: 'Tampa Bay Rays' },
  'rangers': { id: '13', display: 'Texas Rangers' },
  'blue jays': { id: '14', display: 'Toronto Blue Jays' },
  'nationals': { id: '20', display: 'Washington Nationals' },
};

// NHL (32 teams)
const NHL_TEAMS: Record<string, { id: string; display: string }> = {
  'ducks': { id: '25', display: 'Anaheim Ducks' },
  'coyotes': { id: '24', display: 'Arizona Coyotes' },
  'bruins': { id: '1', display: 'Boston Bruins' },
  'sabres': { id: '2', display: 'Buffalo Sabres' },
  'flames': { id: '3', display: 'Calgary Flames' },
  'hurricanes': { id: '7', display: 'Carolina Hurricanes' },
  'blackhawks': { id: '4', display: 'Chicago Blackhawks' },
  'avalanche': { id: '17', display: 'Colorado Avalanche' },
  'blue jackets': { id: '29', display: 'Columbus Blue Jackets' },
  'stars': { id: '9', display: 'Dallas Stars' },
  'red wings': { id: '5', display: 'Detroit Red Wings' },
  'oilers': { id: '22', display: 'Edmonton Oilers' },
  'panthers': { id: '13', display: 'Florida Panthers' },
  'kings': { id: '26', display: 'Los Angeles Kings' },
  'wild': { id: '30', display: 'Minnesota Wild' },
  'canadiens': { id: '8', display: 'Montreal Canadiens' },
  'predators': { id: '18', display: 'Nashville Predators' },
  'devils': { id: '10', display: 'New Jersey Devils' },
  'islanders': { id: '12', display: 'New York Islanders' },
  'rangers': { id: '11', display: 'New York Rangers' },
  'senators': { id: '9', display: 'Ottawa Senators' },
  'flyers': { id: '14', display: 'Philadelphia Flyers' },
  'penguins': { id: '15', display: 'Pittsburgh Penguins' },
  'sharks': { id: '28', display: 'San Jose Sharks' },
  'kraken': { id: '55', display: 'Seattle Kraken' },
  'blues': { id: '19', display: 'St. Louis Blues' },
  'lightning': { id: '27', display: 'Tampa Bay Lightning' },
  'maple leafs': { id: '20', display: 'Toronto Maple Leafs' },
  'canucks': { id: '23', display: 'Vancouver Canucks' },
  'golden knights': { id: '37', display: 'Vegas Golden Knights' },
  'capitals': { id: '21', display: 'Washington Capitals' },
  'jets': { id: '52', display: 'Winnipeg Jets' },
};

// League → team map lookup
const LEAGUE_TEAM_MAPS: Record<string, Record<string, { id: string; display: string }>> = {
  'nba': NBA_TEAMS,
  'nfl': NFL_TEAMS,
  'mlb': MLB_TEAMS,
  'nhl': NHL_TEAMS,
};

function detectEspnSport(title: string): { sport: string; league: string } | null {
  const lower = title.toLowerCase();

  // First check explicit league keywords
  for (const [keyword, path] of Object.entries(ESPN_SPORT_MAP)) {
    if (lower.includes(keyword)) return path;
  }

  // Fallback: detect from team names in the title
  for (const teamName of Object.keys(NBA_TEAMS)) {
    if (lower.includes(teamName)) return { sport: 'basketball', league: 'nba' };
  }
  for (const teamName of Object.keys(NFL_TEAMS)) {
    if (lower.includes(teamName)) return { sport: 'football', league: 'nfl' };
  }
  for (const teamName of Object.keys(MLB_TEAMS)) {
    if (lower.includes(teamName)) return { sport: 'baseball', league: 'mlb' };
  }
  for (const teamName of Object.keys(NHL_TEAMS)) {
    if (lower.includes(teamName)) return { sport: 'hockey', league: 'nhl' };
  }

  return null;
}

function findTeamId(title: string, league: string): { teamId: string; teamName: string } | null {
  const teamMap = LEAGUE_TEAM_MAPS[league];
  if (!teamMap) return null;

  const lower = title.toLowerCase();
  for (const [keyword, team] of Object.entries(teamMap)) {
    if (lower.includes(keyword)) return { teamId: team.id, teamName: team.display };
  }
  return null;
}

function findBothTeams(title: string, league: string): { team1: { id: string; name: string } | null; team2: { id: string; name: string } | null } {
  const teamMap = LEAGUE_TEAM_MAPS[league];
  if (!teamMap) return { team1: null, team2: null };

  const lower = title.toLowerCase();
  const matches: { id: string; name: string; index: number }[] = [];

  for (const [keyword, team] of Object.entries(teamMap)) {
    const idx = lower.indexOf(keyword);
    if (idx !== -1) {
      // Avoid duplicate matches (e.g. "kings" matching both NBA and NHL)
      if (!matches.some(m => m.id === team.id)) {
        matches.push({ id: team.id, name: team.display, index: idx });
      }
    }
  }

  // Sort by position in title (first mentioned = team1)
  matches.sort((a, b) => a.index - b.index);
  return { team1: matches[0] || null, team2: matches[1] || null };
}

async function fetchJson(url: string): Promise<any> {
  const axios = require('axios');
  const resp = await axios.get(url, { timeout: REQUEST_TIMEOUT });
  return resp.data;
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < ttl) return entry.data;
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

async function fetchInjuries(sport: string, league: string): Promise<string> {
  const cacheKey = `${sport}/${league}`;
  const cached = getCached(injuryCache, cacheKey, INJURY_CACHE_TTL);
  if (cached) return cached;

  try {
    const data = await fetchJson(`${ESPN_BASE}/${sport}/${league}/injuries`);
    const parts: string[] = ['## ESPN Injury Report'];

    const teams = data.injuries || [];
    for (const team of teams.slice(0, 10)) { // Limit to 10 teams for context size
      const injuries = team.injuries || [];
      if (injuries.length === 0) continue;

      const keyInjuries = injuries.slice(0, 3).map((inj: any) => {
        const name = inj.athlete?.displayName || 'Unknown';
        const status = inj.status || 'Unknown';
        const shortComment = inj.shortComment || '';
        return `  - ${name} (${status}): ${shortComment.slice(0, 100)}`;
      });

      if (keyInjuries.length > 0) {
        parts.push(`**${team.displayName}:**`);
        parts.push(...keyInjuries);
      }
    }

    const result = parts.length > 1 ? parts.join('\n') : '';
    setCache(injuryCache, cacheKey, result);
    return result;
  } catch (err: any) {
    logger.debug({ err: err.message, sport, league }, 'ESPN injuries fetch failed');
    return '';
  }
}

async function fetchStandings(sport: string, league: string): Promise<string> {
  const cacheKey = `${sport}/${league}`;
  const cached = getCached(standingsCache, cacheKey, STANDINGS_CACHE_TTL);
  if (cached) return cached;

  try {
    const data = await fetchJson(`${ESPN_BASE}/${sport}/${league}/standings`);
    const parts: string[] = ['## ESPN Standings'];

    // Standings structure varies by sport — extract children (divisions/conferences)
    const children = data.children || [];
    for (const group of children) {
      const groupName = group.name || group.abbreviation || '';
      const standings = group.standings?.entries || [];

      if (standings.length === 0) continue;
      parts.push(`### ${groupName}`);

      for (const entry of standings.slice(0, 8)) { // Top 8 per group
        const team = entry.team?.displayName || 'Unknown';
        const stats = entry.stats || [];
        const wins = stats.find((s: any) => s.name === 'wins')?.value || 0;
        const losses = stats.find((s: any) => s.name === 'losses')?.value || 0;
        const streak = stats.find((s: any) => s.name === 'streak')?.displayValue || '';
        const homeRecord = stats.find((s: any) => s.name === 'Home')?.displayValue ||
                          stats.find((s: any) => s.name === 'homeRecord')?.displayValue || '';
        const awayRecord = stats.find((s: any) => s.name === 'Road' || s.name === 'Away')?.displayValue ||
                          stats.find((s: any) => s.name === 'awayRecord')?.displayValue || '';

        let line = `- ${team}: ${wins}-${losses}`;
        if (homeRecord) line += ` (Home: ${homeRecord})`;
        if (awayRecord) line += ` (Away: ${awayRecord})`;
        if (streak) line += ` [${streak}]`;
        parts.push(line);
      }
    }

    const result = parts.length > 1 ? parts.join('\n') : '';
    setCache(standingsCache, cacheKey, result);
    return result;
  } catch (err: any) {
    logger.debug({ err: err.message, sport, league }, 'ESPN standings fetch failed');
    return '';
  }
}

async function fetchTeamSchedule(sport: string, league: string, teamId: string, teamName: string): Promise<string> {
  const cacheKey = `${sport}/${league}/${teamId}`;
  const cached = getCached(scheduleCache, cacheKey, SCHEDULE_CACHE_TTL);
  if (cached) return cached;

  try {
    const data = await fetchJson(`${ESPN_BASE}/${sport}/${league}/teams/${teamId}/schedule`);
    const parts: string[] = [`## ESPN Schedule: ${teamName}`];

    const record = data.team?.recordSummary;
    const standing = data.team?.standingSummary;
    if (record) parts.push(`- Record: ${record}`);
    if (standing) parts.push(`- Standing: ${standing}`);

    // Find recent completed games (last 10)
    const events = data.events || [];
    const completed = events
      .filter((e: any) => e.competitions?.[0]?.status?.type?.completed === true)
      .slice(-10);

    if (completed.length > 0) {
      let wins = 0;
      let lastGameDate: string | null = null;

      parts.push(`### Last ${completed.length} Games`);
      for (const event of completed.slice(-5)) { // Show last 5 in detail
        const comp = event.competitions?.[0];
        const competitors = comp?.competitors || [];
        const team = competitors.find((c: any) => c.id === teamId);
        const opponent = competitors.find((c: any) => c.id !== teamId);
        const won = team?.winner === true;
        const teamScore = team?.score?.displayValue || '?';
        const oppScore = opponent?.score?.displayValue || '?';
        const oppName = opponent?.team?.shortDisplayName || opponent?.team?.displayName || 'Unknown';
        const date = new Date(event.date).toLocaleDateString();
        const homeAway = team?.homeAway === 'home' ? 'vs' : '@';

        parts.push(`- ${date}: ${won ? 'W' : 'L'} ${teamScore}-${oppScore} ${homeAway} ${oppName}`);
        lastGameDate = event.date;
      }

      // Calculate recent form (last 10)
      for (const event of completed) {
        const comp = event.competitions?.[0];
        const team = comp?.competitors?.find((c: any) => c.id === teamId);
        if (team?.winner === true) wins++;
      }

      parts.push(`- Recent form (last ${completed.length}): ${wins}-${completed.length - wins} (${(wins / completed.length * 100).toFixed(0)}% win rate)`);

      if (lastGameDate) {
        const restDays = Math.floor((Date.now() - new Date(lastGameDate).getTime()) / 86400000);
        parts.push(`- Rest days since last game: ${restDays}`);
      }
    }

    const result = parts.join('\n');
    setCache(scheduleCache, cacheKey, result);
    return result;
  } catch (err: any) {
    logger.debug({ err: err.message, sport, league, teamId }, 'ESPN schedule fetch failed');
    return '';
  }
}

/**
 * Fetch ESPN data for a sports market.
 * Returns injuries, standings, and team schedule data as markdown context.
 */
export async function getEspnData(title: string, description: string | null): Promise<EspnContext> {
  try {
    const espnSport = detectEspnSport(title);
    if (!espnSport) {
      return { context: '', freshness: 'none', sources: [] };
    }

    const { sport, league } = espnSport;
    const { team1, team2 } = findBothTeams(title, league);

    // Fetch all data in parallel
    const fetches: Promise<string>[] = [
      fetchInjuries(sport, league),
      fetchStandings(sport, league),
    ];

    if (team1) fetches.push(fetchTeamSchedule(sport, league, team1.id, team1.name));
    if (team2) fetches.push(fetchTeamSchedule(sport, league, team2.id, team2.name));

    const results = await Promise.allSettled(fetches);
    const parts: string[] = [];
    const sources: string[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        parts.push(r.value);
      }
    }

    if (parts.length > 0) {
      sources.push('ESPN');
    }

    return {
      context: parts.join('\n\n'),
      freshness: sources.length > 0 ? 'live' : 'none',
      sources,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, 'ESPN data fetch failed');
    return { context: '', freshness: 'none', sources: [] };
  }
}
