import { describe, it, expect } from 'vitest';
import { ExecutionManager } from '@apex/tradex';

describe('TRADEX Execution Mode Routing', () => {
  const manager = new ExecutionManager();

  it('routes ARBEX signals to FAST_EXEC', () => {
    expect(manager.getExecutionMode('ARBEX')).toBe('FAST_EXEC');
  });

  it('routes SPEEDEX signals to FAST_EXEC', () => {
    expect(manager.getExecutionMode('SPEEDEX')).toBe('FAST_EXEC');
  });

  it('routes FLOWEX signals to FAST_EXEC', () => {
    expect(manager.getExecutionMode('FLOWEX')).toBe('FAST_EXEC');
  });

  it('routes SIGINT signals to FAST_EXEC', () => {
    expect(manager.getExecutionMode('SIGINT')).toBe('FAST_EXEC');
  });

  it('routes DOMEX signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('DOMEX')).toBe('SLOW_EXEC');
  });

  it('routes LEGEX signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('LEGEX')).toBe('SLOW_EXEC');
  });

  it('routes COGEX signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('COGEX')).toBe('SLOW_EXEC');
  });

  it('routes REFLEX signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('REFLEX')).toBe('SLOW_EXEC');
  });

  it('routes NEXUS signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('NEXUS')).toBe('SLOW_EXEC');
  });

  it('routes ALTEX signals to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('ALTEX')).toBe('SLOW_EXEC');
  });

  it('defaults unknown modules to SLOW_EXEC', () => {
    expect(manager.getExecutionMode('UNKNOWN')).toBe('SLOW_EXEC');
  });
});

describe('TRADEX Circuit Breaker', () => {
  it('is not open initially', () => {
    const manager = new ExecutionManager();
    expect(manager.isCircuitOpen('KALSHI')).toBe(false);
  });
});
