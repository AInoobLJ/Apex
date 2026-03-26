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
  // Base features always present
  priceLevel: number;            // current YES price
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
  accuracy: number;
}

// Default weights — replaced by trained model when enough resolved markets accumulate
const DEFAULT_WEIGHTS: ModelWeights = {
  intercept: 0,
  weights: {
    // Base features
    'priceLevel': 2.5,            // market price is strong prior
    'bidAskSpread': -0.3,         // wide spread = uncertainty
    'volumeRank': 0.1,            // more volume = more info
    'daysToResolution': -0.01,    // distant = more uncertainty
    // Legex
    'legex.ambiguityScore': -0.15,
    'legex.misinterpretationRisk': -0.2,
    // Altex
    'altex.sentimentDirection': 0.3,
    'altex.informationAsymmetry': 0.4,
    // Geo
    'geoIntel.pollingSpread': 0.02,
    'geoIntel.incumbentApproval': 0.01,
    // Crypto
    'cryptoAlpha.fundingRate': -0.5,
    'cryptoAlpha.orderBookImbalance': 0.3,
    // Sports
    'sportsEdge.homeAway': 0.15,
    'sportsEdge.recentForm': 0.8,
    'sportsEdge.injuryImpact': -0.6,
  },
  trainedAt: new Date(),
  sampleSize: 0,
  accuracy: 0.5,
};

let currentModel: ModelWeights = DEFAULT_WEIGHTS;

/**
 * Flatten a FeatureVector into a numeric array with named keys.
 */
function flattenFeatures(fv: FeatureVector): Record<string, number> {
  const flat: Record<string, number> = {
    priceLevel: fv.priceLevel,
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

  // Confidence based on: feature coverage, model accuracy, sample size
  const featureCount = Object.keys(flat).length;
  const coverageFactor = Math.min(1, featureCount / 10);
  const modelFactor = model.sampleSize > 50 ? model.accuracy : 0.5;
  const confidence = Math.min(0.9, coverageFactor * modelFactor);

  importance.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { probability, confidence, featureImportance: importance.slice(0, 5) };
}

/**
 * Train model on resolved markets using gradient descent.
 * Called weekly by the calibration job.
 */
export function trainModel(
  trainingData: { features: FeatureVector; outcome: 0 | 1 }[],
  learningRate = 0.01,
  epochs = 100
): ModelWeights {
  if (trainingData.length < 20) {
    // Not enough data — keep defaults
    return currentModel;
  }

  const flatData = trainingData.map(d => ({
    features: flattenFeatures(d.features),
    outcome: d.outcome,
  }));

  // Collect all feature names
  const allFeatures = new Set<string>();
  for (const d of flatData) {
    for (const k of Object.keys(d.features)) allFeatures.add(k);
  }

  // Initialize weights from current model
  const weights: Record<string, number> = { ...currentModel.weights };
  let intercept = currentModel.intercept;

  // Gradient descent
  for (let epoch = 0; epoch < epochs; epoch++) {
    let interceptGrad = 0;
    const grads: Record<string, number> = {};
    for (const f of allFeatures) grads[f] = 0;

    for (const { features, outcome } of flatData) {
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

    const n = flatData.length;
    intercept -= learningRate * (interceptGrad / n);
    for (const f of allFeatures) {
      weights[f] = (weights[f] || 0) - learningRate * (grads[f] / n);
    }
  }

  // Calculate accuracy
  let correct = 0;
  for (const { features, outcome } of flatData) {
    let logit = intercept;
    for (const [f, w] of Object.entries(weights)) {
      if (features[f] !== undefined) logit += w * features[f];
    }
    const pred = sigmoid(logit) >= 0.5 ? 1 : 0;
    if (pred === outcome) correct++;
  }

  const newModel: ModelWeights = {
    intercept,
    weights,
    trainedAt: new Date(),
    sampleSize: flatData.length,
    accuracy: correct / flatData.length,
  };

  currentModel = newModel;
  return newModel;
}

/**
 * Get current model info for dashboard.
 */
export function getModelInfo(): { trainedAt: Date; sampleSize: number; accuracy: number; featureCount: number } {
  return {
    trainedAt: currentModel.trainedAt,
    sampleSize: currentModel.sampleSize,
    accuracy: currentModel.accuracy,
    featureCount: Object.keys(currentModel.weights).length,
  };
}
