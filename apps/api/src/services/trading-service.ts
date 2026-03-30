import { ExecutionManager, loadRiskLimits } from '@apex/tradex';
import { kalshiFee } from '@apex/shared';
import type { TradeMode, PreflightResult, RiskLimitConfig, BracketPosition } from '@apex/tradex';
import type { EdgeOutput } from '@apex/shared';
import { PaperExecutor } from '../executors/paper-executor';
import { syncPrisma as prisma } from '../lib/prisma';
import { enterPaperPosition } from './paper-trader';
import { logger } from '../lib/logger';

// ── SystemConfig helpers ──

async function getSystemConfig(key: string): Promise<unknown | null> {
  const config = await prisma.systemConfig.findUnique({ where: { key } });
  return config?.value ?? null;
}

// ── Singleton ──

let _instance: TradingService | null = null;

export interface TradeResult {
  executed: boolean;
  mode: TradeMode;
  preflightPassed: boolean;
  preflightResult?: PreflightResult;
  paperId?: string | null;
  reason?: string;
}

/**
 * TradingService — the bridge between CORTEX edges and TRADEX execution.
 *
 * Wraps ExecutionManager with paper trading support:
 * - PAPER mode: runs all 9 preflight gates, then creates paper position
 * - DRY_RUN mode: runs all 9 preflight gates, logs result, does nothing
 * - LIVE mode: runs all 9 preflight gates, then places real order (future)
 *
 * All trades flow through ExecutionManager.execute() so circuit breakers,
 * preflight gates, and risk limits are always enforced.
 */
export class TradingService {
  private manager: ExecutionManager;
  private mode: TradeMode;

  constructor(mode: TradeMode = 'PAPER') {
    this.manager = new ExecutionManager();
    this.mode = mode;

    // Register paper executors for both platforms
    this.manager.registerExecutor(new PaperExecutor('KALSHI'));
    this.manager.registerExecutor(new PaperExecutor('POLYMARKET'));
  }

  getMode(): TradeMode {
    return this.mode;
  }

  getManager(): ExecutionManager {
    return this.manager;
  }

  /**
   * Execute a trade for an actionable edge.
   * Runs all safety checks, then creates paper position (in PAPER mode).
   */
  async executeEdge(
    edge: EdgeOutput & { daysToResolution?: number },
    platform: 'KALSHI' | 'POLYMARKET' = 'KALSHI',
  ): Promise<TradeResult> {
    if (!edge.isActionable) {
      return { executed: false, mode: this.mode, preflightPassed: false, reason: 'Edge not actionable' };
    }

    // Build preflight context from edge + DB state
    const limits = await loadRiskLimits(getSystemConfig);
    const rawTradeSize = edge.kellySize || edge.expectedValue * 100;
    const entryPrice = edge.edgeDirection === 'BUY_YES' ? edge.marketPrice : (1 - edge.marketPrice);

    const [dailyVolume, openCount, concentrationData, marketData, bracketPositions, marketTitle] = await Promise.all([
      getDailyTradeVolume(),
      getOpenPositionCount(),
      getConcentrationData(platform),
      getMarketOpenData(edge.marketId),
      getOpenBracketPositions(),
      getMarketTitle(edge.marketId),
    ]);

    // Paper mode: scale kelly fraction to dollar amount using $10,000 paper bankroll.
    // kellySize is a fraction (e.g., 0.0125 = 1.25% of bankroll), not dollars.
    // Cap at maxPerTrade BEFORE preflight so RISK_GATE never rejects.
    const paperBankroll = 10000;
    const scaledTradeSize = this.mode === 'PAPER'
      ? Math.max(1, rawTradeSize * paperBankroll)
      : rawTradeSize;
    let dollarTradeSize = Math.min(scaledTradeSize, limits.maxPerTrade);
    let dollarContracts = Math.max(1, Math.ceil(dollarTradeSize / entryPrice));

    // Fee-aware sizing: reduce contracts if fees would exceed 50% of edge dollar value.
    // Without this, cheap contracts (3¢) produce 16K+ contracts with fees > edge → FEE_CHECK rejects.
    const feePerContract = kalshiFeePerContract(entryPrice);
    const edgePerContract = edge.edgeMagnitude; // edge as fraction of $1 contract
    if (feePerContract > 0 && edgePerContract > 0) {
      // Max contracts where fees = 50% of edge dollar value
      const maxContractsForFees = Math.floor((edgePerContract * 0.5) / feePerContract * dollarContracts);
      if (dollarContracts > maxContractsForFees && maxContractsForFees >= 10) {
        dollarContracts = maxContractsForFees;
        dollarTradeSize = dollarContracts * entryPrice;
        logger.debug({
          marketId: edge.marketId,
          originalContracts: Math.ceil(Math.min(scaledTradeSize, limits.maxPerTrade) / entryPrice),
          adjustedContracts: dollarContracts,
          feePerContract: feePerContract.toFixed(4),
          edgePerContract: edgePerContract.toFixed(4),
        }, '[SIZING] Fee-adjusted contract count');
      } else if (maxContractsForFees < 10) {
        // Too few contracts to be worthwhile — skip
        return { executed: false, mode: this.mode, preflightPassed: false, reason: `Fee-prohibitive: need < 10 contracts for fees < 50% of edge` };
      }
    }

    const dollarFee = kalshiFee(entryPrice, dollarContracts);

    // Build OrderRequest for ExecutionManager
    const orderRequest = {
      platform,
      ticker: edge.marketId,
      side: (edge.edgeDirection === 'BUY_YES' ? 'yes' : 'no') as 'yes' | 'no',
      action: 'buy' as const,
      type: 'market_limit' as const,
      price: entryPrice,
      size: dollarTradeSize,
    };

    const preflightCtx = {
      tradeSize: dollarTradeSize,
      currentEdge: edge.edgeMagnitude,
      fee: dollarFee,
      graduated: this.mode === 'PAPER', // Paper mode bypasses graduation gate
      dailyNewTradeVolume: dailyVolume,
      openPositionCount: openCount,
      limits,
      marketClosesAt: marketData?.closesAt ?? undefined,
      marketStatus: marketData?.status ?? undefined,
      concentration: {
        platform,
        category: edge.marketCategory || 'OTHER',
        marketId: edge.marketId,
        positions: concentrationData.positions,
        portfolioValue: concentrationData.portfolioValue,
      },
      bracketConflict: marketTitle ? {
        marketTitle,
        proposedEntryPrice: entryPrice,
        proposedDirection: edge.edgeDirection,
        existingBracketPositions: bracketPositions,
      } : undefined,
      paperMode: this.mode === 'PAPER',
    };

    // Execute through ExecutionManager (runs circuit breaker + preflight + executor)
    const result = await this.manager.execute(orderRequest, preflightCtx);

    if (result.status === 'FAILED') {
      logger.info({
        marketId: edge.marketId,
        mode: this.mode,
        error: result.errorMessage,
        edge: edge.edgeMagnitude.toFixed(4),
        ev: edge.expectedValue.toFixed(4),
      }, `Trade rejected by ExecutionManager: ${result.errorMessage}`);

      return {
        executed: false,
        mode: this.mode,
        preflightPassed: false,
        reason: result.errorMessage,
      };
    }

    // Preflight passed — handle based on trade mode
    if (this.mode === 'DRY_RUN') {
      logger.info({
        marketId: edge.marketId,
        direction: edge.edgeDirection,
        edge: edge.edgeMagnitude.toFixed(4),
        kellySize: dollarTradeSize.toFixed(2),
      }, 'DRY_RUN: trade would be placed (preflight passed)');

      return { executed: false, mode: this.mode, preflightPassed: true, reason: 'Dry run — no action taken' };
    }

    if (this.mode === 'PAPER') {
      // Create paper position
      const paperId = await enterPaperPosition(
        edge,
        edge.cortexProbability,
        (edge as any).daysToResolution,
      ).catch((err) => {
        logger.error(err, 'Failed to create paper position after preflight passed');
        return null;
      });

      logger.info({
        marketId: edge.marketId,
        direction: edge.edgeDirection,
        edge: edge.edgeMagnitude.toFixed(4),
        ev: edge.expectedValue.toFixed(4),
        kellySize: dollarTradeSize.toFixed(2),
        paperId,
        preflightPassed: true,
      }, 'Paper trade executed via ExecutionManager');

      return { executed: !!paperId, mode: this.mode, preflightPassed: true, paperId };
    }

    // LIVE mode — the ExecutionManager already placed the order via the real executor
    logger.info({
      marketId: edge.marketId,
      orderId: result.orderId,
      filledPrice: result.filledPrice,
      filledSize: result.filledSize,
      fee: result.fee,
      latencyMs: result.latencyMs,
    }, 'LIVE trade executed');

    return { executed: true, mode: this.mode, preflightPassed: true };
  }
}

// ── DB Helpers ──

async function getDailyTradeVolume(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const positions = await prisma.paperPosition.findMany({
    where: { createdAt: { gte: today } },
  });

  return positions.reduce((sum, p) => sum + p.kellySize * p.entryPrice, 0);
}

async function getOpenPositionCount(): Promise<number> {
  return prisma.paperPosition.count({ where: { isOpen: true } });
}

async function getConcentrationData(platform: 'KALSHI' | 'POLYMARKET'): Promise<{
  positions: { marketId: string; platform: 'KALSHI' | 'POLYMARKET'; category: string; notional: number }[];
  portfolioValue: number;
}> {
  const openPositions = await prisma.paperPosition.findMany({
    where: { isOpen: true },
    include: { market: { select: { category: true, platform: true } } },
  });

  const positions = openPositions.map(p => ({
    marketId: p.marketId,
    platform: (p.market?.platform ?? 'KALSHI') as 'KALSHI' | 'POLYMARKET',
    category: p.market?.category ?? 'OTHER',
    notional: p.kellySize * p.entryPrice,
  }));

  const deployed = positions.reduce((sum, p) => sum + p.notional, 0);
  // Paper portfolio = $10,000 base + deployed
  const portfolioValue = 10000;

  return { positions, portfolioValue };
}

async function getMarketOpenData(marketId: string): Promise<{ closesAt: Date; status: string } | null> {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { closesAt: true, status: true },
  });
  return market ? { closesAt: market.closesAt, status: market.status } : null;
}

async function getMarketTitle(marketId: string): Promise<string | null> {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { title: true },
  });
  return market?.title ?? null;
}

/**
 * Get all open bracket positions with their market titles.
 * Used by Gate 10 (BRACKET_CONFLICT) to detect mutually exclusive bracket groups.
 */
async function getOpenBracketPositions(): Promise<BracketPosition[]> {
  const openPositions = await prisma.paperPosition.findMany({
    where: { isOpen: true },
    include: { market: { select: { title: true } } },
  });

  return openPositions.map(p => ({
    marketId: p.marketId,
    title: p.market?.title ?? '',
    entryPrice: p.entryPrice,
    direction: p.direction as 'BUY_YES' | 'BUY_NO',
  }));
}

// ── Singleton Access ──

export function getTradingService(): TradingService {
  if (!_instance) {
    _instance = new TradingService('PAPER');
    logger.info({ mode: 'PAPER' }, 'TradingService initialized');
  }
  return _instance;
}
