import { SignalOutput, EdgeOutput, SignalContribution, clampProbability, ModuleId } from '@apex/shared';
import { EDGE_ACTIONABILITY_THRESHOLD } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { applyCalibration, fuseSignals, RawSignal } from '@apex/cortex';

// LLM modules that analyze the actual event (not just statistical patterns)
const LLM_MODULES = new Set<string>(['LEGEX', 'DOMEX', 'ALTEX', 'REFLEX']);

// Minimum requirements for an edge to be actionable:
// 1. At least 2 modules contributed probability signals
// 2. At least 1 LLM module contributed (pure stats can't analyze the event)
const MIN_MODULES_FOR_ACTIONABLE = 2;
const MIN_LLM_MODULES_FOR_ACTIONABLE = 1;

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

  // ── Actionability Gate ──
  // Must pass ALL three checks:
  // 1. EV exceeds fee-adjusted threshold
  // 2. At least 2 modules contributed probability signals
  // 3. At least 1 LLM module contributed (pure stats alone can't analyze the event)
  const moduleCount = probabilitySignals.length;
  const llmModuleCount = probabilitySignals.filter(s => LLM_MODULES.has(s.moduleId)).length;
  const evMeetsThreshold = expectedValue >= EDGE_ACTIONABILITY_THRESHOLD;
  const hasEnoughModules = moduleCount >= MIN_MODULES_FOR_ACTIONABLE;
  const hasLLMModule = llmModuleCount >= MIN_LLM_MODULES_FOR_ACTIONABLE;
  const isActionable = evMeetsThreshold && hasEnoughModules && hasLLMModule;

  // ── Build "Why is this actionable?" summary ──
  const actionabilitySummary = buildActionabilitySummary({
    cortexProbability, marketPrice, edgeMagnitude, edgeDirection, confidence,
    expectedValue, moduleCount, llmModuleCount, signalContributions,
    evMeetsThreshold, hasEnoughModules, hasLLMModule, isActionable,
  });

  if (!isActionable && evMeetsThreshold) {
    logger.debug({
      marketId, moduleCount, llmModuleCount,
      reason: !hasEnoughModules ? 'insufficient modules' : 'no LLM module',
    }, 'Edge has sufficient EV but fails module requirement — NOT actionable');
  }

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
    isActionable,
    conflictFlag,
    timestamp: new Date(),
    daysToResolution,
    capitalEfficiency,
    actionabilitySummary,
  };
}

/**
 * Build a human-readable "Why is this actionable?" summary for the CORTEX synthesis panel.
 */
function buildActionabilitySummary(params: {
  cortexProbability: number; marketPrice: number; edgeMagnitude: number;
  edgeDirection: string; confidence: number; expectedValue: number;
  moduleCount: number; llmModuleCount: number;
  signalContributions: SignalContribution[];
  evMeetsThreshold: boolean; hasEnoughModules: boolean; hasLLMModule: boolean;
  isActionable: boolean;
}): string {
  const {
    cortexProbability, marketPrice, edgeMagnitude, edgeDirection, confidence,
    expectedValue, moduleCount, llmModuleCount, signalContributions,
    evMeetsThreshold, hasEnoughModules, hasLLMModule, isActionable,
  } = params;

  const parts: string[] = [];

  // Core estimate
  const direction = edgeDirection === 'BUY_YES' ? 'YES (market is underpriced)' : 'NO (market is overpriced)';
  parts.push(`CORTEX estimates ${(cortexProbability * 100).toFixed(1)}% vs market ${(marketPrice * 100).toFixed(1)}%.`);
  parts.push(`Direction: ${direction}. Edge: ${(edgeMagnitude * 100).toFixed(1)}%. EV: ${(expectedValue * 100).toFixed(2)}%.`);

  // Module contributions
  const topModules = signalContributions
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(s => {
      const shortReasoning = s.reasoning.split('.')[0] || s.reasoning.slice(0, 80);
      return `${s.moduleId}: ${shortReasoning}`;
    });
  parts.push(`${moduleCount} of 10 modules contributing — ${confidence > 0.5 ? 'HIGH' : confidence > 0.25 ? 'MODERATE' : 'LOW'} confidence.`);
  if (topModules.length > 0) {
    parts.push(`Key signals: ${topModules.join('; ')}.`);
  }

  // Actionability checks
  if (!isActionable) {
    const failures: string[] = [];
    if (!evMeetsThreshold) failures.push(`EV ${(expectedValue * 100).toFixed(2)}% below 3% threshold`);
    if (!hasEnoughModules) failures.push(`only ${moduleCount} module(s) — need at least 2`);
    if (!hasLLMModule) failures.push(`no LLM modules (LEGEX/DOMEX/ALTEX/REFLEX) — pure stats alone cannot determine actionability`);
    parts.push(`NOT ACTIONABLE: ${failures.join('; ')}.`);
  }

  return parts.join(' ');
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
      actionabilitySummary: edge.actionabilitySummary ?? null,
    },
  });

  logger.info(
    { edgeId: record.id, marketId: edge.marketId, ev: edge.expectedValue.toFixed(4), actionable: edge.isActionable, conflict: edge.conflictFlag },
    'Edge persisted'
  );

  return record.id;
}
