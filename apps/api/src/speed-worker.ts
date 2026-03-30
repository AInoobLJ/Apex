/**
 * APEX SPEED Worker — Event-driven streaming process for crypto latency arbitrage.
 *
 * NOT a polling cycle. This is a persistent streaming process that:
 * 1. Connects to Binance.US WebSocket for real-time crypto prices
 * 2. Loads all active crypto bracket markets from DB
 * 3. On EVERY price tick, recalculates bracket probabilities
 * 4. Compares against cached Kalshi market prices
 * 5. When edge crosses threshold → evaluates for paper trade
 *
 * Runs as a separate pm2 process alongside apex-api and apex-worker.
 *
 * Start: npx tsx apps/api/src/speed-worker.ts
 */
import { config } from './config';
import { logger } from './lib/logger';
import { syncPrisma as prisma } from './lib/prisma';
import { binanceWs } from './services/data-sources/binance-ws';
import {
  parseKalshiCryptoTicker,
  calculateBracketImpliedProb,
  calculateSpotImpliedProb,
  annualizedToHourly,
} from './services/crypto-price';
import {
  EDGE_ACTIONABILITY_THRESHOLD,
  MIN_CONFIDENCE_FOR_ACTIONABLE,
  clampProbability,
  kalshiFeePerContract,
} from '@apex/shared';
import { synthesize, persistEdge, persistTrainingSnapshot, CortexInput } from './engine/cortex';
import { getTradingService } from './services/trading-service';
import { estimateVolatility, VolatilityEstimate } from './services/volatility-estimator';
import type { SignalOutput } from '@apex/shared';
import { Prisma } from '@apex/db';

// ── VOL-REGIME: cached vol estimates (refreshed every 30s) ──
const cachedVol: Record<string, VolatilityEstimate> = {};

// ── Configuration ──
const EDGE_THRESHOLD_AFTER_FEES = 0.03;   // 3% minimum edge after fees
const FAST_PATH_MIN_EDGE = 0.10;          // 10% edge minimum to trigger fast path (immediate CORTEX → trade)
const MIN_EDGE_PERSIST_MS = 10_000;        // Edge must persist 10 seconds before acting
const MIN_TIME_TO_EXPIRY_SEC = 120;        // Don't trade markets < 2 minutes to expiry
const TRADE_COOLDOWN_MS = 15 * 60 * 1000;  // Max 1 trade per market per 15 minutes
const MARKET_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // Refresh market list from DB every 5 min
const KALSHI_PRICE_REFRESH_MS = 45_000;    // Refresh Kalshi prices every 45 seconds
const DEFAULT_ANNUALIZED_VOL = 0.57;       // ~57% annualized, ~0.6% hourly

// ── Types ──
interface ActiveBracket {
  marketId: string;
  contractId: string;         // platformContractId (Kalshi ticker)
  asset: string;              // BTC, ETH, SOL
  lower: number;              // bracket lower bound
  upper: number;              // bracket upper bound
  bracketWidth: number;
  contractType: 'BRACKET' | 'FLOOR';
  closesAt: Date;
  kalshiPrice: number;        // cached YES price from Kalshi
  kalshiPriceUpdatedAt: number;
  title: string;
  volume: number;
}

interface PendingEdge {
  bracket: ActiveBracket;
  fairProb: number;
  edge: number;
  firstDetectedAt: number;    // When edge was first detected
  lastConfirmedAt: number;    // Most recent tick confirming edge
}

// ── State ──
const activeBrackets = new Map<string, ActiveBracket[]>(); // symbol → brackets
const pendingEdges = new Map<string, PendingEdge>();        // contractId → pending edge
const lastTradeTime = new Map<string, number>();            // contractId → last trade timestamp
let tickCount = 0;
let edgesDetected = 0;
let tradesCreated = 0;
let fastPathAttempts = 0;
let fastPathTrades = 0;

// ── Global error handlers ──
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, '[SPEED] Uncaught exception — worker survived');
  sendTelegramAlert(`🚨 SPEED worker uncaught exception: ${err.message}`).catch(() => {});
});

process.on('unhandledRejection', (reason: any) => {
  const message = reason?.message || String(reason);
  logger.error({ err: message }, '[SPEED] Unhandled rejection — worker survived');
});

async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch { /* fire and forget */ }
}

/**
 * Load active crypto bracket markets from DB.
 * Only markets closing within 24 hours, with valid prices.
 */
async function loadActiveBrackets(): Promise<void> {
  const markets = await prisma.market.findMany({
    where: {
      status: 'ACTIVE',
      category: 'CRYPTO',
      platform: 'KALSHI',
      platformMarketId: { startsWith: 'KX' },
      OR: [
        { platformMarketId: { startsWith: 'KXBTC' } },
        { platformMarketId: { startsWith: 'KXETH' } },
        { platformMarketId: { startsWith: 'KXSOL' } },
      ],
      closesAt: {
        gt: new Date(),
        lt: new Date(Date.now() + 24 * 3600000),
      },
    },
    include: {
      contracts: { where: { outcome: 'YES' } },
    },
    orderBy: { closesAt: 'asc' },
  });

  activeBrackets.clear();

  let bracketCount = 0;
  for (const market of markets) {
    const yesContract = market.contracts[0];
    if (!yesContract) continue;

    const contractPrice = yesContract.lastPrice
      ?? (yesContract.bestBid && yesContract.bestAsk ? (yesContract.bestBid + yesContract.bestAsk) / 2 : null)
      ?? yesContract.bestAsk ?? yesContract.bestBid ?? null;
    if (!contractPrice || contractPrice < 0.02 || contractPrice > 0.98) continue;

    const parsed = parseKalshiCryptoTicker((yesContract as any).platformContractId || '');
    if (!parsed || parsed.contractType === 'UNKNOWN') continue;

    const bracket: ActiveBracket = {
      marketId: market.id,
      contractId: (yesContract as any).platformContractId || '',
      asset: parsed.asset,
      lower: parsed.strike,
      upper: parsed.strike + parsed.bracketWidth,
      bracketWidth: parsed.bracketWidth,
      contractType: parsed.contractType,
      closesAt: market.closesAt!,
      kalshiPrice: contractPrice,
      kalshiPriceUpdatedAt: Date.now(),
      title: market.title,
      volume: market.volume,
    };

    if (!activeBrackets.has(parsed.asset)) {
      activeBrackets.set(parsed.asset, []);
    }
    activeBrackets.get(parsed.asset)!.push(bracket);
    bracketCount++;
  }

  logger.info(`[SPEED] Monitoring ${bracketCount} active crypto brackets across ${activeBrackets.size} assets`);
}

/**
 * Refresh Kalshi prices for all active brackets.
 * Polls the DB for updated contract prices (market-sync updates these every 5 min).
 */
async function refreshKalshiPrices(): Promise<void> {
  const allBrackets = Array.from(activeBrackets.values()).flat();
  if (allBrackets.length === 0) return;

  const marketIds = allBrackets.map(b => b.marketId);
  const contracts = await prisma.contract.findMany({
    where: {
      marketId: { in: marketIds },
      outcome: 'YES',
    },
    select: {
      marketId: true,
      platformContractId: true,
      lastPrice: true,
      bestBid: true,
      bestAsk: true,
    },
  });

  const priceMap = new Map<string, number>();
  for (const c of contracts) {
    const price = c.lastPrice
      ?? (c.bestBid && c.bestAsk ? (c.bestBid + c.bestAsk) / 2 : null)
      ?? c.bestAsk ?? c.bestBid ?? null;
    if (price && c.platformContractId) {
      priceMap.set(c.platformContractId, price);
    }
  }

  for (const brackets of activeBrackets.values()) {
    for (const bracket of brackets) {
      const updated = priceMap.get(bracket.contractId);
      if (updated) {
        bracket.kalshiPrice = updated;
        bracket.kalshiPriceUpdatedAt = Date.now();
      }
    }
  }
}

/**
 * Handle a price tick from Binance.US WebSocket.
 * This is the hot path — called on EVERY trade (~100-1000/sec for BTC).
 */
function onPriceTick(symbol: string, price: number, _timestamp: number): void {
  tickCount++;
  const brackets = activeBrackets.get(symbol);
  if (!brackets || brackets.length === 0) return;

  // VOL-REGIME: use cached Deribit-powered estimate (refreshed every 30s)
  const volEstimate = cachedVol[symbol];
  const annualizedVol = volEstimate?.vol ?? DEFAULT_ANNUALIZED_VOL;

  const now = Date.now();

  for (const bracket of brackets) {
    // Skip expired or about-to-expire markets
    const secsToExpiry = (bracket.closesAt.getTime() - now) / 1000;
    if (secsToExpiry < MIN_TIME_TO_EXPIRY_SEC) continue;

    const hoursToExpiry = secsToExpiry / 3600;

    // Price filter: skip extreme brackets where fee economics are prohibitive
    if (bracket.kalshiPrice < 0.05 || bracket.kalshiPrice > 0.95) continue;

    // Calculate fair probability from spot price + realized volatility
    let fairProb: number;
    if (bracket.contractType === 'BRACKET') {
      fairProb = calculateBracketImpliedProb(
        price, bracket.lower, bracket.bracketWidth, hoursToExpiry, annualizedVol,
      );
    } else {
      fairProb = calculateSpotImpliedProb(price, bracket.lower, hoursToExpiry, annualizedVol);
    }

    const edge = fairProb - bracket.kalshiPrice;
    const absEdge = Math.abs(edge);

    // Fee-adjusted edge check
    const fee = 0.07 * bracket.kalshiPrice * (1 - bracket.kalshiPrice);
    if (absEdge < fee + EDGE_THRESHOLD_AFTER_FEES) {
      // Edge not large enough — clear any pending edge for this contract
      pendingEdges.delete(bracket.contractId);
      continue;
    }

    // Edge detected!
    const existing = pendingEdges.get(bracket.contractId);
    if (existing) {
      // Edge persisting — update
      existing.fairProb = fairProb;
      existing.edge = edge;
      existing.lastConfirmedAt = now;

      // Check if edge has persisted long enough
      if (now - existing.firstDetectedAt >= MIN_EDGE_PERSIST_MS) {
        evaluateAndTrade(existing);
      }
    } else {
      // New edge — start tracking
      edgesDetected++;
      const contractDesc = bracket.contractType === 'BRACKET'
        ? `${bracket.asset} $${bracket.lower.toLocaleString()}-$${bracket.upper.toLocaleString()}`
        : `${bracket.asset} above $${bracket.lower.toLocaleString()}`;
      logger.info({
        contract: contractDesc,
        fairProb: fairProb.toFixed(4),
        kalshiPrice: bracket.kalshiPrice.toFixed(4),
        edge: (edge * 100).toFixed(1) + '%',
        hoursToExpiry: hoursToExpiry.toFixed(2),
        vol: (annualizedVol * 100).toFixed(1) + '%',
      }, `[SPEED] EDGE DETECTED: ${contractDesc}, fair=${fairProb.toFixed(2)}, kalshi=${bracket.kalshiPrice.toFixed(2)}, edge=${(edge * 100).toFixed(1)}%`);

      pendingEdges.set(bracket.contractId, {
        bracket,
        fairProb,
        edge,
        firstDetectedAt: now,
        lastConfirmedAt: now,
      });
    }
  }
}

/**
 * FAST PATH: Evaluate a persisted SPEEDEX edge through the full CORTEX → TradingService path.
 *
 * 1. Build SPEEDEX signal + merge recent DB signals (COGEX, FLOWEX)
 * 2. CORTEX synthesis (same fusion as research pipeline)
 * 3. TradingService.executeEdge() with all 10 preflight gates
 * 4. Paper trade creation if everything passes
 *
 * Only triggers when edge >= FAST_PATH_MIN_EDGE (10%).
 * Below that, the signal waits for the 15-min research pipeline.
 */
async function evaluateAndTrade(pending: PendingEdge): Promise<void> {
  const { bracket, fairProb, edge } = pending;
  const now = Date.now();

  // Cooldown: max 1 trade per market per 15 minutes
  const lastTrade = lastTradeTime.get(bracket.contractId);
  if (lastTrade && now - lastTrade < TRADE_COOLDOWN_MS) {
    pendingEdges.delete(bracket.contractId);
    return;
  }

  const absEdge = Math.abs(edge);
  const persistedSec = ((now - pending.firstDetectedAt) / 1000).toFixed(0);

  // Fast path threshold: only run full CORTEX path for significant edges
  if (absEdge < FAST_PATH_MIN_EDGE) {
    pendingEdges.delete(bracket.contractId);
    return;
  }

  // Check if we already have a position on this market
  const existingPosition = await prisma.paperPosition.findFirst({
    where: { marketId: bracket.marketId, isOpen: true },
    select: { id: true },
  }).catch(() => null);

  if (existingPosition) {
    pendingEdges.delete(bracket.contractId);
    return;
  }

  fastPathAttempts++;
  const fastStart = Date.now();
  const contractDesc = bracket.contractType === 'BRACKET'
    ? `${bracket.asset} $${bracket.lower.toLocaleString()}-$${bracket.upper.toLocaleString()}`
    : `${bracket.asset} above $${bracket.lower.toLocaleString()}`;

  logger.info({
    contract: contractDesc,
    edge: (absEdge * 100).toFixed(1) + '%',
    fairProb: fairProb.toFixed(4),
    kalshiPrice: bracket.kalshiPrice.toFixed(4),
    persistedSec,
  }, `[SPEED_FAST] Edge persisted ${persistedSec}s, running CORTEX fast path...`);

  try {
    // ── Step 1: Build SPEEDEX signal ──
    const speedexSignal: SignalOutput = {
      moduleId: 'SPEEDEX',
      marketId: bracket.marketId,
      probability: fairProb,
      confidence: clampProbability(Math.min(0.70, absEdge * 3)),
      reasoning: `Black-Scholes fair value: ${(fairProb * 100).toFixed(1)}% (spot=$${bracket.contractType === 'BRACKET' ? `${bracket.lower}-${bracket.upper}` : bracket.lower}, edge=${(absEdge * 100).toFixed(1)}%)`,
      metadata: {
        spotPrice: binanceWs.getLatestPrice?.(bracket.asset) ?? null,
        strike: bracket.lower,
        bracketWidth: bracket.bracketWidth,
        contractType: bracket.contractType,
        hoursToExpiry: (bracket.closesAt.getTime() - now) / 3600000,
        fastPath: true,
      },
      timestamp: new Date(),
      expiresAt: new Date(now + 5 * 60 * 1000),
    };

    // Persist the SPEEDEX signal
    await prisma.signal.create({
      data: {
        moduleId: speedexSignal.moduleId,
        marketId: speedexSignal.marketId,
        probability: speedexSignal.probability,
        confidence: speedexSignal.confidence,
        reasoning: speedexSignal.reasoning,
        metadata: JSON.parse(JSON.stringify(speedexSignal.metadata)) as Prisma.InputJsonValue,
        expiresAt: speedexSignal.expiresAt,
      },
    }).catch(() => {}); // Non-blocking

    // ── Step 2: Merge with recent DB signals (COGEX, FLOWEX from speed pipeline) ──
    const recentSignals = await prisma.signal.findMany({
      where: {
        marketId: bracket.marketId,
        expiresAt: { gt: new Date() },
        moduleId: { notIn: ['SPEEDEX'] }, // Don't include stale SPEEDEX — we have the fresh one
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['moduleId'],
    });

    const mergedSignals: SignalOutput[] = [speedexSignal];
    for (const dbSig of recentSignals) {
      mergedSignals.push({
        moduleId: dbSig.moduleId,
        marketId: dbSig.marketId,
        probability: dbSig.probability,
        confidence: dbSig.confidence,
        reasoning: dbSig.reasoning ?? '',
        metadata: (dbSig.metadata as Record<string, unknown>) ?? {},
        timestamp: dbSig.createdAt,
        expiresAt: dbSig.expiresAt ?? new Date(now + 3600000),
      });
    }

    // ── Step 3: CORTEX synthesis ──
    const cortexInput: CortexInput = {
      marketId: bracket.marketId,
      marketPrice: bracket.kalshiPrice,
      marketCategory: 'CRYPTO',
      signals: mergedSignals,
      closesAt: bracket.closesAt,
    };

    const cortexEdge = synthesize(cortexInput);

    // Persist the edge
    await persistEdge(cortexEdge).catch(() => {});
    await persistTrainingSnapshot(cortexEdge, mergedSignals).catch(() => {});

    if (!cortexEdge.isActionable) {
      logger.info({
        contract: contractDesc,
        edgeMag: (cortexEdge.edgeMagnitude * 100).toFixed(1) + '%',
        ev: (cortexEdge.expectedValue * 100).toFixed(2) + '%',
        confidence: (cortexEdge.confidence * 100).toFixed(0) + '%',
        modules: mergedSignals.length,
        latencyMs: Date.now() - fastStart,
      }, `[SPEED_FAST] Not actionable after CORTEX synthesis`);
      pendingEdges.delete(bracket.contractId);
      return;
    }

    // ── Step 4: TradingService with full preflight ──
    const tradeResult = await getTradingService().executeEdge(cortexEdge);

    const latencyMs = Date.now() - fastStart;

    if (tradeResult.executed) {
      tradesCreated++;
      fastPathTrades++;
      lastTradeTime.set(bracket.contractId, now);

      logger.info({
        contract: contractDesc,
        direction: cortexEdge.edgeDirection,
        edge: (cortexEdge.edgeMagnitude * 100).toFixed(1) + '%',
        ev: (cortexEdge.expectedValue * 100).toFixed(2) + '%',
        confidence: (cortexEdge.confidence * 100).toFixed(0) + '%',
        modules: mergedSignals.map(s => s.moduleId).join('+'),
        latencyMs,
        paperId: tradeResult.paperId,
      }, `[SPEED_FAST] Trade created: ${cortexEdge.edgeDirection} ${contractDesc} (${latencyMs}ms)`);
    } else {
      logger.info({
        contract: contractDesc,
        reason: tradeResult.reason,
        latencyMs,
      }, `[SPEED_FAST] Trade rejected by preflight: ${tradeResult.reason}`);
    }
  } catch (err: any) {
    logger.error({ err: err.message, contractId: bracket.contractId }, '[SPEED_FAST] Fast path failed');
  }

  pendingEdges.delete(bracket.contractId);
}

/**
 * Prune expired brackets and stale pending edges.
 */
function pruneExpired(): void {
  const now = Date.now();

  // Remove expired brackets
  for (const [symbol, brackets] of activeBrackets) {
    const active = brackets.filter(b => b.closesAt.getTime() > now);
    if (active.length !== brackets.length) {
      activeBrackets.set(symbol, active);
    }
    if (active.length === 0) activeBrackets.delete(symbol);
  }

  // Remove stale pending edges (edge disappeared for > 30 seconds)
  for (const [contractId, pending] of pendingEdges) {
    if (now - pending.lastConfirmedAt > 30_000) {
      pendingEdges.delete(contractId);
    }
  }
}

/**
 * Log periodic status.
 */
function logStatus(): void {
  const bracketCount = Array.from(activeBrackets.values()).reduce((s, b) => s + b.length, 0);
  logger.info({
    brackets: bracketCount,
    assets: activeBrackets.size,
    pendingEdges: pendingEdges.size,
    ticks: tickCount,
    edgesDetected,
    tradesCreated,
    fastPathAttempts,
    fastPathTrades,
    wsHealthy: binanceWs.isHealthy(),
    wsStatus: binanceWs.getStatus(),
  }, `[SPEED] Status: ${bracketCount} brackets, ${pendingEdges.size} pending, ${tickCount} ticks, ${fastPathTrades}/${fastPathAttempts} fast trades`);
  tickCount = 0; // Reset tick counter each status log
}

// ── Main ──
async function main() {
  logger.info('[SPEED] Starting APEX SPEED streaming worker...');

  // Verify DB connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('[SPEED] Postgres connection verified');
  } catch (err: any) {
    logger.error({ err: err.message }, '[SPEED] Postgres connection failed');
    process.exit(1);
  }

  // Load active bracket markets
  await loadActiveBrackets();

  // Start Coinbase WebSocket
  binanceWs.start();
  logger.info('[SPEED] Coinbase WebSocket starting...');

  // Register event-driven price handler
  binanceWs.on('price', onPriceTick);

  binanceWs.on('connected', () => {
    logger.info('[SPEED] Connected to Coinbase WebSocket, tracking BTC ETH SOL');
  });

  binanceWs.on('disconnected', () => {
    logger.warn('[SPEED] Coinbase WebSocket disconnected — will use REST fallback');
  });

  // Refresh market list from DB every 5 minutes
  setInterval(async () => {
    try {
      await loadActiveBrackets();
    } catch (err: any) {
      logger.error({ err: err.message }, '[SPEED] Market refresh failed');
    }
  }, MARKET_REFRESH_INTERVAL_MS);

  // Refresh Kalshi prices every 45 seconds
  setInterval(async () => {
    try {
      await refreshKalshiPrices();
    } catch (err: any) {
      logger.error({ err: err.message }, '[SPEED] Kalshi price refresh failed');
    }
  }, KALSHI_PRICE_REFRESH_MS);

  // VOL-REGIME: refresh volatility estimates every 30 seconds
  const refreshVolEstimates = async () => {
    for (const asset of ['BTC', 'ETH', 'SOL'] as const) {
      try {
        cachedVol[asset] = await estimateVolatility(asset);
      } catch { /* silent — uses default */ }
    }
    const btc = cachedVol['BTC'];
    const eth = cachedVol['ETH'];
    if (btc || eth) {
      logger.debug({
        btc: btc ? `${(btc.vol * 100).toFixed(1)}% (${btc.source}, ${btc.regime})` : 'N/A',
        eth: eth ? `${(eth.vol * 100).toFixed(1)}% (${eth.source}, ${eth.regime})` : 'N/A',
      }, '[VOL-REGIME] Vol estimates refreshed');
    }
  };
  await refreshVolEstimates(); // Initial fetch
  setInterval(refreshVolEstimates, 30_000);

  // REST polling fallback: when WebSocket is down, poll Coinbase REST API
  // every 5 seconds to feed the same onPriceTick handler
  const REST_POLL_INTERVAL_MS = 5_000;
  const COINBASE_REST = 'https://api.exchange.coinbase.com/products';
  const REST_PRODUCTS: Record<string, string> = {
    'BTC-USD': 'BTC', 'ETH-USD': 'ETH', 'SOL-USD': 'SOL',
  };

  setInterval(async () => {
    if (binanceWs.isHealthy()) return;

    const now = Date.now();
    for (const [productId, symbol] of Object.entries(REST_PRODUCTS)) {
      try {
        const res = await fetch(`${COINBASE_REST}/${productId}/ticker`);
        if (!res.ok) continue;
        const data = await res.json();
        const price = parseFloat(data.price);
        if (price > 0) onPriceTick(symbol, price, now);
      } catch { /* silent */ }
    }
  }, REST_POLL_INTERVAL_MS);
  logger.info('[SPEED] Coinbase REST polling fallback enabled (5s interval when WS is down)');

  // Prune expired brackets every 60 seconds
  setInterval(pruneExpired, 60_000);

  // Log status every 60 seconds
  setInterval(logStatus, 60_000);

  // Send startup Telegram alert
  await sendTelegramAlert('⚡ APEX SPEED streaming worker started. Real-time crypto edge detection active.');

  logger.info('[SPEED] APEX SPEED worker running — event-driven, never exits');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`[SPEED] Received ${signal}, shutting down...`);
    await sendTelegramAlert(`🛑 SPEED worker shutting down (${signal})`);
    binanceWs.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err.message }, '[SPEED] Worker failed to start');
  sendTelegramAlert(`🚨 SPEED worker failed to start: ${err.message}`).then(() => process.exit(1));
});
