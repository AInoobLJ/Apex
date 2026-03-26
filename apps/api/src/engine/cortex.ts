import { SignalOutput, EdgeOutput, SignalContribution, clampProbability, ModuleId, MODULE_HALF_LIVES, DEFAULT_WEIGHTS } from '@apex/shared';
import { EDGE_ACTIONABILITY_THRESHOLD } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface CortexInput {
  marketId: string;
  marketPrice: number;
  marketCategory: string;
  signals: SignalOutput[];
  closesAt?: Date | null;
}

/**
 * CORTEX v2: weighted synthesis with time decay, conflict detection, and coverage-adjusted confidence.
 * Falls back to v1 (equal weights) if no DB weights available.
 */
export function synthesize(input: CortexInput): EdgeOutput & { daysToResolution: number; capitalEfficiency: number } {
  const { signals, marketPrice, marketId, marketCategory, closesAt } = input;

  // Calculate days to resolution
  const daysToResolution = closesAt
    ? Math.max(1, Math.ceil((closesAt.getTime() - Date.now()) / 86400000))
    : 365; // default assumption for markets without close date

  if (signals.length === 0) {
    return { ...makeNullEdge(marketId, marketPrice), daysToResolution, capitalEfficiency: 0 };
  }

  const now = Date.now();

  // Apply time decay and compute weights
  const weightedSignals = signals.map(s => {
    const ageMinutes = (now - s.timestamp.getTime()) / 60000;
    const halfLife = MODULE_HALF_LIVES[s.moduleId] ?? 60;
    const decayFactor = Math.exp(-Math.LN2 * ageMinutes / halfLife);

    // Get module weight for this category (default weights)
    const categoryWeights = DEFAULT_WEIGHTS[s.moduleId];
    const baseWeight = categoryWeights?.[marketCategory] ?? categoryWeights?.OTHER ?? 0.10;

    // Skip ARBEX/SPEEDEX in probability synthesis (they produce arb signals, not probability estimates)
    if (s.moduleId === 'ARBEX' || s.moduleId === 'SPEEDEX') {
      return { signal: s, weight: 0, decayedConfidence: s.confidence * decayFactor };
    }

    const weight = baseWeight * decayFactor * s.confidence;
    return { signal: s, weight, decayedConfidence: s.confidence * decayFactor };
  });

  // Filter to signals with non-zero weight for synthesis
  const activeSignals = weightedSignals.filter(ws => ws.weight > 0);

  if (activeSignals.length === 0) {
    return { ...makeNullEdge(marketId, marketPrice), daysToResolution, capitalEfficiency: 0 };
  }

  // Weighted average probability
  const totalWeight = activeSignals.reduce((sum, ws) => sum + ws.weight, 0);
  const weightedProb = activeSignals.reduce((sum, ws) => sum + ws.signal.probability * ws.weight, 0) / totalWeight;

  // Conflict detection: flag when module spread > 0.20
  const probs = activeSignals.map(ws => ws.signal.probability);
  const spread = Math.max(...probs) - Math.min(...probs);
  const conflictFlag = spread > 0.20;

  // Confidence: weighted average of decayed confidences, penalized by disagreement
  const avgConfidence = activeSignals.reduce((sum, ws) => sum + ws.decayedConfidence * ws.weight, 0) / totalWeight;
  const disagreementPenalty = conflictFlag ? Math.max(0.3, 1 - spread) : 1;

  // Coverage factor: gentle scaling, NOT harsh N/10.
  // Missing modules = "no opinion" (neutral), not "disagreement" (penalty).
  // 1 module = 0.5, 2 = 0.65, 3+ = 0.8+, 6+ = 1.0
  const coverageFactor = Math.min(1, 0.4 + signals.length * 0.1);
  let confidence = clampProbability(avgConfidence * disagreementPenalty * coverageFactor);

  // Floor: if 3+ modules contribute, minimum 20% confidence
  if (signals.length >= 3 && confidence < 0.20) {
    confidence = 0.20;
  }

  const cortexProbability = clampProbability(weightedProb);
  const edgeMagnitude = Math.abs(cortexProbability - marketPrice);
  const edgeDirection = cortexProbability > marketPrice ? 'BUY_YES' as const : 'BUY_NO' as const;
  const expectedValue = edgeMagnitude * confidence;
  const capitalEfficiency = edgeMagnitude / Math.sqrt(daysToResolution);

  const signalContributions: SignalContribution[] = weightedSignals.map(ws => ({
    moduleId: ws.signal.moduleId,
    probability: ws.signal.probability,
    confidence: ws.decayedConfidence,
    weight: totalWeight > 0 ? ws.weight / totalWeight : 0,
    reasoning: ws.signal.reasoning,
  }));

  return {
    marketId,
    cortexProbability,
    marketPrice,
    edgeMagnitude,
    edgeDirection,
    confidence,
    expectedValue,
    signals: signalContributions,
    kellySize: 0,
    isActionable: expectedValue >= EDGE_ACTIONABILITY_THRESHOLD,
    conflictFlag,
    timestamp: new Date(),
    daysToResolution,
    capitalEfficiency,
  };
}

function makeNullEdge(marketId: string, marketPrice: number): EdgeOutput {
  return {
    marketId,
    cortexProbability: marketPrice,
    marketPrice,
    edgeMagnitude: 0,
    edgeDirection: 'BUY_YES',
    confidence: 0,
    expectedValue: 0,
    signals: [],
    kellySize: 0,
    isActionable: false,
    conflictFlag: false,
    timestamp: new Date(),
  };
}

/**
 * Persist an EdgeOutput to the database.
 */
export async function persistEdge(edge: EdgeOutput): Promise<string> {
  const record = await prisma.edge.create({
    data: {
      marketId: edge.marketId,
      cortexProbability: edge.cortexProbability,
      marketPrice: edge.marketPrice,
      edgeMagnitude: edge.edgeMagnitude,
      edgeDirection: edge.edgeDirection,
      confidence: edge.confidence,
      expectedValue: edge.expectedValue,
      kellySize: edge.kellySize,
      isActionable: edge.isActionable,
      conflictFlag: edge.conflictFlag,
      signals: edge.signals as unknown as object,
    },
  });

  logger.info(
    { edgeId: record.id, marketId: edge.marketId, ev: edge.expectedValue.toFixed(4), actionable: edge.isActionable, conflict: edge.conflictFlag },
    'Edge persisted'
  );

  return record.id;
}
