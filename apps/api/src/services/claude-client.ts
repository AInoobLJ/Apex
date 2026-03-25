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

export interface ClaudeCallOptions {
  systemPrompt: string;
  userMessage: string;
  task: LLMTask;
  maxTokens?: number;
}

export interface ClaudeResponse<T> {
  parsed: T;
  raw: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

/**
 * Call Claude with structured JSON output parsing.
 * Handles retries on 529/timeout, token tracking, cost logging.
 */
export async function callClaude<T>(options: ClaudeCallOptions): Promise<ClaudeResponse<T>> {
  const modelConfig = getModelConfig(options.task);
  const maxTokens = options.maxTokens ?? modelConfig.maxTokens;
  const maxRetries = 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const start = Date.now();

    try {
      const response = await limiter.schedule(() =>
        client.messages.create({
          model: modelConfig.model,
          max_tokens: maxTokens,
          system: options.systemPrompt,
          messages: [{ role: 'user', content: options.userMessage }],
        })
      );

      const latencyMs = Date.now() - start;
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const cost = inputTokens * modelConfig.costPerInputToken + outputTokens * modelConfig.costPerOutputToken;

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

      return {
        parsed,
        raw: rawText,
        usage: { inputTokens, outputTokens, cost },
      };
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
