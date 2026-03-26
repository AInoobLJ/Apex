import { SignalOutput, EdgeOutput, SignalContribution, clampProbability, ModuleId } from '@apex/shared';
import { EDGE_ACTIONABILITY_THRESHOLD } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { applyCalibration, fuseSignals, RawSignal } from '@apex/cortex';

export interface CortexInput {
  marketId: string;
  marketPrice: number;
  marketCategory: string;
  signals: SignalOutput[];
  closesAt?: Date | null;
}

/**
 * CORTEX v3: calibration → signal fusion → edge calculation → Kelly sizing.
 *
 * Delegates probability fusion to the canonical SignalFusionEngine in @apex/cortex,
 * which handles time decay, module weighting, and agreement scoring.
 * Adds calibration corrections (pre-fusion) and Kelly sizing (post-fusion).
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

  // ── Stage 1: Calibration ──
  // Apply per-module, per-category, per-time-bucket bias corrections
  const calibratedSignals = signals.map(s => {
    const { calibrated, correction, sampleSize } = applyCalibration(
      s.probability, s.moduleId, marketCategory, daysToResolution
    );
    if (correction !== 0) {
      logger.debug({ moduleId: s.moduleId, raw: s.probability, calibrated, correction, sampleSize },
        'Calibration correction applied');
    }
    return { ...s, probability: calibrated };
  });

  // ── Stage 2: Signal Fusion (canonical engine) ──
  // Filter out ARBEX/SPEEDEX from probability synthesis (they produce arb signals, not probability)
  const probabilitySignals = calibratedSignals.filter(
    s => s.moduleId !== 'ARBEX' && s.moduleId !== 'SPEEDEX'
  );

  if (probabilitySignals.length === 0) {
    return { ...makeNullEdge(marketId, marketPrice), daysToResolution, capitalEfficiency: 0 };
  }

  // Convert to RawSignal format for the canonical fusion engine
  const rawSignals: RawSignal[] = probabilitySignals.map(s => ({
    moduleId: s.moduleId,
    probability: s.probability,
    confidence: s.confidence,
    reasoning: s.reasoning ?? '',
    createdAt: s.timestamp,
    metadata: s.metadata as Record<string, unknown> | undefined,
  }));

  const fused = fuseSignals(rawSignals);

  // ── Stage 3: Edge Calculation ──
  const cortexProbability = clampProbability(fused.probability);
  const confidence = clampProbability(fused.confidence);
  const conflictFlag = fused.agreementScore < 0.5; // low agreement = conflict
  const edgeMagnitude = Math.abs(cortexProbability - marketPrice);
  const edgeDirection = cortexProbability > marketPrice ? 'BUY_YES' as const : 'BUY_NO' as const;
  const expectedValue = edgeMagnitude * confidence;
  const capitalEfficiency = edgeMagnitude / Math.sqrt(daysToResolution);

  // ── Stage 4: Kelly Sizing ──
  // f* = (p*b - q) / b, then quarter-Kelly for safety
  // b = payoff odds = (1/betPrice - 1)
  const p = cortexProbability;
  const q = 1 - p;
  const betPrice = edgeDirection === 'BUY_YES' ? marketPrice : (1 - marketPrice);
  const b = betPrice > 0.001 && betPrice < 0.999 ? (1 / betPrice - 1) : 0;
  const rawKelly = b > 0 ? (p * b - q) / b : 0;
  const kellySize = Math.max(0, rawKelly * 0.25); // quarter-Kelly

  // Build signal contributions from fusion results
  const signalContributions: SignalContribution[] = fused.contributingModules.map(cm => ({
    moduleId: cm.moduleId as ModuleId,
    probability: cm.probability,
    confidence: cm.decayedConfidence,
    weight: cm.weight,
    reasoning: probabilitySignals.find(s => s.moduleId === cm.moduleId)?.reasoning ?? '',
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
    kellySize,
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
