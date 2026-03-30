/**
 * OpportunityScoringEngine — calculates EV, capital efficiency, and ranks opportunities.
 *
 * Takes fused probability + market price → edge → EV → rank.
 * Incorporates time-to-resolution, fee drag, and portfolio constraints.
 */

export interface OpportunityScore {
  edgeMagnitude: number;        // |fair_value - market_price|
  edgeDirection: 'BUY_YES' | 'BUY_NO';
  expectedValue: number;         // net edge × confidence (what we expect to make per dollar)
  capitalEfficiency: number;     // EV / sqrt(days_to_resolution) — penalize long holds
  feeDrag: number;               // estimated round-trip fee as % of edge
  netEdge: number;               // edge - fees
  rank: number;                  // 1 = best opportunity
  kellyFraction: number;         // optimal position size (quarter-Kelly)
  isActionable: boolean;         // passes minimum thresholds
  reasoning: string;
}

interface ScoringInput {
  fusedProbability: number;
  fusedConfidence: number;
  marketPrice: number;           // current YES price
  daysToResolution: number;
  platform: 'KALSHI' | 'POLYMARKET';
  volume: number;
  category: string;
}

// Minimum thresholds for actionability
const MIN_EDGE = 0.02;          // 2% minimum edge
const MIN_EV = 0.005;           // 0.5% minimum expected value
const MIN_CONFIDENCE = 0.10;    // 10% minimum confidence
const MIN_VOLUME = 100;         // $100 minimum volume

import { platformFeeRate } from '@apex/shared';

/**
 * Score a single opportunity.
 */
export function scoreOpportunity(input: ScoringInput): OpportunityScore {
  const { fusedProbability, fusedConfidence, marketPrice, daysToResolution, platform, volume } = input;

  // ── Input validation ──
  // If any critical input is NaN/invalid, return a safe zero-score (no trade)
  if (!Number.isFinite(fusedProbability) || fusedProbability < 0 || fusedProbability > 1 ||
      !Number.isFinite(fusedConfidence) || fusedConfidence < 0 || fusedConfidence > 1 ||
      !Number.isFinite(marketPrice) || marketPrice <= 0 || marketPrice >= 1 ||
      !Number.isFinite(daysToResolution) || daysToResolution <= 0) {
    return {
      edgeMagnitude: 0, edgeDirection: 'BUY_YES', expectedValue: 0, capitalEfficiency: 0,
      feeDrag: 1, netEdge: 0, rank: 0, kellyFraction: 0, isActionable: false,
      reasoning: `Invalid input: prob=${fusedProbability}, conf=${fusedConfidence}, price=${marketPrice}, days=${daysToResolution}`,
    };
  }

  // ── Edge calculation ──
  const rawEdge = fusedProbability - marketPrice;
  const edgeMagnitude = Math.abs(rawEdge);
  const edgeDirection: 'BUY_YES' | 'BUY_NO' = rawEdge > 0 ? 'BUY_YES' : 'BUY_NO';

  // ── Fee calculation (unified shared calculator) ──
  const feeRate = platformFeeRate(platform, edgeDirection, marketPrice);
  const feeDrag = edgeMagnitude > 0 ? feeRate / edgeMagnitude : 1;
  const netEdge = Math.max(0, edgeMagnitude - feeRate);

  // ── Expected value = net edge × confidence ──
  const expectedValue = netEdge * fusedConfidence;

  // ── Capital efficiency: penalize long-duration holds ──
  const daysClamp = Math.max(0.1, daysToResolution);
  const capitalEfficiency = expectedValue / Math.sqrt(daysClamp);

  // ── Kelly criterion ──
  // f* = (p × b - q) / b
  // p = fusedProbability (our estimated true probability)
  // q = 1 - p
  // b = net odds = (payout / cost) - 1
  //
  // For BUY_YES at marketPrice: cost = marketPrice, payout = 1.0
  //   b = (1 - marketPrice) / marketPrice
  //   p = fusedProbability (prob of YES — what we're betting on)
  // For BUY_NO at marketPrice: cost = (1 - marketPrice), payout = 1.0
  //   b = marketPrice / (1 - marketPrice)
  //   p = 1 - fusedProbability (prob of NO — what we're betting on)
  const p = edgeDirection === 'BUY_YES' ? fusedProbability : (1 - fusedProbability);
  const q = 1 - p;
  const betPrice = edgeDirection === 'BUY_YES' ? marketPrice : (1 - marketPrice);
  const b = betPrice > 0.001 && betPrice < 0.999 ? (1 / betPrice - 1) : 0;
  const kellyFull = b > 0 ? (p * b - q) / b : 0;
  const kellyFraction = Math.max(0, kellyFull * 0.25); // quarter-Kelly, clamped to ≥ 0

  // ── Actionability check ──
  const isActionable = edgeMagnitude >= MIN_EDGE
    && expectedValue >= MIN_EV
    && fusedConfidence >= MIN_CONFIDENCE
    && volume >= MIN_VOLUME
    && netEdge > 0;

  // ── Reasoning ──
  const parts: string[] = [];
  if (edgeMagnitude < MIN_EDGE) parts.push(`edge ${(edgeMagnitude * 100).toFixed(1)}% < ${MIN_EDGE * 100}% min`);
  if (fusedConfidence < MIN_CONFIDENCE) parts.push(`confidence ${(fusedConfidence * 100).toFixed(0)}% < ${MIN_CONFIDENCE * 100}% min`);
  if (netEdge <= 0) parts.push('edge does not survive fees');
  if (volume < MIN_VOLUME) parts.push(`volume $${volume} < $${MIN_VOLUME} min`);

  const reasoning = isActionable
    ? `${edgeDirection}: ${(edgeMagnitude * 100).toFixed(1)}% edge, ${(expectedValue * 100).toFixed(2)}% EV, ${(capitalEfficiency * 10000).toFixed(1)} cap-eff, Kelly ${(kellyFraction * 100).toFixed(1)}%`
    : `Not actionable: ${parts.join(', ')}`;

  return {
    edgeMagnitude,
    edgeDirection,
    expectedValue,
    capitalEfficiency,
    feeDrag,
    netEdge,
    rank: 0, // set during batch ranking
    kellyFraction,
    isActionable,
    reasoning,
  };
}

/**
 * Rank a batch of opportunities by capital efficiency.
 */
export function rankOpportunities(scores: OpportunityScore[]): OpportunityScore[] {
  const actionable = scores.filter(s => s.isActionable);
  const nonActionable = scores.filter(s => !s.isActionable);

  // Sort actionable by capital efficiency (best first)
  actionable.sort((a, b) => b.capitalEfficiency - a.capitalEfficiency);
  actionable.forEach((s, i) => { s.rank = i + 1; });

  // Non-actionable get rank 0
  nonActionable.forEach(s => { s.rank = 0; });

  return [...actionable, ...nonActionable];
}
