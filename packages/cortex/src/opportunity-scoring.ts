/**
 * OpportunityScoringEngine — calculates EV, capital efficiency, and ranks opportunities.
 *
 * Takes fused probability + market price → edge → EV → rank.
 * Incorporates time-to-resolution, fee drag, and portfolio constraints.
 */

export interface OpportunityScore {
  edgeMagnitude: number;        // |fair_value - market_price|
  edgeDirection: 'BUY_YES' | 'BUY_NO';
  expectedValue: number;         // edge × confidence (what we expect to make per dollar)
  capitalEfficiency: number;     // EV / sqrt(days_to_resolution) — penalize long holds
  feeDrag: number;               // estimated fee as % of edge
  netEdge: number;               // edge - fees
  rank: number;                  // 1 = best opportunity
  kellyFraction: number;         // optimal position size (fractional Kelly)
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

/**
 * Calculate Kalshi fee: ceil(0.07 × contracts × price × (1-price))
 */
function kalshiFee(price: number): number {
  return 0.07 * price * (1 - price);
}

/**
 * Calculate Polymarket fee (taker): ~2% of notional
 */
function polymarketFee(price: number): number {
  return 0.02 * price;
}

/**
 * Score a single opportunity.
 */
export function scoreOpportunity(input: ScoringInput): OpportunityScore {
  const { fusedProbability, fusedConfidence, marketPrice, daysToResolution, platform, volume } = input;

  // Edge calculation
  const rawEdge = fusedProbability - marketPrice;
  const edgeMagnitude = Math.abs(rawEdge);
  const edgeDirection: 'BUY_YES' | 'BUY_NO' = rawEdge > 0 ? 'BUY_YES' : 'BUY_NO';

  // Fee calculation
  const feeRate = platform === 'KALSHI' ? kalshiFee(marketPrice) : polymarketFee(marketPrice);
  const feeDrag = edgeMagnitude > 0 ? feeRate / edgeMagnitude : 1;
  const netEdge = Math.max(0, edgeMagnitude - feeRate);

  // Expected value = net edge × confidence
  const expectedValue = netEdge * fusedConfidence;

  // Capital efficiency: penalize long-duration holds
  // A 5% edge resolving in 3 days >> 5% edge resolving in 300 days
  const daysClamp = Math.max(0.1, daysToResolution);
  const capitalEfficiency = expectedValue / Math.sqrt(daysClamp);

  // Kelly criterion (quarter-Kelly for safety)
  // f* = (p × b - q) / b where b = odds, p = win prob, q = 1-p
  const winProb = 0.5 + fusedConfidence * 0.3; // rough win rate estimate
  const odds = 1 / marketPrice - 1; // if buying YES at marketPrice
  const kellyFull = Math.max(0, (winProb * odds - (1 - winProb)) / odds);
  const kellyFraction = kellyFull * 0.25; // quarter-Kelly

  // Actionability check
  const isActionable = edgeMagnitude >= MIN_EDGE
    && expectedValue >= MIN_EV
    && fusedConfidence >= MIN_CONFIDENCE
    && volume >= MIN_VOLUME
    && netEdge > 0;

  // Reasoning
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
