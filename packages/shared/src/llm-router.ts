export type LLMTier = 'TIER_1' | 'TIER_2' | 'TIER_3';

export type LLMTask =
  | 'SCREEN_NEWS'
  | 'SCREEN_MARKET'
  | 'LEGEX_ANALYSIS'
  | 'DOMEX_AGENT'
  | 'DOMEX_FEATURE_EXTRACT'
  | 'ALTEX_ANALYSIS'
  | 'ALTEX_CHINESE'
  | 'NEXUS_CAUSAL'
  | 'REFLEX_ANALYSIS'
  | 'CONFLICT_RESOLVE'
  | 'POST_MORTEM'
  | 'GRAPH_BUILD'
  | 'EVENT_MAP'
  | 'MARKET_MATCH';

export interface ModelConfig {
  tier: LLMTier;
  model: string;
  maxTokens: number;
  costPerInputToken: number;
  costPerOutputToken: number;
}

const TIER_CONFIGS: Record<LLMTier, ModelConfig> = {
  TIER_1: {
    tier: 'TIER_1',
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 1024,
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
  },
  TIER_2: {
    tier: 'TIER_2',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
  TIER_3: {
    tier: 'TIER_3',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
};

const TASK_TIER_MAP: Record<LLMTask, LLMTier> = {
  SCREEN_NEWS: 'TIER_1',
  SCREEN_MARKET: 'TIER_1',
  LEGEX_ANALYSIS: 'TIER_2',
  DOMEX_AGENT: 'TIER_2',
  DOMEX_FEATURE_EXTRACT: 'TIER_1',  // Feature extraction uses Haiku (~75% cost reduction)
  ALTEX_ANALYSIS: 'TIER_2',
  ALTEX_CHINESE: 'TIER_2',
  NEXUS_CAUSAL: 'TIER_2',
  REFLEX_ANALYSIS: 'TIER_2',
  CONFLICT_RESOLVE: 'TIER_3',
  POST_MORTEM: 'TIER_3',
  GRAPH_BUILD: 'TIER_3',
  EVENT_MAP: 'TIER_1',
  MARKET_MATCH: 'TIER_1',
};

export function getModelConfig(task: LLMTask): ModelConfig {
  const tier = TASK_TIER_MAP[task];
  return TIER_CONFIGS[tier];
}

export function estimateCost(task: LLMTask, inputTokens: number, outputTokens: number): number {
  const config = getModelConfig(task);
  return inputTokens * config.costPerInputToken + outputTokens * config.costPerOutputToken;
}
