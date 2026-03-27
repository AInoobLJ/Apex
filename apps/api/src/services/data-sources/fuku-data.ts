/**
 * Fuku Predictions API — free public sports predictions API.
 * Aggregates 20+ data sources and provides pre-computed predictions,
 * team/player metrics, and market edges for CBB, NBA, NHL, and Soccer.
 *
 * Base URL: https://cbb-predictions-api-nzpk.onrender.com
 * No API key required. Rate-limited — cache aggressively.
 *
 * Tiered caching:
 *   Predictions: 30 min (update throughout the day as lines move)
 *   Rankings:    6 hours (change slowly)
 *   Teams:       6 hours
 *   Players:     6 hours
 */
import { logger } from '../../lib/logger';

const FUKU_BASE = 'https://cbb-predictions-api-nzpk.onrender.com';
const REQUEST_TIMEOUT = 15000; // Render free tier can be slow

// ── Cache TTLs ──
const CACHE_TTL = {
  PREDICTIONS: 30 * 60 * 1000,   // 30 minutes
  RANKINGS:    6 * 60 * 60 * 1000, // 6 hours
  TEAMS:       6 * 60 * 60 * 1000, // 6 hours
  PLAYERS:     6 * 60 * 60 * 1000, // 6 hours
} as const;

// ── Types ──

export interface FukuPrediction {
  home_team: string;
  away_team: string;
  fuku_spread: number;
  fuku_total: number;
  projected_home_score: number;
  projected_away_score: number;
  book_spread: number | null;
  book_total: number | null;
  game_time: string | null;
  // CBB-specific fields (present on CBB predictions)
  spread_edge?: number;
  total_edge?: number;
  spread_pick?: string;
  total_pick?: string;
  confidence?: number;
  ou_signal?: number;
  ou_confidence?: string;
  ou_pick?: string;
  ou_edge_pct?: number;
  situational?: {
    home_team: string;
    away_team: string;
    factors: string[];
    fuku_spread: number;
  };
  game_id?: string;
}

export interface FukuTeam {
  team_name: string;
  conference?: string;
  division?: string;
  overall_rank?: number;
  fuku_rating?: number;
  composite_off_rating?: number;
  composite_def_rating?: number;
  composite_net_rating?: number;
  ppg?: number;
  opp_ppg?: number;
  point_diff?: number;
  pace?: number;
  win_pct?: number;
  home_record?: string;
  road_record?: string;
  // NHL-specific
  goals_for?: number;
  goals_against?: number;
  // Soccer-specific
  xg?: number;
  xga?: number;
}

export interface FukuRanking {
  team_name: string;
  conference?: string;
  overall_rank: number;
  overall_score?: number;
  offense_rank?: number;
  defense_rank?: number;
  categories?: Record<string, any>;
  rating_data?: Record<string, any>;
}

export interface FukuPredictionsResponse {
  success?: boolean;
  date?: string;
  total_games?: number;
  total_matches?: number;
  games?: FukuPrediction[];
  matches?: FukuPrediction[];
  predictions?: FukuPrediction[];
  data_sources?: string[];
}

/** Structured features extracted from Fuku data for the FeatureModel */
export interface FukuFeatures {
  projectedSpread: number;
  spreadEdge: number | null;        // Fuku spread - book spread
  projectedTotal: number;
  totalEdge: number | null;         // Fuku total - book total
  projectedHomeScore: number;
  projectedAwayScore: number;
  homeTeamRank: number | null;
  awayTeamRank: number | null;
  offensiveEfficiencyDiff: number | null;
  defensiveEfficiencyDiff: number | null;
  tempoDiff: number | null;
  modelConfidence: number | null;   // How large is the edge relative to the spread
  bookSpread: number | null;
  bookTotal: number | null;
  homeWinPct: number | null;
  awayWinPct: number | null;
  homeNetRating: number | null;
  awayNetRating: number | null;
}

export interface FukuContext {
  /** Markdown context string for LLM fallback (if ever needed) */
  context: string;
  freshness: 'live' | 'cached' | 'stale' | 'none';
  sources: string[];
  /** Structured features — when present, SPORTS-EDGE can skip LLM call */
  features: FukuFeatures | null;
  /** The matched prediction, if any */
  prediction: FukuPrediction | null;
}

// ── In-memory cache ──
interface CacheEntry<T> { data: T; fetchedAt: number; }
const predictionCache = new Map<string, CacheEntry<FukuPrediction[]>>();
const teamCache = new Map<string, CacheEntry<FukuTeam[]>>();
const rankingCache = new Map<string, CacheEntry<FukuRanking[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < ttl) return entry.data;
  return null;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

async function fetchJson(url: string): Promise<any> {
  const axios = require('axios');
  const resp = await axios.get(url, { timeout: REQUEST_TIMEOUT });
  return resp.data;
}

// ── Sport detection ──

type FukuSport = 'cbb' | 'nba' | 'nhl' | 'soccer' | 'mlb';

/** Map of keywords → Fuku sport. Order matters: more specific first. */
const FUKU_SPORT_KEYWORDS: [string, FukuSport][] = [
  // CBB
  ['ncaa basketball', 'cbb'], ['college basketball', 'cbb'], ['march madness', 'cbb'],
  ['ncaa tournament', 'cbb'], ['final four', 'cbb'], ['sweet sixteen', 'cbb'],
  ['elite eight', 'cbb'],
  // NBA
  ['nba', 'nba'],
  // NHL
  ['nhl', 'nhl'], ['stanley cup', 'nhl'],
  // MLB
  ['mlb', 'mlb'], ['world series', 'mlb'],
  // Soccer leagues
  ['premier league', 'soccer'], ['epl', 'soccer'], ['la liga', 'soccer'],
  ['bundesliga', 'soccer'], ['serie a', 'soccer'], ['ligue 1', 'soccer'],
  ['champions league', 'soccer'], ['europa league', 'soccer'], ['mls', 'soccer'],
];

// NBA team names for detection without "NBA" keyword
const NBA_TEAM_NAMES = [
  'hawks', 'celtics', 'nets', 'hornets', 'bulls', 'cavaliers', 'cavs', 'mavericks', 'mavs',
  'nuggets', 'pistons', 'warriors', 'rockets', 'pacers', 'clippers', 'lakers', 'grizzlies',
  'heat', 'bucks', 'timberwolves', 'pelicans', 'knicks', 'thunder', 'magic', '76ers', 'sixers',
  'suns', 'blazers', 'trail blazers', 'kings', 'raptors', 'jazz', 'wizards',
];

const NHL_TEAM_NAMES = [
  'ducks', 'bruins', 'sabres', 'flames', 'hurricanes', 'blackhawks', 'avalanche',
  'blue jackets', 'stars', 'red wings', 'oilers', 'panthers', 'penguins',
  'sharks', 'kraken', 'blues', 'lightning', 'maple leafs', 'canucks',
  'golden knights', 'capitals', 'rangers', 'islanders', 'devils', 'predators',
  'canadiens', 'wild', 'senators', 'flyers',
];

// Soccer team names (EPL + major clubs)
const SOCCER_TEAM_NAMES = [
  'arsenal', 'liverpool', 'chelsea', 'tottenham', 'man united', 'manchester united',
  'man city', 'manchester city', 'newcastle', 'aston villa', 'west ham', 'brighton',
  'everton', 'crystal palace', 'fulham', 'bournemouth', 'brentford', 'wolves',
  'nottingham', 'real madrid', 'barcelona', 'bayern', 'dortmund', 'juventus',
  'ac milan', 'inter milan', 'napoli', 'psg', 'atletico',
];

export function detectFukuSport(title: string): FukuSport | null {
  const lower = title.toLowerCase();

  // Explicit keyword match first
  for (const [keyword, sport] of FUKU_SPORT_KEYWORDS) {
    if (lower.includes(keyword)) return sport;
  }

  // Team name fallback
  if (NBA_TEAM_NAMES.some(t => lower.includes(t))) return 'nba';
  if (NHL_TEAM_NAMES.some(t => lower.includes(t))) return 'nhl';
  if (SOCCER_TEAM_NAMES.some(t => lower.includes(t))) return 'soccer';

  return null;
}

// ── Soccer league detection for team endpoints ──
const SOCCER_LEAGUE_KEYWORDS: [string, string][] = [
  ['premier league', 'epl'], ['epl', 'epl'],
  ['la liga', 'esp'], ['bundesliga', 'ger'], ['serie a', 'ita'],
  ['ligue 1', 'fra'], ['mls', 'mls'],
  ['champions league', 'ucl'], ['europa league', 'uel'],
  // Team → league
  ['arsenal', 'epl'], ['liverpool', 'epl'], ['chelsea', 'epl'], ['tottenham', 'epl'],
  ['man united', 'epl'], ['manchester united', 'epl'], ['man city', 'epl'], ['manchester city', 'epl'],
  ['newcastle', 'epl'], ['aston villa', 'epl'], ['west ham', 'epl'], ['brighton', 'epl'],
  ['everton', 'epl'], ['crystal palace', 'epl'], ['fulham', 'epl'], ['bournemouth', 'epl'],
  ['real madrid', 'esp'], ['barcelona', 'esp'], ['atletico', 'esp'],
  ['bayern', 'ger'], ['dortmund', 'ger'],
  ['juventus', 'ita'], ['ac milan', 'ita'], ['inter milan', 'ita'], ['napoli', 'ita'],
  ['psg', 'fra'],
];

function detectSoccerLeague(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [keyword, league] of SOCCER_LEAGUE_KEYWORDS) {
    if (lower.includes(keyword)) return league;
  }
  return null;
}

// ── Fetch functions ──

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
}

async function fetchPredictions(sport: FukuSport, date?: string): Promise<FukuPrediction[]> {
  const d = date || getTodayDate();
  const cacheKey = `${sport}:${d}`;
  const cached = getCached(predictionCache, cacheKey, CACHE_TTL.PREDICTIONS);
  if (cached) return cached;

  try {
    const endpoint = sport === 'soccer'
      ? `${FUKU_BASE}/api/public/soccer/predictions?date=${d}`
      : `${FUKU_BASE}/api/public/${sport}/predictions?date=${d}`;

    const data = await fetchJson(endpoint);

    // Response format varies: { games: [...] } or { matches: [...] } or [...]
    let predictions: FukuPrediction[] = [];
    if (Array.isArray(data)) {
      predictions = data;
    } else if (data.games) {
      predictions = data.games;
    } else if (data.matches) {
      predictions = data.matches;
    } else if (data.predictions) {
      predictions = data.predictions;
    }

    setCache(predictionCache, cacheKey, predictions);
    logger.info({ sport, date: d, count: predictions.length }, 'Fuku predictions fetched');
    return predictions;
  } catch (err: any) {
    logger.debug({ err: err.message, sport, date: d }, 'Fuku predictions fetch failed');
    return [];
  }
}

async function fetchTeams(sport: FukuSport, league?: string): Promise<FukuTeam[]> {
  const cacheKey = `${sport}:${league || 'all'}`;
  const cached = getCached(teamCache, cacheKey, CACHE_TTL.TEAMS);
  if (cached) return cached;

  try {
    let url: string;
    if (sport === 'soccer' && league) {
      url = `${FUKU_BASE}/api/public/soccer/teams?league=${league}`;
    } else {
      url = `${FUKU_BASE}/api/public/${sport}/teams`;
    }

    const data = await fetchJson(url);
    const teams: FukuTeam[] = Array.isArray(data) ? data : data.teams || data.data || [];
    setCache(teamCache, cacheKey, teams);
    logger.debug({ sport, league, count: teams.length }, 'Fuku teams fetched');
    return teams;
  } catch (err: any) {
    logger.debug({ err: err.message, sport }, 'Fuku teams fetch failed');
    return [];
  }
}

async function fetchRankings(sport: 'cbb'): Promise<FukuRanking[]> {
  const cacheKey = sport;
  const cached = getCached(rankingCache, cacheKey, CACHE_TTL.RANKINGS);
  if (cached) return cached;

  try {
    const data = await fetchJson(`${FUKU_BASE}/api/public/${sport}/rankings`);
    const rankings: FukuRanking[] = Array.isArray(data) ? data : data.rankings || data.data || [];
    setCache(rankingCache, cacheKey, rankings);
    logger.debug({ sport, count: rankings.length }, 'Fuku rankings fetched');
    return rankings;
  } catch (err: any) {
    logger.debug({ err: err.message, sport }, 'Fuku rankings fetch failed');
    return [];
  }
}

// ── Team matching ──

function normalizeTeamName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function teamsMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (na === nb) return true;
  // Partial match: one contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  // Last-word match (e.g., "Celtics" matches "Boston Celtics")
  const lastA = na.split(' ').pop() || '';
  const lastB = nb.split(' ').pop() || '';
  if (lastA.length >= 4 && lastB.length >= 4 && (lastA === lastB)) return true;
  return false;
}

function findMatchingPrediction(predictions: FukuPrediction[], title: string): FukuPrediction | null {
  const lower = title.toLowerCase();
  for (const p of predictions) {
    const home = normalizeTeamName(p.home_team);
    const away = normalizeTeamName(p.away_team);
    // Check if either team name appears in the market title
    if (lower.includes(home) || lower.includes(away)) return p;
    // Last-word match
    const homeLast = home.split(' ').pop() || '';
    const awayLast = away.split(' ').pop() || '';
    if (homeLast.length >= 4 && lower.includes(homeLast)) return p;
    if (awayLast.length >= 4 && lower.includes(awayLast)) return p;
  }
  return null;
}

function findTeam(teams: FukuTeam[], name: string): FukuTeam | null {
  for (const t of teams) {
    if (teamsMatch(t.team_name, name)) return t;
  }
  return null;
}

// ── Feature extraction ──

function extractFeatures(
  prediction: FukuPrediction,
  homeTeam: FukuTeam | null,
  awayTeam: FukuTeam | null,
): FukuFeatures {
  const spreadEdge = (prediction.spread_edge != null)
    ? prediction.spread_edge
    : (prediction.book_spread != null ? prediction.fuku_spread - prediction.book_spread : null);

  const totalEdge = (prediction.total_edge != null)
    ? prediction.total_edge
    : (prediction.book_total != null ? prediction.fuku_total - prediction.book_total : null);

  // Model confidence: edge relative to spread magnitude
  const modelConfidence = prediction.confidence ?? (
    spreadEdge != null && prediction.fuku_spread !== 0
      ? Math.abs(spreadEdge) / Math.abs(prediction.fuku_spread)
      : null
  );

  return {
    projectedSpread: prediction.fuku_spread,
    spreadEdge,
    projectedTotal: prediction.fuku_total,
    totalEdge,
    projectedHomeScore: prediction.projected_home_score,
    projectedAwayScore: prediction.projected_away_score,
    homeTeamRank: homeTeam?.overall_rank ?? null,
    awayTeamRank: awayTeam?.overall_rank ?? null,
    offensiveEfficiencyDiff:
      (homeTeam?.composite_off_rating != null && awayTeam?.composite_off_rating != null)
        ? homeTeam.composite_off_rating - awayTeam.composite_off_rating
        : null,
    defensiveEfficiencyDiff:
      (homeTeam?.composite_def_rating != null && awayTeam?.composite_def_rating != null)
        ? homeTeam.composite_def_rating - awayTeam.composite_def_rating
        : null,
    tempoDiff:
      (homeTeam?.pace != null && awayTeam?.pace != null)
        ? homeTeam.pace - awayTeam.pace
        : null,
    modelConfidence,
    bookSpread: prediction.book_spread ?? null,
    bookTotal: prediction.book_total ?? null,
    homeWinPct: homeTeam?.win_pct ?? null,
    awayWinPct: awayTeam?.win_pct ?? null,
    homeNetRating: homeTeam?.composite_net_rating ?? homeTeam?.point_diff ?? null,
    awayNetRating: awayTeam?.composite_net_rating ?? awayTeam?.point_diff ?? null,
  };
}

function featuresToMarkdown(features: FukuFeatures, prediction: FukuPrediction, sport: FukuSport): string {
  const parts: string[] = [
    `## Fuku ${sport.toUpperCase()} Prediction`,
    `- Matchup: ${prediction.home_team} (HOME) vs ${prediction.away_team} (AWAY)`,
    `- Projected Score: ${prediction.projected_home_score.toFixed(1)} - ${prediction.projected_away_score.toFixed(1)}`,
    `- Fuku Spread: ${features.projectedSpread > 0 ? '+' : ''}${features.projectedSpread.toFixed(1)}`,
    `- Fuku Total: ${features.projectedTotal.toFixed(1)}`,
  ];

  if (features.bookSpread != null) {
    parts.push(`- Book Spread: ${features.bookSpread > 0 ? '+' : ''}${features.bookSpread.toFixed(1)}`);
    parts.push(`- Spread Edge: ${features.spreadEdge != null ? features.spreadEdge.toFixed(1) : 'N/A'}`);
  }
  if (features.bookTotal != null) {
    parts.push(`- Book Total: ${features.bookTotal.toFixed(1)}`);
    parts.push(`- Total Edge: ${features.totalEdge != null ? features.totalEdge.toFixed(1) : 'N/A'}`);
  }

  if (prediction.spread_pick) parts.push(`- Spread Pick: ${prediction.spread_pick}`);
  if (prediction.total_pick) parts.push(`- Total Pick: ${prediction.total_pick}`);

  if (features.homeTeamRank != null || features.awayTeamRank != null) {
    parts.push('### Team Rankings');
    if (features.homeTeamRank != null) parts.push(`- ${prediction.home_team}: #${features.homeTeamRank}`);
    if (features.awayTeamRank != null) parts.push(`- ${prediction.away_team}: #${features.awayTeamRank}`);
  }

  if (features.offensiveEfficiencyDiff != null) {
    parts.push(`### Efficiency Differentials`);
    parts.push(`- Offensive: ${features.offensiveEfficiencyDiff > 0 ? '+' : ''}${features.offensiveEfficiencyDiff.toFixed(1)} (home advantage)`);
    if (features.defensiveEfficiencyDiff != null) {
      parts.push(`- Defensive: ${features.defensiveEfficiencyDiff > 0 ? '+' : ''}${features.defensiveEfficiencyDiff.toFixed(1)} (home advantage, lower = better)`);
    }
    if (features.tempoDiff != null) {
      parts.push(`- Tempo/Pace: ${features.tempoDiff > 0 ? '+' : ''}${features.tempoDiff.toFixed(1)} possessions`);
    }
  }

  if (features.homeWinPct != null && features.awayWinPct != null) {
    parts.push(`### Win Rates`);
    parts.push(`- ${prediction.home_team}: ${(features.homeWinPct * 100).toFixed(0)}%`);
    parts.push(`- ${prediction.away_team}: ${(features.awayWinPct * 100).toFixed(0)}%`);
  }

  return parts.join('\n');
}

// ── Main export ──

/**
 * Fetch Fuku prediction data for a sports market.
 * Returns structured features AND markdown context.
 * When features are non-null, SPORTS-EDGE can skip the LLM call entirely.
 */
export async function getFukuData(title: string, description: string | null): Promise<FukuContext> {
  try {
    const sport = detectFukuSport(title);
    if (!sport) {
      return { context: '', freshness: 'none', sources: [], features: null, prediction: null };
    }

    // Fetch predictions + team data in parallel
    const league = sport === 'soccer' ? detectSoccerLeague(title) : undefined;
    const [predictions, teams] = await Promise.allSettled([
      fetchPredictions(sport),
      fetchTeams(sport, league ?? undefined),
    ]);

    const predList = predictions.status === 'fulfilled' ? predictions.value : [];
    const teamList = teams.status === 'fulfilled' ? teams.value : [];

    // Find matching prediction
    const matched = findMatchingPrediction(predList, title);
    if (!matched) {
      // No prediction match — Fuku doesn't cover this specific game
      // Still return team data as context if available
      return { context: '', freshness: 'none', sources: [], features: null, prediction: null };
    }

    // Find team profiles
    const homeTeam = findTeam(teamList, matched.home_team);
    const awayTeam = findTeam(teamList, matched.away_team);

    // Extract structured features
    const features = extractFeatures(matched, homeTeam, awayTeam);
    const context = featuresToMarkdown(features, matched, sport);

    logger.info({
      sport,
      home: matched.home_team,
      away: matched.away_team,
      spread: matched.fuku_spread,
      total: matched.fuku_total,
      spreadEdge: features.spreadEdge,
      totalEdge: features.totalEdge,
    }, 'Fuku prediction matched');

    return {
      context,
      freshness: 'live',
      sources: ['Fuku Predictions'],
      features,
      prediction: matched,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, 'Fuku data fetch failed');
    return { context: '', freshness: 'none', sources: [], features: null, prediction: null };
  }
}

/**
 * Health check — call on startup to verify Fuku API is reachable.
 */
export async function checkFukuHealth(): Promise<boolean> {
  try {
    const data = await fetchJson(`${FUKU_BASE}/api/public/health`);
    const ok = data?.status === 'ok';
    logger.info({ ok, version: data?.version }, 'Fuku API health check');
    return ok;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Fuku API health check failed — will fall back to Odds API');
    return false;
  }
}
