/**
 * SignalFusionEngine — combines raw signals into a single probability estimate.
 * Weighted average with time decay and module reliability weighting.
 */
import { prisma } from '../../lib/prisma';
import type { Signal } from '@prisma/client';

interface FusedSignal {
  probability: number;
  confidence: number;
  moduleContributions: { moduleId: string; probability: number; confidence: number; weight: number }[];
  signalCount: number;
}

// Default weights — overridden by ModuleWeight table
const DEFAULT_WEIGHTS: Record<string, number> = {
  COGEX: 0.15, FLOWEX: 0.10, LEGEX: 0.15, DOMEX: 0.20,
  ALTEX: 0.15, REFLEX: 0.05, SPEEDEX: 0.25, ARBEX: 0.20,
  SIGINT: 0.10, NEXUS: 0.05, CRYPTEX: 0.15,
  'SPORTS-EDGE': 0.20, 'WEATHER-HAWK': 0.15, 'LEGAL-EAGLE': 0.15,
  'CORPORATE-INTEL': 0.15, 'ENTERTAINMENT-SCOUT': 0.10,
};

export async function fuseSignals(marketId: string, category: string): Promise<FusedSignal | null> {
  // Get latest non-expired signals for this market
  const signals = await prisma.signal.findMany({
    where: {
      marketId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Dedupe: keep latest per module
  const latestByModule = new Map<string, Signal>();
  for (const sig of signals) {
    if (!latestByModule.has(sig.moduleId)) {
      latestByModule.set(sig.moduleId, sig);
    }
  }

  const uniqueSignals = Array.from(latestByModule.values());
  if (uniqueSignals.length === 0) return null;

  // Get custom weights from DB
  const dbWeights = await prisma.moduleWeight.findMany({
    where: { category },
  });
  const weightMap = new Map(dbWeights.map(w => [w.moduleId, w.weight]));

  // Calculate weighted average with time decay
  let totalWeight = 0;
  let weightedProbSum = 0;
  let weightedConfSum = 0;
  const contributions: FusedSignal['moduleContributions'] = [];

  for (const sig of uniqueSignals) {
    const baseWeight = weightMap.get(sig.moduleId) ?? DEFAULT_WEIGHTS[sig.moduleId] ?? 0.10;

    // Time decay: halve weight every 2 hours
    const ageHours = (Date.now() - sig.createdAt.getTime()) / 3600000;
    const timeDecay = Math.pow(0.5, ageHours / 2);

    // Final weight = base × confidence × time_decay
    const weight = baseWeight * sig.confidence * timeDecay;

    totalWeight += weight;
    weightedProbSum += sig.probability * weight;
    weightedConfSum += sig.confidence * weight;

    contributions.push({
      moduleId: sig.moduleId,
      probability: sig.probability,
      confidence: sig.confidence,
      weight,
    });
  }

  if (totalWeight === 0) return null;

  const fusedProb = Math.max(0.01, Math.min(0.99, weightedProbSum / totalWeight));

  // Confidence: base from weighted avg, boost for agreement, penalize for few signals
  const baseConf = weightedConfSum / totalWeight;
  const agreementBoost = calculateAgreement(uniqueSignals);
  const coverageFactor = Math.min(1, uniqueSignals.length / 4); // full coverage at 4+ modules
  const confidence = Math.min(0.95, baseConf * agreementBoost * coverageFactor);

  // Floor: if 3+ modules contribute, minimum confidence = 0.20
  const finalConfidence = uniqueSignals.length >= 3 ? Math.max(0.20, confidence) : confidence;

  return {
    probability: fusedProb,
    confidence: finalConfidence,
    moduleContributions: contributions.sort((a, b) => b.weight - a.weight),
    signalCount: uniqueSignals.length,
  };
}

function calculateAgreement(signals: Signal[]): number {
  if (signals.length <= 1) return 1;
  const probs = signals.map(s => s.probability);
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
  const variance = probs.reduce((s, p) => s + (p - mean) ** 2, 0) / probs.length;
  const stddev = Math.sqrt(variance);
  // Low stddev = high agreement = boost up to 1.3x
  // High stddev = disagreement = penalize down to 0.7x
  return Math.max(0.7, Math.min(1.3, 1.3 - stddev * 2));
}
