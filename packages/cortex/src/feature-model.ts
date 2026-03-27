/**
 * FeatureModel — logistic regression over structured features from LLM modules.
 *
 * LLMs are feature extractors, NOT probability oracles.
 * Each module outputs a feature vector; this model combines them into a calibrated probability.
 * Retrains weekly on resolved markets. Falls back to base rates with insufficient data.
 */

// ── Feature Schema ──

export interface FedHawkFeatures {
  fedFundsRate: number;           // current rate (e.g., 5.25)
  cpiTrend: number;               // -1 (falling), 0 (stable), 1 (rising)
  dotPlotDirection: number;       // -1 (dovish), 0 (neutral), 1 (hawkish)
  fedSpeechTone: number;          // -1 to 1, sentiment score
  marketImpliedRate: number;      // Fed Funds futures implied rate
  yieldCurveSpread: number;       // 10Y-2Y spread
}

export interface GeoIntelFeatures {
  incumbentApproval: number;      // 0-100 approval rating
  pollingSpread: number;          // spread between candidates (signed)
  legislativeStatus: number;      // 0=not introduced, 1=committee, 2=floor, 3=passed one, 4=both
  keyDatesAhead: number;          // days until next key event (election, hearing, vote)
  escalationLevel: number;        // 0-5 for conflict markets
  sanctionIntensity: number;      // 0-1 normalized sanction pressure
}

export interface SportsEdgeFeatures {
  homeAway: number;               // 1=home, 0=away, 0.5=neutral
  restDays: number;               // days since last game
  injuryImpact: number;           // 0-1 estimated impact on win prob
  recentForm: number;             // win rate last 10 games
  headToHeadRecord: number;       // historical win rate vs opponent
  eloRating: number;              // team Elo or equivalent
  lineMovement: number;           // -1 to 1, sharp money direction
  bookmakerImpliedProb: number;   // 0-1, consensus implied probability from bookmaker odds
}

export interface CryptoAlphaFeatures {
  fundingRate: number;            // perpetual futures funding (annualized)
  exchangeFlows: number;          // net exchange inflow (negative = outflow)
  protocolTVL: number;            // total value locked (normalized)
  regulatoryNews: number;         // -1 (negative), 0 (neutral), 1 (positive)
  volatilityRatio: number;        // realized vol / implied vol
  orderBookImbalance: number;     // bid depth / ask depth
}

export interface LegexFeatures {
  ambiguityScore: number;         // 1-5
  misinterpretationRisk: number;  // 0-1
  resolutionSourceReliability: number; // 0-1
  edgeCaseCount: number;          // number of unaddressed edge cases
  crossPlatformDivergence: number; // 0-1, resolution text difference
}

export interface AltexFeatures {
  newsRelevance: number;          // 0-1
  sentimentDirection: number;     // -1 to 1
  informationAsymmetry: number;   // 0-1, how much is NOT priced in
  upcomingCatalysts: number;      // count of upcoming events
  sourceReliability: number;      // 0-1
}

export interface WeatherHawkFeatures {
  temperatureAnomaly: number;     // degrees above/below average
  precipitationChance: number;    // 0-1
  forecastConfidence: number;     // 0-1, NWS forecast confidence
  severeWeatherRisk: number;      // 0-1
  forecastHorizonDays: number;    // how far out the forecast extends
}

export interface LegalEagleFeatures {
  precedentStrength: number;      // 0-1, how strong existing precedent is
  courtLevel: number;             // 0=district, 1=circuit, 2=scotus
  rulingLikelihood: number;       // 0-1, estimated probability of ruling in favor
  caseAgeMonths: number;          // months since filing
  amicusBriefs: number;           // count of amicus briefs filed
}

export interface CorporateIntelFeatures {
  earningsSurprise: number;       // last quarter surprise (%)
  analystConsensus: number;       // -1 (negative) to 1 (positive)
  filingActivity: number;         // 0-1, recent SEC filing intensity
  approvalPrecedent: number;      // 0-1, historical approval rate for similar
  insiderActivity: number;        // -1 (selling) to 1 (buying)
}

export interface FeatureVector {
  marketId: string;
  marketPrice: number;
  daysToResolution: number;
  category: string;
  volume: number;
  fedHawk?: FedHawkFeatures;
  geoIntel?: GeoIntelFeatures;
  sportsEdge?: SportsEdgeFeatures;
  cryptoAlpha?: CryptoAlphaFeatures;
  legex?: LegexFeatures;
  altex?: AltexFeatures;
  weatherHawk?: WeatherHawkFeatures;
  legalEagle?: LegalEagleFeatures;
  corporateIntel?: CorporateIntelFeatures;
  // Base features always present
  priceLevel: number;            // kept for backward compat but weight=0 (excluded from model)
  bidAskSpread: number;          // orderbook spread
  volumeRank: number;            // 0-1 percentile within category
  timeToResolutionBucket: number; // 0=hours, 1=days, 2=weeks, 3=months
}

// ── Logistic Regression ──

interface ModelWeights {
  intercept: number;
  weights: Record<string, number>;
  trainedAt: Date;
  sampleSize: number;
  accuracy: number;           // in-sample (training) accuracy
  validationAccuracy: number; // out-of-sample accuracy (the one that matters)
}

/** Current feature schema version. Increment when feature schemas change. */
export const FEATURE_SCHEMA_VERSION = 2; // v2: Fuku integration, futures detection

// Default weights — replaced by trained model when enough resolved markets accumulate
// CRITICAL: priceLevel is ZERO — market price must NOT influence the probability model.
// Market price only enters at edge calculation: edge = cortexProbability - marketPrice.
// A non-zero priceLevel weight causes sigmoid(2.5 * marketPrice + noise) ≈ marketPrice,
// which guarantees edge ≈ 0 and makes every LLM credit wasted.
const DEFAULT_WEIGHTS: ModelWeights = {
  intercept: 0,
  weights: {
    // Base features — priceLevel intentionally excluded (anchoring bias)
    'bidAskSpread': -0.3,         // wide spread = uncertainty
    'volumeRank': 0.1,            // more volume = more info
    'daysToResolution': -0.01,    // distant = more uncertainty
    // FedHawk
    'fedHawk.fedFundsRate': 0.1,
    'fedHawk.cpiTrend': 0.3,
    'fedHawk.dotPlotDirection': 0.25,
    'fedHawk.fedSpeechTone': 0.2,
    'fedHawk.yieldCurveSpread': -0.15,
    // Legex
    'legex.ambiguityScore': -0.15,
    'legex.misinterpretationRisk': -0.2,
    'legex.resolutionSourceReliability': 0.1,
    'legex.edgeCaseCount': -0.1,
    'legex.crossPlatformDivergence': -0.15,
    // Altex
    'altex.sentimentDirection': 0.3,
    'altex.informationAsymmetry': 0.4,
    'altex.newsRelevance': 0.15,
    'altex.upcomingCatalysts': 0.1,
    // Geo
    'geoIntel.pollingSpread': 0.02,
    'geoIntel.incumbentApproval': 0.01,
    'geoIntel.legislativeStatus': 0.2,
    'geoIntel.escalationLevel': -0.15,
    'geoIntel.sanctionIntensity': -0.1,
    // Crypto
    'cryptoAlpha.fundingRate': -0.5,
    'cryptoAlpha.orderBookImbalance': 0.3,
    'cryptoAlpha.exchangeFlows': -0.2,
    'cryptoAlpha.volatilityRatio': -0.15,
    'cryptoAlpha.regulatoryNews': 0.25,
    // Sports — bookmakerImpliedProb is the primary anchor; other features are adjustments
    'sportsEdge.bookmakerImpliedProb': 3.0,   // HIGH: anchor to bookmaker consensus (DK/FD/etc.)
    'sportsEdge.homeAway': 0.10,              // reduced: bookmaker line already prices home advantage
    'sportsEdge.recentForm': 0.5,             // reduced: bookmaker line already factors form
    'sportsEdge.injuryImpact': -0.4,          // reduced: bookmakers react fast to injury news
    'sportsEdge.eloRating': 0.001,            // unchanged: minimal standalone value
    'sportsEdge.lineMovement': 0.3,           // reduced slightly
    'sportsEdge.headToHeadRecord': 0.2,       // reduced: small H2H effect
    // WeatherHawk
    'weatherHawk.temperatureAnomaly': 0.2,
    'weatherHawk.precipitationChance': 0.15,
    'weatherHawk.forecastConfidence': 0.1,
    // LegalEagle
    'legalEagle.precedentStrength': 0.3,
    'legalEagle.courtLevel': 0.15,
    'legalEagle.rulingLikelihood': 0.25,
    // CorporateIntel
    'corporateIntel.earningsSurprise': 0.3,
    'corporateIntel.analystConsensus': 0.2,
    'corporateIntel.filingActivity': 0.15,
    'corporateIntel.approvalPrecedent': 0.25,
  },
  trainedAt: new Date(),
  sampleSize: 0,
  accuracy: 0.5,
  validationAccuracy: 0.5,
};

let currentModel: ModelWeights = DEFAULT_WEIGHTS;

/**
 * Flatten a FeatureVector into a numeric array with named keys.
 */
function flattenFeatures(fv: FeatureVector): Record<string, number> {
  // priceLevel intentionally EXCLUDED — market price must not influence the model.
  // It only enters at edge calculation: edge = cortexProbability - marketPrice.
  const flat: Record<string, number> = {
    bidAskSpread: fv.bidAskSpread,
    volumeRank: fv.volumeRank,
    daysToResolution: fv.daysToResolution,
    timeToResolutionBucket: fv.timeToResolutionBucket,
  };

  if (fv.fedHawk) {
    for (const [k, v] of Object.entries(fv.fedHawk)) {
      flat[`fedHawk.${k}`] = v;
    }
  }
  if (fv.geoIntel) {
    for (const [k, v] of Object.entries(fv.geoIntel)) {
      flat[`geoIntel.${k}`] = v;
    }
  }
  if (fv.sportsEdge) {
    for (const [k, v] of Object.entries(fv.sportsEdge)) {
      flat[`sportsEdge.${k}`] = v;
    }
  }
  if (fv.cryptoAlpha) {
    for (const [k, v] of Object.entries(fv.cryptoAlpha)) {
      flat[`cryptoAlpha.${k}`] = v;
    }
  }
  if (fv.legex) {
    for (const [k, v] of Object.entries(fv.legex)) {
      flat[`legex.${k}`] = v;
    }
  }
  if (fv.altex) {
    for (const [k, v] of Object.entries(fv.altex)) {
      flat[`altex.${k}`] = v;
    }
  }
  if (fv.weatherHawk) {
    for (const [k, v] of Object.entries(fv.weatherHawk)) {
      flat[`weatherHawk.${k}`] = v;
    }
  }
  if (fv.legalEagle) {
    for (const [k, v] of Object.entries(fv.legalEagle)) {
      flat[`legalEagle.${k}`] = v;
    }
  }
  if (fv.corporateIntel) {
    for (const [k, v] of Object.entries(fv.corporateIntel)) {
      flat[`corporateIntel.${k}`] = v;
    }
  }

  return flat;
}

/**
 * Sigmoid function
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Predict calibrated probability from feature vector.
 */
export function predict(fv: FeatureVector): { probability: number; confidence: number; featureImportance: { feature: string; contribution: number }[] } {
  const flat = flattenFeatures(fv);
  const model = currentModel;

  let logit = model.intercept;
  const importance: { feature: string; contribution: number }[] = [];

  for (const [feature, weight] of Object.entries(model.weights)) {
    const value = flat[feature];
    if (value !== undefined && !isNaN(value)) {
      const contribution = weight * value;
      logit += contribution;
      if (Math.abs(contribution) > 0.01) {
        importance.push({ feature, contribution });
      }
    }
  }

  const probability = Math.max(0.01, Math.min(0.99, sigmoid(logit)));

  // Confidence based on: feature coverage, validation accuracy (NOT training accuracy), sample size
  const featureCount = Object.keys(flat).length;
  const coverageFactor = Math.min(1, featureCount / 10);
  // Use validation accuracy (out-of-sample) — training accuracy is meaningless for confidence.
  // Only trust the model if validation accuracy > 55% AND enough samples.
  const modelFactor = model.sampleSize > 50 && model.validationAccuracy > 0.55
    ? model.validationAccuracy
    : 0.5; // fall back to prior — insufficient data or model doesn't beat coin flip
  const confidence = Math.min(0.9, coverageFactor * modelFactor);

  importance.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { probability, confidence, featureImportance: importance.slice(0, 5) };
}

/** Minimum resolved markets needed to train. Below this, we keep defaults. */
const MIN_TRAINING_SAMPLES = 30;

/** L2 regularization strength. Prevents overfitting with sparse features. */
const L2_LAMBDA = 0.1;

/** Validation split ratio */
const VALIDATION_SPLIT = 0.2;

/** Minimum validation accuracy to adopt the trained model */
const MIN_VALIDATION_ACCURACY = 0.55;

/**
 * Shuffle array in-place (Fisher-Yates) with deterministic seed for reproducibility.
 */
function shuffleArray<T>(arr: T[], seed = 42): T[] {
  const shuffled = [...arr];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff; // LCG
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Calculate accuracy on a dataset given weights.
 */
function calcAccuracy(
  data: { features: Record<string, number>; outcome: 0 | 1 }[],
  weights: Record<string, number>,
  intercept: number
): number {
  if (data.length === 0) return 0.5;
  let correct = 0;
  for (const { features, outcome } of data) {
    let logit = intercept;
    for (const [f, w] of Object.entries(weights)) {
      if (features[f] !== undefined) logit += w * features[f];
    }
    const pred = sigmoid(logit) >= 0.5 ? 1 : 0;
    if (pred === outcome) correct++;
  }
  return correct / data.length;
}

/**
 * Train model on resolved markets using gradient descent with L2 regularization
 * and train/validation split.
 *
 * Called weekly by the calibration job.
 *
 * Key safeguards:
 * - Minimum 30 samples required (below this, not enough data to learn)
 * - 80/20 train/validation split (reports validation accuracy, not training)
 * - L2 regularization (lambda=0.1) prevents overfitting with 40+ features
 * - If validation accuracy < 55%, model is rejected (keeps current weights)
 * - modelFactor uses validation accuracy, not training accuracy
 */
export function trainModel(
  trainingData: { features: FeatureVector; outcome: 0 | 1 }[],
  learningRate = 0.01,
  epochs = 100
): ModelWeights {
  if (trainingData.length < MIN_TRAINING_SAMPLES) {
    // Not enough data — keep defaults. With <30 samples and 40+ features,
    // any trained model would be severely overfit.
    return currentModel;
  }

  const flatData = shuffleArray(trainingData.map(d => ({
    features: flattenFeatures(d.features),
    outcome: d.outcome,
  })));

  // ── Train/validation split (80/20) ──
  const splitIdx = Math.floor(flatData.length * (1 - VALIDATION_SPLIT));
  const trainSet = flatData.slice(0, splitIdx);
  const valSet = flatData.slice(splitIdx);

  // Collect all feature names from training set only
  const allFeatures = new Set<string>();
  for (const d of trainSet) {
    for (const k of Object.keys(d.features)) allFeatures.add(k);
  }

  // Initialize weights from current model
  const weights: Record<string, number> = { ...currentModel.weights };
  let intercept = currentModel.intercept;

  // ── Gradient descent with L2 regularization ──
  const n = trainSet.length;
  for (let epoch = 0; epoch < epochs; epoch++) {
    let interceptGrad = 0;
    const grads: Record<string, number> = {};
    for (const f of allFeatures) grads[f] = 0;

    for (const { features, outcome } of trainSet) {
      let logit = intercept;
      for (const [f, w] of Object.entries(weights)) {
        if (features[f] !== undefined) logit += w * features[f];
      }
      const pred = sigmoid(logit);
      const error = pred - outcome;

      interceptGrad += error;
      for (const f of allFeatures) {
        if (features[f] !== undefined) {
          grads[f] += error * features[f];
        }
      }
    }

    // Update with L2 regularization: gradient += lambda * weight
    // (don't regularize the intercept)
    intercept -= learningRate * (interceptGrad / n);
    for (const f of allFeatures) {
      const grad = grads[f] / n + L2_LAMBDA * (weights[f] || 0); // L2 penalty
      weights[f] = (weights[f] || 0) - learningRate * grad;
    }
  }

  // ── Evaluate on BOTH sets ──
  const trainAccuracy = calcAccuracy(trainSet, weights, intercept);
  const valAccuracy = calcAccuracy(valSet, weights, intercept);

  // ── Reject model if validation accuracy is too low ──
  if (valAccuracy < MIN_VALIDATION_ACCURACY) {
    // Model doesn't beat coin flip on unseen data — keep current weights.
    // This can happen early when training data is sparse or noisy.
    return {
      ...currentModel,
      accuracy: trainAccuracy,
      validationAccuracy: valAccuracy,
    };
  }

  const newModel: ModelWeights = {
    intercept,
    weights,
    trainedAt: new Date(),
    sampleSize: trainSet.length,
    accuracy: trainAccuracy,
    validationAccuracy: valAccuracy,
  };

  currentModel = newModel;
  return newModel;
}

/**
 * Load model weights from persisted JSON (DB or file).
 * Called on worker startup to restore trained model.
 */
export function loadModel(serialized: { intercept: number; weights: Record<string, number>; trainedAt: string; sampleSize: number; accuracy: number; validationAccuracy?: number }): void {
  currentModel = {
    intercept: serialized.intercept,
    weights: serialized.weights,
    trainedAt: new Date(serialized.trainedAt),
    sampleSize: serialized.sampleSize,
    accuracy: serialized.accuracy,
    validationAccuracy: serialized.validationAccuracy ?? serialized.accuracy, // backward compat
  };
}

/**
 * Serialize current model for persistence.
 */
export function serializeModel(): { intercept: number; weights: Record<string, number>; trainedAt: string; sampleSize: number; accuracy: number; validationAccuracy: number } {
  return {
    intercept: currentModel.intercept,
    weights: currentModel.weights,
    trainedAt: currentModel.trainedAt.toISOString(),
    sampleSize: currentModel.sampleSize,
    accuracy: currentModel.accuracy,
    validationAccuracy: currentModel.validationAccuracy,
  };
}

/**
 * Get current model info for dashboard.
 */
export function getModelInfo(): { trainedAt: Date; sampleSize: number; accuracy: number; validationAccuracy: number; featureCount: number } {
  return {
    trainedAt: currentModel.trainedAt,
    sampleSize: currentModel.sampleSize,
    accuracy: currentModel.accuracy,
    validationAccuracy: currentModel.validationAccuracy,
    featureCount: Object.keys(currentModel.weights).length,
  };
}
