/**
 * Generic Circuit Breaker — protects external API calls.
 *
 * States:
 *   CLOSED  → normal operation, requests pass through
 *   OPEN    → after 5 failures in 10 min, all requests fast-fail
 *   HALF_OPEN → after 5 min reset, allow 1 probe request
 *
 * If probe succeeds → CLOSED. If probe fails → OPEN again.
 */
import { logger } from './logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;    // failures before opening (default: 5)
  failureWindowMs?: number;     // window for counting failures (default: 10 min)
  resetTimeoutMs?: number;      // time in OPEN before trying HALF_OPEN (default: 5 min)
}

interface CircuitInfo {
  state: CircuitState;
  failures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
}

class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failures: { ts: number }[] = [];
  private failureThreshold: number;
  private failureWindowMs: number;
  private resetTimeoutMs: number;
  private openedAt: number | null = null;
  private lastSuccess: number | null = null;
  private lastFailure: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.failureWindowMs = opts.failureWindowMs ?? 10 * 60 * 1000;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 5 * 60 * 1000;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed
      if (this.openedAt && Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        logger.info({ breaker: this.name }, 'Circuit breaker HALF_OPEN — allowing probe');
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccess = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failures = [];
      logger.info({ breaker: this.name }, 'Circuit breaker CLOSED — probe succeeded');
    }
  }

  private onFailure(): void {
    this.totalFailures++;
    this.lastFailure = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Probe failed — back to OPEN
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.warn({ breaker: this.name }, 'Circuit breaker OPEN — probe failed');
      return;
    }

    // Add failure and prune old ones
    this.failures.push({ ts: Date.now() });
    const cutoff = Date.now() - this.failureWindowMs;
    this.failures = this.failures.filter(f => f.ts >= cutoff);

    if (this.failures.length >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
      logger.warn({
        breaker: this.name,
        failures: this.failures.length,
        window: `${this.failureWindowMs / 60000}min`,
      }, 'Circuit breaker OPEN — threshold reached');
    }
  }

  getInfo(): CircuitInfo {
    // Auto-transition to HALF_OPEN for info display
    if (this.state === 'OPEN' && this.openedAt && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
    }

    return {
      state: this.state,
      failures: this.failures.length,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  /** Force reset to CLOSED (manual override) */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = [];
    this.openedAt = null;
    logger.info({ breaker: this.name }, 'Circuit breaker manually reset');
  }
}

export class CircuitOpenError extends Error {
  constructor(breakerName: string) {
    super(`Circuit breaker '${breakerName}' is OPEN — requests blocked`);
    this.name = 'CircuitOpenError';
  }
}

// ── Registry of all circuit breakers ──

const breakers: Record<string, CircuitBreaker> = {};

export function getCircuitBreaker(name: string, opts?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  if (!breakers[name]) {
    breakers[name] = new CircuitBreaker({ name, ...opts });
  }
  return breakers[name];
}

export function getAllCircuitBreakers(): Record<string, CircuitInfo> {
  const result: Record<string, CircuitInfo> = {};
  for (const [name, breaker] of Object.entries(breakers)) {
    result[name] = breaker.getInfo();
  }
  return result;
}

// Pre-register breakers for known services
export const kalshiBreaker = getCircuitBreaker('kalshi');
export const polymarketBreaker = getCircuitBreaker('polymarket');
export const claudeBreaker = getCircuitBreaker('claude', { failureThreshold: 10 });
export const binanceBreaker = getCircuitBreaker('binance');
export const coingeckoBreaker = getCircuitBreaker('coingecko');
export const fredBreaker = getCircuitBreaker('fred');
export const newsBreaker = getCircuitBreaker('news');
