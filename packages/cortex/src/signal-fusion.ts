/**
 * SignalFusionEngine — combines raw signals into a single probability estimate.
 *
 * Weighted average with time decay and module confidence.
 * Supports adaptive weights derived from ModuleScore Brier data.
 */

export interface RawSignal {
  moduleId: string;
  probability: number;
  confidence: number;
  reasoning: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface FusedSignal {
  probability: number;
  confidence: number;
  contributingModules: { moduleId: string; weight: number; probability: number; decayedConfidence: number }[];
  agreementScore: number;  // 0-1, how much modules agree
  reasoning: string;
}

export interface ModuleScoreInput {
  moduleId: string;
  brierScore: number;
  sampleSize: number;
}

export interface FuseOptions {
  moduleScores?: ModuleScoreInput[];
}

// Static base weights — used as priors before adaptive data is available
export const STATIC_MODULE_WEIGHTS: Record<string, number> = {
  // Quantitative (no LLM, fast, reliable)
  COGEX: 0.15,
  FLOWEX: 0.12,
  ARBEX: 0.18,
  SPEEDEX: 0.20,

  // LLM-based (slower, subject to calibration)
  LEGEX: 0.10,
  DOMEX: 0.10,
  ALTEX: 0.08,
  REFLEX: 0,  // Disabled — V3 review Grade D, no real data source

  // Specialized
  SIGINT: 0.08,
  NEXUS: 0.04,
  CRYPTEX: 0.15,
};

// Minimum weight floor — no module is zeroed out (it might recover)
const MIN_WEIGHT = 0.02;
// Minimum total scored samples before adaptive weights activate
const MIN_ADAPTIVE_SAMPLES = 10;
// At this sample count, adaptive weights are fully trusted (100% adaptive)
const FULL_ADAPTIVE_SAMPLES = 100;

/**
 * Compute adaptive weights from ModuleScore Brier data.
 * Lower Brier = better calibration = higher weight.
 * Returns blended weights: (1-alpha)*static + alpha*adaptive,
 * where alpha ramps from 0→1 as sample count grows.
 */
export function computeAdaptiveWeights(
  scores: ModuleScoreInput[],
): { weights: Record<string, number>; adaptive: boolean; blendRatio: number } {
  // Filter to modules with enough data
  const valid = scores.filter(s =>
    s.sampleSize >= MIN_ADAPTIVE_SAMPLES &&
    Number.isFinite(s.brierScore) &&
    s.brierScore > 0
  );

  if (valid.length === 0) {
    return { weights: { ...STATIC_MODULE_WEIGHTS }, adaptive: false, blendRatio: 0 };
  }

  // Compute inverse-Brier weights (lower Brier = higher weight)
  const inverseBrier: Record<string, number> = {};
  for (const s of valid) {
    inverseBrier[s.moduleId] = 1 / s.brierScore;
  }

  // Normalize inverse-Brier weights to sum to the same total as the static weights
  // for the modules that have scores
  const totalInverse = Object.values(inverseBrier).reduce((a, b) => a + b, 0);
  const staticTotal = valid.reduce((a, s) => a + (STATIC_MODULE_WEIGHTS[s.moduleId] || 0.05), 0);

  const adaptiveWeights: Record<string, number> = {};
  for (const s of valid) {
    adaptiveWeights[s.moduleId] = Math.max(MIN_WEIGHT, (inverseBrier[s.moduleId] / totalInverse) * staticTotal);
  }

  // Blend ratio: ramp from 0 to 1 as min sample count grows
  const minSamples = Math.min(...valid.map(s => s.sampleSize));
  const blendRatio = Math.min(1, Math.max(0,
    (minSamples - MIN_ADAPTIVE_SAMPLES) / (FULL_ADAPTIVE_SAMPLES - MIN_ADAPTIVE_SAMPLES)
  ));

  // Blend: (1-alpha)*static + alpha*adaptive
  const blended: Record<string, number> = { ...STATIC_MODULE_WEIGHTS };
  for (const moduleId of Object.keys(adaptiveWeights)) {
    const staticW = STATIC_MODULE_WEIGHTS[moduleId] || 0.05;
    const adaptiveW = adaptiveWeights[moduleId];
    const finalW = (1 - blendRatio) * staticW + blendRatio * adaptiveW;
    blended[moduleId] = Math.max(MIN_WEIGHT, finalW);

    // Warn on large shifts
    if (Math.abs(finalW - staticW) / staticW > 0.5) {
      console.warn(`[fuseSignals] Large weight shift for ${moduleId}: static=${staticW.toFixed(3)} → blended=${finalW.toFixed(3)} (${(blendRatio * 100).toFixed(0)}% adaptive)`);
    }
  }

  return { weights: blended, adaptive: true, blendRatio };
}

/**
 * Time decay factor — signals lose relevance over time.
 * Half-life varies by module type.
 */
function timeDecay(signal: RawSignal): number {
  const ageMinutes = (Date.now() - signal.createdAt.getTime()) / 60000;

  // Half-lives per module
  const halfLives: Record<string, number> = {
    SPEEDEX: 5,     // 5 min — latency signals decay fast
    CRYPTEX: 10,    // 10 min
    FLOWEX: 30,     // 30 min — microstructure
    ARBEX: 15,      // 15 min — arb windows close
    COGEX: 120,     // 2 hours — bias analysis
    LEGEX: 1440,    // 24 hours — resolution doesn't change
    DOMEX: 360,     // 6 hours — domain analysis
    ALTEX: 240,     // 4 hours — news
    REFLEX: 1440,   // 24 hours — reflexivity is slow
    SIGINT: 720,    // 12 hours — wallet moves
    NEXUS: 1440,    // 24 hours — correlations
  };

  const halfLife = halfLives[signal.moduleId] || 60;
  return Math.pow(0.5, ageMinutes / halfLife);
}

/**
 * Fuse multiple signals into a single probability estimate.
 * Validates all inputs — invalid signals are excluded with a warning, not a crash.
 * Optionally accepts ModuleScore data to adapt weights based on historical Brier performance.
 */
export function fuseSignals(signals: RawSignal[], options?: FuseOptions): FusedSignal {
  if (signals.length === 0) {
    return {
      probability: 0.5,
      confidence: 0,
      contributingModules: [],
      agreementScore: 0,
      reasoning: 'No signals available',
    };
  }

  // ── Input validation: exclude bad signals instead of crashing ──
  const validSignals = signals.filter(s => {
    if (!Number.isFinite(s.probability) || s.probability < 0 || s.probability > 1) {
      console.warn(`[fuseSignals] Excluding ${s.moduleId}: invalid probability ${s.probability}`);
      return false;
    }
    if (!Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) {
      console.warn(`[fuseSignals] Excluding ${s.moduleId}: invalid confidence ${s.confidence}`);
      return false;
    }
    if (!(s.createdAt instanceof Date) || isNaN(s.createdAt.getTime())) {
      console.warn(`[fuseSignals] Excluding ${s.moduleId}: invalid createdAt`);
      return false;
    }
    return true;
  });

  if (validSignals.length === 0) {
    return {
      probability: 0.5,
      confidence: 0,
      contributingModules: [],
      agreementScore: 0,
      reasoning: 'All signals had invalid values',
    };
  }

  // Resolve module weights: adaptive (from Brier scores) or static
  const { weights: moduleWeights } = options?.moduleScores?.length
    ? computeAdaptiveWeights(options.moduleScores)
    : { weights: STATIC_MODULE_WEIGHTS };

  // Calculate decayed weights
  const contributions = validSignals.map(s => {
    const baseWeight = moduleWeights[s.moduleId] || 0.05;
    const decay = timeDecay(s);
    const effectiveWeight = baseWeight * s.confidence * decay;

    return {
      moduleId: s.moduleId,
      probability: s.probability,
      weight: Number.isFinite(effectiveWeight) ? effectiveWeight : 0,
      decayedConfidence: Number.isFinite(s.confidence * decay) ? s.confidence * decay : 0,
    };
  });

  // Normalize weights
  const totalWeight = contributions.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) {
    return {
      probability: 0.5,
      confidence: 0,
      contributingModules: contributions,
      agreementScore: 0,
      reasoning: 'All signals decayed or zero confidence',
    };
  }

  // Weighted average probability
  const probability = contributions.reduce((s, c) => s + c.probability * c.weight, 0) / totalWeight;

  // Agreement score: 1 = all agree, 0 = max disagreement
  const probStdDev = Math.sqrt(
    contributions.reduce((s, c) => s + c.weight * (c.probability - probability) ** 2, 0) / totalWeight
  );
  const agreementScore = Math.max(0, 1 - probStdDev * 4); // normalize: 0.25 stddev = 0 agreement

  // Overall confidence: weighted avg confidence × agreement × coverage factor
  const avgConfidence = contributions.reduce((s, c) => s + c.decayedConfidence * c.weight, 0) / totalWeight;
  const coverageFactor = Math.min(1, signals.length / 4); // penalize if < 4 modules contributing
  const confidence = Math.min(0.9, avgConfidence * (0.5 + 0.5 * agreementScore) * (0.6 + 0.4 * coverageFactor));

  // Build reasoning
  const topModules = [...contributions]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(c => `${c.moduleId}: ${(c.probability * 100).toFixed(1)}% (w=${(c.weight / totalWeight * 100).toFixed(0)}%)`)
    .join(', ');

  return {
    probability: Math.max(0.01, Math.min(0.99, probability)),
    confidence,
    contributingModules: contributions.sort((a, b) => b.weight - a.weight),
    agreementScore,
    reasoning: `Fused from ${signals.length} modules. Top: ${topModules}. Agreement: ${(agreementScore * 100).toFixed(0)}%`,
  };
}
