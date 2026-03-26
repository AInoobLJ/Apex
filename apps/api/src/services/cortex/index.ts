/**
 * CORTEX v2 — unified entry point for the 4-engine pipeline.
 *
 * Pipeline: Signals → SignalFusion → Calibration → OpportunityScoring → PortfolioAllocation
 */
export { fuseSignals } from './signal-fusion';
export { calibrate } from './calibration-engine';
export { scoreOpportunity, rankOpportunities } from './opportunity-scoring';
export { allocatePosition, getAllocationSummary } from './portfolio-allocator';
