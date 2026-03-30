import { SignalOutput, EdgeOutput, SignalContribution, clampProbability, ModuleId, kalshiFeePerContract } from '@apex/shared';
import { EDGE_ACTIONABILITY_THRESHOLD, MIN_CONFIDENCE_FOR_ACTIONABLE } from '@apex/shared';
import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { applyCalibration, fuseSignals, RawSignal, ModuleScoreInput } from '@apex/cortex';

// LLM modules that analyze the actual event (not just statistical patterns)
// REFLEX removed — disabled in V3 review (Grade D, no real data source)
const LLM_MODULES = new Set<string>(['LEGEX', 'DOMEX', 'ALTEX']);

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
  moduleScores?: ModuleScoreInput[];
}

/**
 * CORTEX v3: calibration → signal fusion → edge calculation → Kelly sizing.
 *
 * Delegates probability fusion to the canonical SignalFusionEngine in @apex/cortex,
 * which handles time decay, module weighting, and agreement scoring.
 * Adds calibration corrections (pre-fusion) and Kelly sizing (post-fusion).
 */
export function synthesize(input: CortexInput): EdgeOutput & { daysToResolution: number; capitalEfficiency: number } {
  const { signals, marketPrice, marketId, marketCategory, closesAt, moduleScores } = input;

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
  // Filter out ARBEX from probability synthesis (produces arb spread signals, not probability).
  // SPEEDEX is INCLUDED — it produces real probability estimates from Black-Scholes pricing.
  const probabilitySignals = calibratedSignals.filter(
    s => s.moduleId !== 'ARBEX'
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

  const fused = fuseSignals(rawSignals, moduleScores?.length ? { moduleScores } : undefined);

  // ── Stage 3: Edge Calculation ──
  const cortexProbability = clampProbability(fused.probability);
  const confidence = clampProbability(fused.confidence);
  const conflictFlag = fused.agreementScore < 0.5; // low agreement = conflict
  const edgeMagnitude = Math.abs(cortexProbability - marketPrice);
  const edgeDirection = cortexProbability > marketPrice ? 'BUY_YES' as const : 'BUY_NO' as const;

  // Fee-aware edge: deduct estimated Kalshi fee (worst-case) from raw edge.
  // Fee = 0.07 × (1 - pricePaid), where pricePaid is what we pay for the contract.
  const pricePaid = edgeDirection === 'BUY_YES' ? marketPrice : (1 - marketPrice);
  const estimatedFee = kalshiFeePerContract(pricePaid);
  const netEdge = Math.max(0, edgeMagnitude - estimatedFee);
  // EV = confidence-weighted net edge. Used for ranking/display.
  // Actionability threshold gates on netEdge directly (fees already deducted),
  // with confidence gated independently at MIN_CONFIDENCE_FOR_ACTIONABLE.
  const expectedValue = netEdge * confidence;
  const capitalEfficiency = netEdge / Math.sqrt(daysToResolution);

  // ── Stage 4: Kelly Sizing ──
  // f* = (p*b - q) / b, then quarter-Kelly for safety
  // b = payoff odds = (1/betPrice - 1)
  // p = probability of the outcome we're BETTING ON:
  //   BUY_YES → p = cortexProbability (prob of YES)
  //   BUY_NO  → p = 1 - cortexProbability (prob of NO)
  const p = edgeDirection === 'BUY_YES' ? cortexProbability : (1 - cortexProbability);
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
  // Must pass ALL four checks:
  // 1. Net edge (after fee deduction) exceeds minimum profit threshold
  //    Gate on netEdge directly — fees are already deducted, so this is pure profit margin.
  //    Confidence is checked independently (gate 2), not multiplied into the threshold.
  // 2. Confidence meets minimum floor (20%) — below this is noise
  // 3. At least 2 modules contributed probability signals
  // 4. At least 1 LLM module contributed (pure stats alone can't analyze the event)
  const moduleCount = probabilitySignals.length;
  const llmModuleCount = probabilitySignals.filter(s => LLM_MODULES.has(s.moduleId)).length;
  const speedexSignal = probabilitySignals.find(s => s.moduleId === 'SPEEDEX');
  const hasSpeedex = !!speedexSignal;
  const evMeetsThreshold = netEdge >= EDGE_ACTIONABILITY_THRESHOLD;
  const confidenceMeetsThreshold = confidence >= MIN_CONFIDENCE_FOR_ACTIONABLE;

  // SPEEDEX solo override: Black-Scholes on crypto brackets is mathematically rigorous.
  // When SPEEDEX has a strong edge (>= 15%) with decent confidence (>= 40%),
  // it can trade as a single module — no LLM or multi-module confirmation needed.
  const speedexSoloEligible = marketCategory === 'CRYPTO' && hasSpeedex
    && edgeMagnitude >= 0.15 && (speedexSignal?.confidence ?? 0) >= 0.40;

  const hasEnoughModules = moduleCount >= MIN_MODULES_FOR_ACTIONABLE || speedexSoloEligible;
  const hasLLMModule = llmModuleCount >= MIN_LLM_MODULES_FOR_ACTIONABLE
    || (marketCategory === 'CRYPTO' && hasSpeedex);
  const isActionable = evMeetsThreshold && confidenceMeetsThreshold && hasEnoughModules && hasLLMModule;

  if (isActionable && speedexSoloEligible && moduleCount < MIN_MODULES_FOR_ACTIONABLE) {
    logger.info({
      marketId, edge: edgeMagnitude.toFixed(3), confidence: confidence.toFixed(3),
      direction: edgeDirection, modules: moduleCount,
    }, `SPEEDEX_SOLO: single-module override (edge=${(edgeMagnitude * 100).toFixed(1)}%, conf=${(confidence * 100).toFixed(0)}%)`);
  }

  // ── Build "Why is this actionable?" summary ──
  const actionabilitySummary = buildActionabilitySummary({
    cortexProbability, marketPrice, edgeMagnitude, edgeDirection, confidence,
    expectedValue, netEdge, moduleCount, llmModuleCount, signalContributions,
    evMeetsThreshold, confidenceMeetsThreshold, hasEnoughModules, hasLLMModule, isActionable,
  });

  if (!isActionable && evMeetsThreshold) {
    const reason = !confidenceMeetsThreshold ? 'low confidence' : !hasEnoughModules ? 'insufficient modules' : 'no LLM module';
    logger.debug({
      marketId, moduleCount, llmModuleCount, confidence: confidence.toFixed(3),
      reason,
    }, 'Edge has sufficient EV but fails actionability gate — NOT actionable');
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
    marketCategory,
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
  edgeDirection: string; confidence: number; expectedValue: number; netEdge: number;
  moduleCount: number; llmModuleCount: number;
  signalContributions: SignalContribution[];
  evMeetsThreshold: boolean; confidenceMeetsThreshold: boolean; hasEnoughModules: boolean; hasLLMModule: boolean;
  isActionable: boolean;
}): string {
  const {
    cortexProbability, marketPrice, edgeMagnitude, edgeDirection, confidence,
    expectedValue, netEdge, moduleCount, llmModuleCount, signalContributions,
    evMeetsThreshold, confidenceMeetsThreshold, hasEnoughModules, hasLLMModule, isActionable,
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
    if (!evMeetsThreshold) failures.push(`net edge ${(netEdge * 100).toFixed(2)}% below ${(EDGE_ACTIONABILITY_THRESHOLD * 100).toFixed(1)}% threshold (after fees)`);
    if (!confidenceMeetsThreshold) failures.push(`confidence ${(confidence * 100).toFixed(0)}% below 20% minimum`);
    if (!hasEnoughModules) failures.push(`only ${moduleCount} module(s) — need at least 2`);
    if (!hasLLMModule) failures.push(`no LLM modules (LEGEX/DOMEX/ALTEX) — pure stats alone cannot determine actionability`);
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
    marketCategory: 'OTHER',
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

/**
 * Save a training snapshot: feature vectors + module outputs for this synthesis.
 * Append-only — this builds the labeled dataset the FeatureModel needs to train.
 * Resolution outcomes are linked later when markets resolve.
 */
export async function persistTrainingSnapshot(
  edge: EdgeOutput & { daysToResolution: number },
  signals: SignalOutput[]
): Promise<void> {
  try {
    // Build module outputs map: { COGEX: { prob, conf }, DOMEX: { prob, conf }, ... }
    const moduleOutputs: Record<string, { probability: number; confidence: number }> = {};
    for (const sig of signals) {
      moduleOutputs[sig.moduleId] = {
        probability: sig.probability,
        confidence: sig.confidence,
      };
    }

    // Extract feature vector from DOMEX signal if available
    const domexSignal = signals.find(s => s.moduleId === 'DOMEX');
    let featureVector: object | null = null;
    let featureSchemaVersion: number | null = null;
    if (domexSignal?.metadata) {
      const meta = domexSignal.metadata as Record<string, unknown>;
      if (meta.featureVector) {
        featureVector = meta.featureVector as object;
      }
      if (typeof meta.featureSchemaVersion === 'number') {
        featureSchemaVersion = meta.featureSchemaVersion;
      }
    }

    await prisma.trainingSnapshot.create({
      data: {
        marketId: edge.marketId,
        cortexProbability: edge.cortexProbability,
        marketPrice: edge.marketPrice,
        edgeDirection: edge.edgeDirection,
        edgeMagnitude: edge.edgeMagnitude,
        confidence: edge.confidence,
        daysToResolution: edge.daysToResolution,
        marketCategory: edge.marketCategory ?? 'OTHER',
        moduleOutputs: moduleOutputs as unknown as object,
        featureVector: featureVector as unknown as object ?? undefined,
        featureSchemaVersion,
        // outcome + resolvedAt are null — filled when market resolves
      },
    });
  } catch (err) {
    // Non-fatal — don't block the pipeline if snapshot save fails
    logger.warn({ err, marketId: edge.marketId }, 'Failed to save training snapshot');
  }
}
