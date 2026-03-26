/**
 * The Odds API (the-odds-api.com) — free tier: 500 requests/month.
 * Provides live odds, injury news, and recent records for sports markets.
 */
import { logger } from '../../lib/logger';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

interface OddsData {
  homeTeam: string;
  awayTeam: string;
  sport: string;
  commenceTime: string;
  bookmakers: { key: string; title: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
}

interface SportsContext {
  context: string;
  freshness: 'live' | 'cached' | 'stale' | 'none';
  sources: string[];
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

function detectSport(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [keyword, sport] of Object.entries(SPORT_KEYWORDS)) {
    if (lower.includes(keyword)) return sport;
  }
  return null;
}

function extractTeamNames(title: string): string[] {
  // Try to extract team names from prediction market titles
  // Common formats: "Will the Lakers beat the Celtics?", "Lakers vs Celtics", "NBA: Lakers - Celtics"
  const vsMatch = title.match(/(\w[\w\s]+?)\s+(?:vs\.?|v\.?|versus|-)\s+(\w[\w\s]+?)(?:\?|$|,|\s+(?:in|on|at))/i);
  if (vsMatch) return [vsMatch[1].trim(), vsMatch[2].trim()];
  return [];
}

export async function getSportsOdds(title: string, description: string | null): Promise<SportsContext> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return { context: '', freshness: 'none', sources: [] };
  }

  const sources: string[] = [];
  const parts: string[] = [];

  try {
    const axios = require('axios');
    const sport = detectSport(title);

    if (!sport) {
      // Try to get odds for all sports and match by team name
      return { context: '', freshness: 'none', sources: [] };
    }

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
    const teamNames = extractTeamNames(title);

    // Find the most relevant game
    let matchedGame: OddsData | null = null;
    for (const game of games) {
      const gameTeams = [game.homeTeam.toLowerCase(), game.awayTeam.toLowerCase()];
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
      parts.push(`- Matchup: ${matchedGame.homeTeam} vs ${matchedGame.awayTeam}`);
      parts.push(`- Sport: ${matchedGame.sport}`);
      parts.push(`- Start: ${new Date(matchedGame.commenceTime).toLocaleString()}`);

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
          // Convert American odds to implied probability
          const impliedProb = avg > 0
            ? 100 / (avg + 100)
            : Math.abs(avg) / (Math.abs(avg) + 100);
          parts.push(`- ${name}: avg ${avg > 0 ? '+' : ''}${avg.toFixed(0)} (implied: ${(impliedProb * 100).toFixed(1)}%)`);
        }
      }

      // Add spread info
      const spreads = matchedGame.bookmakers[0]?.markets.find(m => m.key === 'spreads');
      if (spreads) {
        parts.push(`### Spread`);
        for (const o of spreads.outcomes) {
          parts.push(`- ${o.name}: ${o.price > 0 ? '+' : ''}${o.price}`);
        }
      }

      sources.push('The Odds API');
    } else if (games.length > 0) {
      // No exact match, but show upcoming games in the sport
      parts.push(`## Upcoming ${sport} Games (The Odds API)`);
      for (const game of games.slice(0, 3)) {
        parts.push(`- ${game.homeTeam} vs ${game.awayTeam} (${new Date(game.commenceTime).toLocaleDateString()})`);
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
