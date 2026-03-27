import type { Platform } from '@apex/shared';
import type {
  ExecutionMode,
  OrderRequest,
  OrderResult,
  RiskLimitConfig,
  ArbSignal,
} from './types';
import { FAST_EXEC_MODULES, SLOW_EXEC_MODULES } from './types';
import { BaseExecutor } from './executors/base';
import { runPreflight, PreflightContext } from './preflight';

// ── Circuit Breaker ──

interface CircuitBreakerState {
  consecutiveFailures: number;
  pausedUntil: number | null; // timestamp
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 15 * 60 * 1000; // 15 minutes

// ── ExecutionManager ──

export class ExecutionManager {
  private executors: Map<Platform, BaseExecutor> = new Map();
  private circuitBreakers: Map<Platform, CircuitBreakerState> = new Map();

  registerExecutor(executor: BaseExecutor): void {
    this.executors.set(executor.platform, executor);
    this.circuitBreakers.set(executor.platform, {
      consecutiveFailures: 0,
      pausedUntil: null,
    });
  }

  getExecutor(platform: Platform): BaseExecutor | undefined {
    return this.executors.get(platform);
  }

  /**
   * Determine execution mode based on signal source module.
   */
  getExecutionMode(moduleId: string): ExecutionMode {
    if ((FAST_EXEC_MODULES as readonly string[]).includes(moduleId)) return 'FAST_EXEC';
    if ((SLOW_EXEC_MODULES as readonly string[]).includes(moduleId)) return 'SLOW_EXEC';
    return 'SLOW_EXEC'; // default to SLOW for unknown modules
  }

  /**
   * Check if platform circuit breaker is open (paused).
   */
  isCircuitOpen(platform: Platform): boolean {
    const cb = this.circuitBreakers.get(platform);
    if (!cb?.pausedUntil) return false;
    if (Date.now() > cb.pausedUntil) {
      // Reset — circuit breaker pause expired
      cb.pausedUntil = null;
      cb.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  /**
   * Execute a trade on a platform.
   * Runs preflight, then places order.
   */
  async execute(
    request: OrderRequest,
    preflightCtx: Omit<PreflightContext, 'executor'>
  ): Promise<OrderResult> {
    const executor = this.executors.get(request.platform);
    if (!executor) {
      return {
        orderId: '',
        platform: request.platform,
        status: 'FAILED',
        filledPrice: null,
        filledSize: null,
        fee: 0,
        latencyMs: 0,
        errorMessage: `No executor registered for ${request.platform}`,
      };
    }

    // Check circuit breaker
    if (this.isCircuitOpen(request.platform)) {
      return {
        orderId: '',
        platform: request.platform,
        status: 'FAILED',
        filledPrice: null,
        filledSize: null,
        fee: 0,
        latencyMs: 0,
        errorMessage: `Circuit breaker open for ${request.platform} — paused after consecutive failures`,
      };
    }

    // Run preflight
    const preflightResult = await runPreflight({
      ...preflightCtx,
      executor,
    });

    if (!preflightResult.pass) {
      return {
        orderId: '',
        platform: request.platform,
        status: 'FAILED',
        filledPrice: null,
        filledSize: null,
        fee: 0,
        latencyMs: 0,
        errorMessage: `Preflight failed: ${preflightResult.failedGate} — ${preflightResult.reason}`,
      };
    }

    // Place order
    const result = await executor.placeOrder(request);

    // Update circuit breaker
    this.updateCircuitBreaker(request.platform, result.status === 'FAILED');

    return result;
  }

  /**
   * Execute an arb: place BOTH legs simultaneously.
   * If one fails, cancel the other.
   */
  async executeArb(
    arb: ArbSignal,
    preflightCtx: Omit<PreflightContext, 'executor'>
  ): Promise<{ leg1: OrderResult; leg2: OrderResult; status: 'BOTH_FILLED' | 'PARTIAL' | 'FAILED' }> {
    const executor1 = this.executors.get(arb.leg1.platform);
    const executor2 = this.executors.get(arb.leg2.platform);

    if (!executor1 || !executor2) {
      const failResult: OrderResult = {
        orderId: '',
        platform: arb.leg1.platform,
        status: 'FAILED',
        filledPrice: null,
        filledSize: null,
        fee: 0,
        latencyMs: 0,
        errorMessage: 'Missing executor for arb leg',
      };
      return { leg1: failResult, leg2: { ...failResult, platform: arb.leg2.platform }, status: 'FAILED' };
    }

    // ── PREFLIGHT: Same safety gates as single-leg execution ──
    // Check circuit breakers for BOTH platforms before placing any orders
    if (this.isCircuitOpen(arb.leg1.platform)) {
      const failResult: OrderResult = {
        orderId: '', platform: arb.leg1.platform, status: 'FAILED',
        filledPrice: null, filledSize: null, fee: 0, latencyMs: 0,
        errorMessage: `Circuit breaker open for ${arb.leg1.platform} — arb aborted`,
      };
      return { leg1: failResult, leg2: { ...failResult, platform: arb.leg2.platform }, status: 'FAILED' };
    }
    if (this.isCircuitOpen(arb.leg2.platform)) {
      const failResult: OrderResult = {
        orderId: '', platform: arb.leg2.platform, status: 'FAILED',
        filledPrice: null, filledSize: null, fee: 0, latencyMs: 0,
        errorMessage: `Circuit breaker open for ${arb.leg2.platform} — arb aborted`,
      };
      return { leg1: { ...failResult, platform: arb.leg1.platform }, leg2: failResult, status: 'FAILED' };
    }

    // Run preflight risk gates (daily limits, position limits, exposure checks)
    const preflightResult = await runPreflight({
      ...preflightCtx,
      executor: executor1,
    });
    if (!preflightResult.pass) {
      const failResult: OrderResult = {
        orderId: '', platform: arb.leg1.platform, status: 'FAILED',
        filledPrice: null, filledSize: null, fee: 0, latencyMs: 0,
        errorMessage: `Arb preflight failed: ${preflightResult.failedGate} — ${preflightResult.reason}`,
      };
      return { leg1: failResult, leg2: { ...failResult, platform: arb.leg2.platform }, status: 'FAILED' };
    }

    const leg1Request: OrderRequest = {
      platform: arb.leg1.platform,
      ticker: arb.leg1.ticker,
      side: arb.leg1.side,
      action: 'buy',
      type: 'market_limit',
      price: arb.leg1.price,
      size: arb.leg1.size,
    };

    const leg2Request: OrderRequest = {
      platform: arb.leg2.platform,
      ticker: arb.leg2.ticker,
      side: arb.leg2.side,
      action: 'buy',
      type: 'market_limit',
      price: arb.leg2.price,
      size: arb.leg2.size,
    };

    // Sequential execution: place leg 1 first, only proceed to leg 2 if leg 1 fills.
    // This prevents orphaned positions from simultaneous execution.
    const leg1Result = await executor1.placeOrder(leg1Request);

    if (leg1Result.status === 'FAILED') {
      const leg2Fail: OrderResult = {
        orderId: '', platform: arb.leg2.platform, status: 'FAILED',
        filledPrice: null, filledSize: null, fee: 0, latencyMs: 0,
        errorMessage: 'Skipped: leg 1 failed',
      };
      return { leg1: leg1Result, leg2: leg2Fail, status: 'FAILED' };
    }

    // Leg 1 succeeded — now place leg 2
    const leg2Result = await executor2.placeOrder(leg2Request);

    if (leg2Result.status === 'FAILED') {
      // Leg 2 failed — close leg 1 to prevent orphaned position
      if (leg1Result.orderId) {
        try {
          await executor1.cancelOrder(leg1Result.orderId);
        } catch (err) {
          // CRITICAL: orphaned leg 1 — log for reconciliation
          console.error(`ORPHANED ARB LEG: ${leg1Result.orderId} on ${arb.leg1.platform} — manual reconciliation required`);
        }
      }
      return { leg1: leg1Result, leg2: leg2Result, status: 'PARTIAL' };
    }

    return {
      leg1: leg1Result,
      leg2: leg2Result,
      status: leg1Result.status === 'FILLED' && leg2Result.status === 'FILLED' ? 'BOTH_FILLED' : 'PARTIAL',
    };
  }

  // ── Circuit Breaker ──

  private updateCircuitBreaker(platform: Platform, failed: boolean): void {
    const cb = this.circuitBreakers.get(platform);
    if (!cb) return;

    if (failed) {
      cb.consecutiveFailures++;
      if (cb.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        cb.pausedUntil = Date.now() + CIRCUIT_BREAKER_PAUSE_MS;
      }
    } else {
      cb.consecutiveFailures = 0;
    }
  }
}
