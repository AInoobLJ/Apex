/**
 * @apex/cortex — core intelligence package
 *
 * FeatureModel: logistic regression over structured features
 * ImpliedVolModel: Black-Scholes pricing for crypto contracts
 * CalibrationMemory: quantitative bias correction
 */
export { predict, trainModel, getModelInfo } from './feature-model';
export type {
  FeatureVector, FedHawkFeatures, GeoIntelFeatures, SportsEdgeFeatures,
  CryptoAlphaFeatures, LegexFeatures, AltexFeatures,
} from './feature-model';

export {
  priceFloorContract, priceBracketContract, calculateRealizedVol, findVolEdges,
} from './implied-vol-model';
export type { VolEdge } from './implied-vol-model';

export {
  applyCalibration, recalibrate, loadCalibration, getCalibrationTable,
} from './calibration-memory';
export type { CalibrationRecord } from './calibration-memory';
