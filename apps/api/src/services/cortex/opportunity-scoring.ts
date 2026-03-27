/**
 * OpportunityScoringEngine — calculates EV, capital efficiency, and ranks opportunities.
 */

interface ScoringInput {
  cortexProbability: number;
  confidence: number;
  marketPrice: number;
  daysToResolution: number;
  volume: number;
  liquidity: number;
  signalCount: number;
}

interface ScoredOpportunity {
  expectedValue: number;
  capitalEfficiencyScore: number;
  kellySize: number;
  rank: number;
  edgeMagnitude: number;
  edgeDirection: 'BUY_YES' | 'BUY_NO';
  isActionable: boolean;
}

// Minimum EV to be actionable (1%)
const MIN_EV = 0.01;

export function scoreOpportunity(input: ScoringInput): ScoredOpportunity {
  const { cortexProbability, confidence, marketPrice, daysToResolution, volume, liquidity, signalCount } = input;

  // Edge magnitude
  const edgeMagnitude = Math.abs(cortexProbability - marketPrice);
  const edgeDirection: 'BUY_YES' | 'BUY_NO' = cortexProbability > marketPrice ? 'BUY_YES' : 'BUY_NO';

  // Expected value = edge × confidence
  const expectedValue = edgeMagnitude * confidence;

  // Capital efficiency = edge / sqrt(days_to_resolution)
  // A 5% edge resolving in 3 days >> 5% edge resolving in 300 days
  const safeDays = Math.max(0.1, daysToResolution);
  const capitalEfficiencyScore = edgeMagnitude / Math.sqrt(safeDays);

  // Kelly criterion: fraction of bankroll to bet
  // f* = (p * b - q) / b where p = prob of outcome we're betting on, q = 1-p, b = odds
  // BUY_YES: p = cortexProbability (prob of YES — what we're betting on)
  // BUY_NO:  p = 1 - cortexProbability (prob of NO — what we're betting on)
  const p = edgeDirection === 'BUY_YES' ? cortexProbability : (1 - cortexProbability);
  const q = 1 - p;
  const entryPrice = edgeDirection === 'BUY_YES' ? marketPrice : 1 - marketPrice;
  const b = (1 - entryPrice) / entryPrice; // payout odds
  const kellyFull = (p * b - q) / b;
  // Use quarter-Kelly for safety
  const kellySize = Math.max(0, Math.min(0.25, kellyFull * 0.25));

  // Liquidity factor: penalize thin markets
  const liquidityFactor = volume >= 1000 ? 1 : volume >= 100 ? 0.7 : 0.3;

  // Actionability: EV > threshold AND enough signals AND enough liquidity
  const isActionable = expectedValue >= MIN_EV && signalCount >= 2 && liquidityFactor >= 0.7;

  return {
    expectedValue,
    capitalEfficiencyScore,
    kellySize,
    rank: 0, // Set by ranker after sorting
    edgeMagnitude,
    edgeDirection,
    isActionable,
  };
}

/**
 * Rank a list of scored opportunities by composite score.
 * Composite = 0.4 × EV + 0.3 × capitalEfficiency + 0.2 × confidence + 0.1 × liquidity
 */
export function rankOpportunities(
  opportunities: (ScoredOpportunity & { confidence: number; volumeNormalized: number })[]
): void {
  // Normalize each dimension to 0-1 for fair comparison
  const maxEV = Math.max(...opportunities.map(o => o.expectedValue), 0.001);
  const maxCE = Math.max(...opportunities.map(o => o.capitalEfficiencyScore), 0.001);

  const scored = opportunities.map(o => ({
    opp: o,
    composite:
      0.40 * (o.expectedValue / maxEV) +
      0.30 * (o.capitalEfficiencyScore / maxCE) +
      0.20 * o.confidence +
      0.10 * o.volumeNormalized,
  }));

  scored.sort((a, b) => b.composite - a.composite);
  scored.forEach((s, i) => { s.opp.rank = i + 1; });
}
