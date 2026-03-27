import { createDomexAgent, type DomexAgent, type DomexAgentResult } from './base-agent';
import { getSportsOdds } from '../../services/data-sources/odds-api';
import { getEspnData } from '../../services/data-sources/espn-data';
import { getFukuData, detectFukuSport, type FukuFeatures } from '../../services/data-sources/fuku-data';
import { logger } from '../../lib/logger';
import type { MarketCategory } from '@apex/db';

/**
 * SPORTS-EDGE: Hybrid data-first sports analysis.
 *
 * Market type detection:
 *   MATCH markets  → Fuku predictions or Odds API h2h/spreads/totals
 *   FUTURES markets → return null (Fuku/Odds API match odds are NOT appropriate)
 *
 * Priority chain (for MATCH markets only):
 *   1. Fuku Predictions API — pre-computed features (CBB, NBA, NHL, Soccer).
 *      When available, returns structured features DIRECTLY — no LLM call.
 *   2. The Odds API + ESPN — bookmaker odds + injuries/standings/form.
 *      Used only when Fuku doesn't cover the sport or specific game.
 *      Feeds context to the LLM for feature extraction.
 *
 * Safety:
 *   - FUTURES markets always return null (prevents match-odds-to-futures confusion)
 *   - If ALL sources return no data, returns null (no signal)
 *   - Never hallucinates
 */

// ── Market type detection ──

type SportsMarketType = 'MATCH' | 'FUTURES' | 'UNKNOWN';

/**
 * Detect whether a sports market is about a single MATCH or a FUTURES/outrights outcome.
 *
 * FUTURES keywords: league winner, championship, MVP, tournament winner, season awards.
 * MATCH indicators: "vs", "beat", "tonight", "game", head-to-head phrasing.
 */
const FUTURES_PATTERNS: RegExp[] = [
  // League/championship winners
  /win\s+(the\s+)?(20\d\d[-–]\d\d\s+)?(?:serie\s*a|premier\s*league|epl|la\s*liga|bundesliga|ligue\s*1|nba|nfl|mlb|nhl|mls)/i,
  /win\s+(the\s+)?(20\d\d[-–]?\d{0,2}\s+)?(?:championship|league\s+title|league|title|pennant)/i,
  // Tournament/cup winners
  /win\s+(the\s+)?(20\d\d[-–]?\d{0,2}\s+)?(?:champions\s*league|europa\s*league|world\s*cup|world\s*series|super\s*bowl|stanley\s*cup|fa\s*cup|copa\s*del\s*rey|coppa\s*italia)/i,
  /win\s+(the\s+)?(20\d\d[-–]?\d{0,2}\s+)?(?:tournament|march\s*madness|ncaa\s+tournament|masters|us\s+open|wimbledon|french\s+open|australian\s+open|ryder\s+cup)/i,
  // Awards / MVP
  /(?:win|awarded?)\s+(the\s+)?(20\d\d[-–]?\d{0,4}\s+)?(?:\w+\s+)?(?:mvp|ballon\s*d'or|cy\s+young|heisman|rookie\s+of\s+the\s+year|dpoy|defensive\s+player|most\s+valuable)/i,
  /\bmvp\b/i, // Catch any market with "MVP" — these are always season awards
  // Season-level outcomes
  /make\s+(the\s+)?(?:playoffs?|postseason|final\s+four|elite\s+eight|sweet\s+sixteen|conference\s+finals?|world\s+series)/i,
  /finish\s+(in\s+)?(?:top\s+\d|first|last|bottom)/i,
  /(?:relegated|promotion|promoted)/i,
  // Explicit "champion" phrasing
  /(?:20\d\d[-–]?\d{0,2}\s+)?champion(?:s)?$/i,
  // Conference/division winners
  /win\s+(the\s+)?(?:eastern|western|afc|nfc|al|nl|atlantic|pacific|central|southeast|northwest|southwest)\s+(?:conference|division)/i,
];

const MATCH_PATTERNS: RegExp[] = [
  /\bvs\.?\b|\bversus\b|\bv\.?\b/i,
  /\bbeat\b|\bdefeat\b/i,
  /\btonight\b|\btoday\b|\bthis\s+(?:game|match|fight|bout)\b/i,
  /\bgame\s*\d/i,
  /\bseries\b.*\bgame\b/i,
  /\bmoneyline\b|\bspread\b|\bover\/under\b/i,
];

export function detectSportsMarketType(title: string, closesAt?: Date | null): SportsMarketType {
  const lower = title.toLowerCase();

  // Check FUTURES patterns first (more specific)
  for (const pattern of FUTURES_PATTERNS) {
    if (pattern.test(title)) return 'FUTURES';
  }

  // Check MATCH patterns
  for (const pattern of MATCH_PATTERNS) {
    if (pattern.test(title)) return 'MATCH';
  }

  // Heuristic: if market closes >60 days out + has a team/player name → likely futures
  if (closesAt) {
    const daysOut = (closesAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (daysOut > 60) return 'FUTURES';
  }

  // Default: UNKNOWN — we'll try Fuku/Odds API, but they may not match
  return 'UNKNOWN';
}

// ── Data source tags for signal metadata ──
export type SportsDataSource =
  | 'fuku'              // Fuku API match predictions (data passthrough, no LLM)
  | 'oddsapi-h2h'       // The Odds API head-to-head match odds (LLM extraction)
  | 'espn'              // ESPN data only (LLM extraction)
  | 'futures-blocked'   // Futures market — returned null to prevent confusion
  | 'no-data';          // No data available from any source

/** Convert FukuFeatures to DomexAgentResult features format */
function fukuToAgentResult(features: FukuFeatures, sources: string[]): DomexAgentResult {
  const featureMap: Record<string, string | number | boolean | null> = {
    projectedSpread: features.projectedSpread,
    spreadEdge: features.spreadEdge,
    projectedTotal: features.projectedTotal,
    totalEdge: features.totalEdge,
    projectedHomeScore: features.projectedHomeScore,
    projectedAwayScore: features.projectedAwayScore,
    homeTeamRank: features.homeTeamRank,
    awayTeamRank: features.awayTeamRank,
    offensiveEfficiencyDiff: features.offensiveEfficiencyDiff,
    defensiveEfficiencyDiff: features.defensiveEfficiencyDiff,
    tempoDiff: features.tempoDiff,
    modelConfidence: features.modelConfidence,
    bookSpread: features.bookSpread,
    bookTotal: features.bookTotal,
    homeWinPct: features.homeWinPct,
    awayWinPct: features.awayWinPct,
    homeNetRating: features.homeNetRating,
    awayNetRating: features.awayNetRating,
    // Markers
    fukuDataPassthrough: true,
    sportsDataSource: 'fuku',
    sportsMarketType: 'MATCH',
  };

  // Build reasoning from features
  const spreadInfo = features.spreadEdge != null
    ? `Spread edge: ${features.spreadEdge > 0 ? '+' : ''}${features.spreadEdge.toFixed(1)} (Fuku: ${features.projectedSpread.toFixed(1)}, Book: ${features.bookSpread?.toFixed(1) ?? 'N/A'})`
    : `Projected spread: ${features.projectedSpread.toFixed(1)} (no book line available)`;
  const totalInfo = features.totalEdge != null
    ? `Total edge: ${features.totalEdge > 0 ? '+' : ''}${features.totalEdge.toFixed(1)} (Fuku: ${features.projectedTotal.toFixed(1)}, Book: ${features.bookTotal?.toFixed(1) ?? 'N/A'})`
    : `Projected total: ${features.projectedTotal.toFixed(1)} (no book line available)`;
  const scoreInfo = `Projected: ${features.projectedHomeScore.toFixed(1)} - ${features.projectedAwayScore.toFixed(1)}`;
  const effInfo = features.offensiveEfficiencyDiff != null
    ? `Off eff diff: ${features.offensiveEfficiencyDiff > 0 ? '+' : ''}${features.offensiveEfficiencyDiff.toFixed(1)}, Def eff diff: ${features.defensiveEfficiencyDiff?.toFixed(1) ?? 'N/A'}`
    : '';

  const reasoning = [
    `[Fuku Data Passthrough — no LLM call]`,
    scoreInfo,
    spreadInfo,
    totalInfo,
    effInfo,
    features.homeWinPct != null ? `Win rates: Home ${(features.homeWinPct * 100).toFixed(0)}%, Away ${(features.awayWinPct! * 100).toFixed(0)}%` : '',
  ].filter(Boolean).join('. ');

  return {
    features: featureMap,
    reasoning,
    dataSourcesUsed: sources,
    dataFreshness: 'live',
  };
}

/**
 * The LLM-based fallback agent — only used for MATCH markets when Fuku doesn't cover them.
 * Uses Odds API + ESPN data as context for Claude to extract features.
 */
const llmFallbackAgent = createDomexAgent({
  name: 'SPORTS-EDGE',
  promptFile: 'domex-sports-edge.md',
  categories: ['SPORTS'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: async (title, description) => {
    const [odds, espn] = await Promise.allSettled([
      getSportsOdds(title, description),
      getEspnData(title, description),
    ]);

    const oddsResult = odds.status === 'fulfilled' ? odds.value : { context: '', freshness: 'none' as const, sources: [] };
    const espnResult = espn.status === 'fulfilled' ? espn.value : { context: '', freshness: 'none' as const, sources: [] };

    const context = [oddsResult.context, espnResult.context].filter(Boolean).join('\n\n');
    const sources = [...oddsResult.sources, ...espnResult.sources];
    const freshness = oddsResult.freshness === 'live' || espnResult.freshness === 'live'
      ? 'live' as const
      : oddsResult.freshness !== 'none' || espnResult.freshness !== 'none'
        ? 'cached' as const
        : 'none' as const;

    return { context, freshness, sources };
  },
  requireContext: true,
});

/**
 * SPORTS-EDGE agent — detects market type, then routes appropriately.
 *
 * MATCH markets  → Fuku first, then Odds API + LLM fallback
 * FUTURES markets → return null (match odds don't predict league/tournament winners)
 */
export const sportsEdgeAgent: DomexAgent = {
  name: 'SPORTS-EDGE',
  categories: ['SPORTS'] as MarketCategory[],

  async run(title, description, category, closesAt?) {
    // ── Step 0: Classify market type ──
    const marketType = detectSportsMarketType(title, closesAt);

    if (marketType === 'FUTURES') {
      logger.info({
        agent: 'SPORTS-EDGE',
        marketType: 'FUTURES',
        title: title.slice(0, 80),
      }, 'SPORTS-EDGE: FUTURES market detected — returning null (match odds are not appropriate for futures/outrights)');
      return null;
    }

    // ── Step 1: Try Fuku (data passthrough — no LLM cost) ──
    // Only for MATCH or UNKNOWN markets (Fuku returns match predictions)
    try {
      const fuku = await getFukuData(title, description);

      if (fuku.features && fuku.prediction) {
        logger.info({
          agent: 'SPORTS-EDGE',
          mode: 'fuku-passthrough',
          marketType,
          home: fuku.prediction.home_team,
          away: fuku.prediction.away_team,
        }, 'SPORTS-EDGE: Fuku data passthrough (no LLM call)');

        return fukuToAgentResult(fuku.features, fuku.sources);
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, 'SPORTS-EDGE: Fuku fetch failed, falling back to LLM');
    }

    // ── Step 2: For UNKNOWN markets that didn't match Fuku, check if they're actually futures ──
    // If Fuku returned no match AND the market type is UNKNOWN, it's likely not a head-to-head match.
    // Be conservative: only proceed with LLM fallback for clear MATCH markets.
    if (marketType === 'UNKNOWN') {
      logger.info({
        agent: 'SPORTS-EDGE',
        marketType: 'UNKNOWN',
        title: title.slice(0, 80),
      }, 'SPORTS-EDGE: UNKNOWN market type with no Fuku match — returning null (avoiding match-odds-to-futures confusion)');
      return null;
    }

    // ── Step 3: Fall back to LLM with Odds API + ESPN context (MATCH markets only) ──
    logger.debug({
      agent: 'SPORTS-EDGE',
      mode: 'llm-fallback',
      marketType,
    }, 'SPORTS-EDGE: Fuku has no data for MATCH market, falling back to Odds API + ESPN + LLM');

    const result = await llmFallbackAgent.run(title, description, category, closesAt);

    // Tag the data source in the result
    if (result) {
      result.features.sportsDataSource = result.dataSourcesUsed.includes('The Odds API') ? 'oddsapi-h2h' : 'espn';
      result.features.sportsMarketType = 'MATCH';
    }

    return result;
  },
};
