import { createHash } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import Bottleneck from 'bottleneck';
import { config } from '../config';
import { logApiUsage } from './api-usage-logger';
import { recordLLMSpend } from './llm-budget-tracker';
import { getModelConfig, LLMTask } from '@apex/shared';
import { logger } from '../lib/logger';

const apiKey = config.ANTHROPIC_API_KEY && config.ANTHROPIC_API_KEY.length > 10
  ? config.ANTHROPIC_API_KEY
  : process.env.ANTHROPIC_API_KEY || undefined;

const client = new Anthropic({ apiKey });

// Rate limit: 50 req/min
const limiter = new Bottleneck({
  reservoir: 50,
  reservoirRefreshAmount: 50,
  reservoirRefreshInterval: 60000,
  maxConcurrent: 5,
});

// ── Cost optimization tracking ──
let cacheHits = 0;
let cacheMisses = 0;
let callsSavedByCache = 0;
let callsSavedByScheduling = 0;
let estimatedSavingsToday = 0;

export function getCostOptimizationStats() {
  return {
    cacheHits,
    cacheMisses,
    cacheHitRate: cacheHits + cacheMisses > 0
      ? cacheHits / (cacheHits + cacheMisses)
      : 0,
    callsSavedByCache,
    callsSavedByScheduling,
    estimatedSavingsToday,
  };
}

export function recordSchedulingSaving() {
  callsSavedByScheduling++;
  estimatedSavingsToday += 0.005; // avg cost per call
}

// Reset daily at midnight
let resetDate = new Date().toDateString();
function checkDailyReset() {
  const today = new Date().toDateString();
  if (today !== resetDate) {
    cacheHits = 0;
    cacheMisses = 0;
    callsSavedByCache = 0;
    callsSavedByScheduling = 0;
    estimatedSavingsToday = 0;
    resetDate = today; // Update so we don't reset on every call after midnight
    resultCache.clear(); // Clear cache on new day
  }
}

export interface ClaudeCallOptions {
  systemPrompt: string;
  userMessage: string;
  task: LLMTask;
  maxTokens?: number;
  /** Enable prompt caching on the system prompt (default: true) */
  cacheSystemPrompt?: boolean;
}

export interface ClaudeResponse<T> {
  parsed: T;
  raw: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

/**
 * In-memory result cache for LLM responses.
 * Key = hash of (task + systemPrompt + userMessage), Value = { response, expiresAt }
 */
const resultCache = new Map<string, { response: any; expiresAt: number }>();

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Check result cache before making API call.
 * Returns cached response if available and not expired.
 */
export function getCachedResult<T>(task: string, userMessage: string, systemPrompt: string): ClaudeResponse<T> | null {
  checkDailyReset();
  const key = hashString(`${task}:${systemPrompt.slice(0, 100)}:${userMessage}`);
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    cacheHits++;
    callsSavedByCache++;
    estimatedSavingsToday += 0.005;
    return cached.response;
  }
  if (cached) resultCache.delete(key); // expired
  cacheMisses++;
  return null;
}

/**
 * Store result in cache with TTL.
 */
export function cacheResult<T>(task: string, userMessage: string, systemPrompt: string, response: ClaudeResponse<T>, ttlMs: number): void {
  const key = hashString(`${task}:${systemPrompt.slice(0, 100)}:${userMessage}`);
  resultCache.set(key, { response, expiresAt: Date.now() + ttlMs });

  // Evict old entries if cache grows too large
  if (resultCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of resultCache) {
      if (v.expiresAt < now) resultCache.delete(k);
    }
  }
}

// Module-specific cache TTLs — keyed by LLMTask name
export const CACHE_TTLS: Record<string, number> = {
  LEGEX_ANALYSIS: 24 * 60 * 60 * 1000,  // 24 hours — resolution criteria don't change
  REFLEX_ANALYSIS: 24 * 60 * 60 * 1000, // 24 hours — reflexivity is slow-moving
  DOMEX_AGENT: 6 * 60 * 60 * 1000,      // 6 hours (legacy)
  DOMEX_FEATURE_EXTRACT: 6 * 60 * 60 * 1000, // 6 hours — features don't change fast
  ALTEX_ANALYSIS: 4 * 60 * 60 * 1000,   // 4 hours
  SCREEN_MARKET: 12 * 60 * 60 * 1000,   // 12 hours — screening result stable
  SCREEN_NEWS: 30 * 60 * 1000,          // 30 minutes
};

/**
 * Call Claude with structured JSON output parsing.
 * Handles retries on 529/timeout, token tracking, cost logging.
 * Enables prompt caching on system prompts by default.
 */
export async function callClaude<T>(options: ClaudeCallOptions): Promise<ClaudeResponse<T>> {
  checkDailyReset();

  // Check result cache first
  const taskKey = options.task;
  const ttl = CACHE_TTLS[taskKey as keyof typeof CACHE_TTLS];
  if (ttl) {
    const cached = getCachedResult<T>(taskKey, options.userMessage, options.systemPrompt);
    if (cached) {
      logger.debug({ task: taskKey }, 'LLM result cache hit');
      return cached;
    }
  }

  const modelConfig = getModelConfig(options.task);
  const maxTokens = options.maxTokens ?? modelConfig.maxTokens;
  const maxRetries = 1;
  const usePromptCache = options.cacheSystemPrompt !== false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();

    try {
      // Build system message with cache_control for prompt caching
      const systemMessage: Anthropic.MessageCreateParams['system'] = usePromptCache
        ? [{
            type: 'text' as const,
            text: options.systemPrompt,
            cache_control: { type: 'ephemeral' as const },
          }]
        : options.systemPrompt;

      const response = await limiter.schedule(() =>
        client.messages.create({
          model: modelConfig.model,
          max_tokens: maxTokens,
          system: systemMessage,
          messages: [{ role: 'user', content: options.userMessage }],
        })
      );

      const latencyMs = Date.now() - start;
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cacheReadTokens = (response.usage as any).cache_read_input_tokens ?? 0;
      const cacheCreationTokens = (response.usage as any).cache_creation_input_tokens ?? 0;

      // Cost calculation: cached tokens are 90% cheaper for reads, 25% more for creation
      const uncachedInputTokens = inputTokens - cacheReadTokens - cacheCreationTokens;
      const cost =
        uncachedInputTokens * modelConfig.costPerInputToken +
        cacheReadTokens * modelConfig.costPerInputToken * 0.1 +  // 90% discount
        cacheCreationTokens * modelConfig.costPerInputToken * 1.25 + // 25% surcharge
        outputTokens * modelConfig.costPerOutputToken;

      // Track savings from prompt caching
      if (cacheReadTokens > 0) {
        const savedCost = cacheReadTokens * modelConfig.costPerInputToken * 0.9;
        estimatedSavingsToday += savedCost;
      }

      // Log usage
      await logApiUsage({
        service: 'claude',
        endpoint: `${modelConfig.model}/${options.task}`,
        latencyMs,
        statusCode: 200,
        tokensIn: inputTokens,
        tokensOut: outputTokens,
        cost,
      });

      // Track budget
      await recordLLMSpend(cost);

      // Extract text content
      const textBlock = response.content.find(b => b.type === 'text');
      const rawText = textBlock?.type === 'text' ? textBlock.text : '';

      // Parse JSON from response
      const parsed = parseJsonResponse<T>(rawText);

      const result: ClaudeResponse<T> = {
        parsed,
        raw: rawText,
        usage: { inputTokens, outputTokens, cost, cacheReadTokens, cacheCreationTokens },
      };

      // Store in result cache if TTL configured
      if (ttl) {
        cacheResult(taskKey, options.userMessage, options.systemPrompt, result, ttl);
      }

      if (cacheReadTokens > 0) {
        logger.debug({ task: taskKey, cacheReadTokens, savedPct: ((cacheReadTokens / inputTokens) * 100).toFixed(0) }, 'Prompt cache hit');
      }

      return result;
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const statusCode = (err as any)?.status ?? 0;

      await logApiUsage({
        service: 'claude',
        endpoint: `${modelConfig.model}/${options.task}`,
        latencyMs,
        statusCode,
      });

      // Retry on 529 (overloaded) or timeout
      if (attempt < maxRetries && (statusCode === 529 || statusCode === 408)) {
        const backoffMs = (attempt + 1) * 2000;
        logger.warn({ attempt, statusCode, backoffMs }, 'Claude call failed, retrying...');
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      logger.error({ err, task: options.task }, 'Claude call failed');
      throw err;
    }
  }

  throw new Error('Claude call failed after all retries');
}

/**
 * Parse JSON from Claude's response text.
 * Handles markdown code blocks and raw JSON.
 */
function parseJsonResponse<T>(text: string): T {
  // Strip markdown code fences if present
  let json = text.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    return JSON.parse(json);
  } catch {
    // Try to extract JSON from within the text
    const jsonMatch = json.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error(`Failed to parse JSON from Claude response: ${text.slice(0, 200)}`);
  }
}
