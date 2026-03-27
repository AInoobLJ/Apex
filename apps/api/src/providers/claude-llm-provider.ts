/**
 * Concrete LLMProvider implementation using Claude client.
 * Wraps callClaude() with the provider interface.
 */
import type { LLMProvider, LLMCallOptions, LLMCallResult } from '@apex/shared';
import { callClaude } from '../services/claude-client';
import type { LLMTask } from '@apex/shared';

export class ClaudeLLMProvider implements LLMProvider {
  async call<T>(opts: LLMCallOptions): Promise<LLMCallResult<T>> {
    const result = await callClaude<T>({
      task: opts.task as LLMTask,
      systemPrompt: opts.systemPrompt,
      userMessage: opts.userMessage,
      maxTokens: opts.maxTokens,
    });
    return {
      parsed: result.parsed,
      raw: result.raw,
      usage: result.usage,
    };
  }
}
