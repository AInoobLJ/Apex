// Types
export * from './types';

// Core
export { ExecutionManager } from './manager';
export { runPreflight, checkConcentration } from './preflight';
export type { PreflightContext } from './preflight';
export { parseBracketTitle, groupBracketPositions, checkBracketConflict } from './bracket-detection';
export { loadRiskLimits, saveRiskLimits, enforceHardCeilings, SYSTEM_CONFIG_KEY } from './risk-limits';

// Executors
export { BaseExecutor } from './executors/base';
export { KalshiExecutor } from './executors/kalshi';
export type { KalshiExecutorConfig } from './executors/kalshi';
export { PolymarketExecutor } from './executors/polymarket';
export type { PolymarketExecutorConfig } from './executors/polymarket';

// Strategies
export { executeMakerFirst, DEFAULT_MAKER_FIRST } from './strategies/maker-first';
export type { MakerFirstConfig } from './strategies/maker-first';
export { calculateQuotes, placeMMOrders, shouldCancelAll, DEFAULT_MM_CONFIG } from './strategies/market-maker';
export type { MarketMakerConfig, MarketMakerQuotes } from './strategies/market-maker';
export { executeIceberg, DEFAULT_ICEBERG } from './strategies/iceberg';
export type { IcebergConfig } from './strategies/iceberg';
export { routeOrder } from './strategies/smart-router';
export type { RouteDecision } from './strategies/smart-router';
