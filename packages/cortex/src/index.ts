/**
 * @apex/cortex — core intelligence package
 *
 * 4 Core Engines:
 * - SignalFusionEngine: weighted combination of raw signals with time decay
 * - CalibrationEngine: quantitative bias correction per module/category
 * - OpportunityScoringEngine: EV, capital efficiency, ranking
 * - PortfolioAllocator: position sizing, category budgets, risk limits
 *
 * Models:
 * - FeatureModel: logistic regression over structured features
 * - ImpliedVolModel: Black-Scholes pricing for crypto contracts
 */

// ── SignalFusionEngine ──
export { fuseSignals } from './signal-fusion';
export type { RawSignal, FusedSignal } from './signal-fusion';

// ── CalibrationEngine ──
export {
  applyCalibration, recalibrate, loadCalibration, getCalibrationTable,
} from './calibration-memory';
export type { CalibrationRecord } from './calibration-memory';

// ── OpportunityScoringEngine ──
export { scoreOpportunity, rankOpportunities } from './opportunity-scoring';
export type { OpportunityScore } from './opportunity-scoring';

// ── PortfolioAllocator ──
export {
  requestAllocation, recordPosition, closePosition, resetDaily,
  getPortfolioState, updateAllocations,
} from './portfolio-allocator';
export type { CategoryBudget, AllocationDecision, PortfolioState } from './portfolio-allocator';

// ── FeatureModel ──
export { predict, trainModel, getModelInfo } from './feature-model';
export type {
  FeatureVector, FedHawkFeatures, GeoIntelFeatures, SportsEdgeFeatures,
  CryptoAlphaFeatures, LegexFeatures, AltexFeatures,
} from './feature-model';

// ── ImpliedVolModel ──
export {
  priceFloorContract, priceBracketContract, calculateRealizedVol, findVolEdges,
} from './implied-vol-model';
export type { VolEdge } from './implied-vol-model';
