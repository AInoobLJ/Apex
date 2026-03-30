import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { kalshiClient } from './kalshi-client';
import { polymarketClient } from './polymarket-client';
import type { PredictionMarketAdapter, NormalizedMarket } from '@apex/shared';
import { reclassifyMarket } from './category-classifier';
import { matchNewMarket } from './market-matcher';

// Re-export for backward compatibility
export { detectCategory } from './category-detector';

// ── Registered adapters ──

const adapters: PredictionMarketAdapter[] = [kalshiClient, polymarketClient];

// Max markets to sync per platform per run (prevents 30-min sync jobs)
const MAX_MARKETS_PER_SYNC = 2000;

// ── Generic adapter sync ──

async function syncAdapter(adapter: PredictionMarketAdapter): Promise<number> {
  const platformName = adapter.platform;
  logger.info(`Syncing ${platformName} markets via adapter...`);

  const rawMarkets = await adapter.getMarkets();
  const toSync = rawMarkets.slice(0, MAX_MARKETS_PER_SYNC);
  let synced = 0;
  let errors = 0;

  // Process sequentially with event loop yielding every 20 markets
  // This ensures HTTP requests can be served during sync
  for (let i = 0; i < toSync.length; i++) {
    try {
      const normalized = adapter.normalizeMarket(toSync[i]);
      await upsertNormalizedMarket(normalized);
      synced++;
    } catch (err) {
      errors++;
      if (errors <= 3) logger.debug({ err: (err as Error).message, marketIndex: i, platform: platformName }, 'Market sync upsert failed');
    }
    // Yield event loop every 20 markets so API can respond
    if (i % 20 === 0) await new Promise(r => setImmediate(r));
  }

  if (errors > 0) {
    logger.warn({ synced, errors, total: toSync.length }, `${platformName} sync had ${errors} errors`);
  }
  logger.info({ synced, total: rawMarkets.length, capped: rawMarkets.length > MAX_MARKETS_PER_SYNC }, `Synced ${synced} ${platformName} markets`);
  return synced;
}

async function upsertNormalizedMarket(m: NormalizedMarket): Promise<void> {
  // Reclassify OTHER markets using keyword patterns
  const category = reclassifyMarket(m.title, m.category);

  // Check if market already exists (to detect new markets for cross-platform matching)
  const existingMarket = await prisma.market.findUnique({
    where: { platform_platformMarketId: { platform: m.platform, platformMarketId: m.platformMarketId } },
    select: { id: true },
  });
  const isNewMarket = !existingMarket;

  const market = await prisma.market.upsert({
    where: {
      platform_platformMarketId: {
        platform: m.platform,
        platformMarketId: m.platformMarketId,
      },
    },
    create: {
      platform: m.platform,
      platformMarketId: m.platformMarketId,
      title: m.title,
      description: m.description,
      category,
      rawPlatformCategory: m.rawPlatformCategory ?? null,
      status: m.status,
      resolutionText: m.resolutionText,
      resolutionSource: m.resolutionSource,
      closesAt: m.closesAt,
      volume: m.volume,
      liquidity: m.liquidity,
      resolution: m.resolution,
    },
    update: {
      title: m.title,
      description: m.description,
      category,
      rawPlatformCategory: m.rawPlatformCategory ?? undefined,
      status: m.status,
      resolutionText: m.resolutionText,
      resolutionSource: m.resolutionSource,
      closesAt: m.closesAt,
      volume: m.volume,
      liquidity: m.liquidity,
      resolution: m.resolution,
    },
  });

  // Upsert contracts
  for (const c of m.contracts) {
    await prisma.contract.upsert({
      where: { marketId_outcome: { marketId: market.id, outcome: c.outcome } },
      create: {
        marketId: market.id,
        platformContractId: c.platformContractId,
        outcome: c.outcome,
        lastPrice: c.lastPrice,
        bestBid: c.bestBid,
        bestAsk: c.bestAsk,
        volume: c.volume,
      },
      update: {
        platformContractId: c.platformContractId,
        lastPrice: c.lastPrice,
        bestBid: c.bestBid,
        bestAsk: c.bestAsk,
      },
    });
  }

  // Create price snapshot from YES contract
  const yesContract = m.contracts.find(c => c.outcome === 'YES');
  if (yesContract?.lastPrice && yesContract.lastPrice > 0) {
    await prisma.priceSnapshot.create({
      data: { marketId: market.id, yesPrice: yesContract.lastPrice, volume: m.volume },
    });
  }

  // Cross-platform matching: when a new market appears, find matches on the other platform.
  // This runs ONCE per new market (not every sync cycle). Results stored permanently in MarketMatch table.
  if (isNewMarket && m.status === 'ACTIVE' && (m.volume ?? 0) >= 100) {
    matchNewMarket({ id: market.id, platform: m.platform, title: m.title })
      .catch(err => logger.debug({ err: (err as Error).message, marketId: market.id }, 'Market matching failed (non-critical)'));
  }
}

// ── Main Sync ──

export async function runMarketSync(): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    adapters.map(adapter => syncAdapter(adapter))
  );

  const syncResults: Record<string, number> = {};
  adapters.forEach((adapter, i) => {
    const result = results[i];
    syncResults[adapter.platform.toLowerCase()] =
      result.status === 'fulfilled' ? result.value : 0;
  });

  // Also sync Kalshi crypto series (KXBTC, KXETH) — not in general pagination
  try {
    const cryptoMarkets = await kalshiClient.fetchCryptoSeriesMarkets();
    let cryptoSynced = 0;
    for (const raw of cryptoMarkets) {
      try {
        const normalized = kalshiClient.normalizeMarket(kalshiClient.toRawMarket(raw));
        await upsertNormalizedMarket(normalized);
        cryptoSynced++;
      } catch (err) { logger.debug({ err: (err as Error).message }, 'Crypto market sync upsert failed'); }
    }
    syncResults['kalshi_crypto'] = cryptoSynced;
    logger.info({ cryptoSynced }, 'Kalshi crypto series synced');
  } catch (err) {
    logger.error(err, 'Kalshi crypto series sync failed');
    syncResults['kalshi_crypto'] = 0;
  }

  // ── Resolution sync: fetch settled markets and update their outcomes ──
  // This is the critical missing piece: the regular sync only fetches status='open',
  // so settled markets never get their resolution field updated.
  // Without this, the FeatureModel has no labeled training data.
  try {
    const resolutionResults = await syncResolutions();
    syncResults['resolutions_crypto'] = resolutionResults.crypto;
    syncResults['resolutions_general'] = resolutionResults.general;
    if (resolutionResults.crypto > 0 || resolutionResults.general > 0) {
      logger.info(resolutionResults, 'Resolution sync completed — settled markets updated');
    }
  } catch (err) {
    logger.error(err, 'Resolution sync failed');
    syncResults['resolutions_crypto'] = 0;
    syncResults['resolutions_general'] = 0;
  }

  // ── Targeted resolution sync: check specific markets we hold positions on ──
  // The broad sweep above has pagination limits and may miss markets.
  // This directly queries each expired position market by ticker.
  try {
    const targetedSynced = await syncPositionResolutions();
    syncResults['resolutions_targeted'] = targetedSynced;
    if (targetedSynced > 0) {
      logger.info({ targetedSynced }, 'Targeted position resolution sync completed');
    }
  } catch (err) {
    logger.error(err, 'Targeted resolution sync failed');
    syncResults['resolutions_targeted'] = 0;
  }

  return syncResults;
}

/**
 * Sync resolution outcomes for recently-settled markets.
 *
 * The regular market sync only fetches status='open' from Kalshi, so markets
 * that have settled never get their `resolution` field updated in the DB.
 * This breaks the entire learning pipeline:
 * - position-sync can't auto-close positions on resolution
 * - linkResolutionOutcomes can't label TrainingSnapshots
 * - FeatureModel can't train without labeled data
 * - Hit rate stays at 0 forever
 *
 * This function fetches recently-settled markets from Kalshi (both crypto and
 * general) and upserts them with their resolution outcomes. It only processes
 * markets that APEX already has in the DB (to avoid importing thousands of
 * irrelevant resolved markets).
 */
async function syncResolutions(): Promise<{ crypto: number; general: number }> {
  let cryptoSynced = 0;
  let generalSynced = 0;

  // ── Crypto resolutions ──
  try {
    const resolvedCrypto = await kalshiClient.fetchResolvedCryptoMarkets();
    for (const raw of resolvedCrypto) {
      try {
        // Only update markets we already have in the DB (we hold positions on these)
        const existing = await prisma.market.findUnique({
          where: { platform_platformMarketId: { platform: 'KALSHI', platformMarketId: raw.ticker } },
          select: { id: true, resolution: true },
        });

        // Skip if we don't have this market, or if it's already resolved
        if (!existing || existing.resolution != null) continue;

        const normalized = kalshiClient.normalizeMarket(kalshiClient.toRawMarket(raw));
        await upsertNormalizedMarket(normalized);
        cryptoSynced++;

        logger.info({
          ticker: raw.ticker,
          title: raw.title,
          result: raw.result,
          resolution: normalized.resolution,
        }, 'Crypto market resolution synced');
      } catch (err) {
        logger.debug({ err: (err as Error).message, ticker: raw.ticker }, 'Resolution upsert failed');
      }
    }
  } catch (err) {
    logger.error(err, 'Crypto resolution sync failed');
  }

  // ── General market resolutions ──
  try {
    const resolvedGeneral = await kalshiClient.fetchResolvedGeneralMarkets();
    for (const raw of resolvedGeneral) {
      try {
        const existing = await prisma.market.findUnique({
          where: { platform_platformMarketId: { platform: 'KALSHI', platformMarketId: raw.ticker } },
          select: { id: true, resolution: true },
        });

        if (!existing || existing.resolution != null) continue;

        const normalized = kalshiClient.normalizeMarket(kalshiClient.toRawMarket(raw));
        await upsertNormalizedMarket(normalized);
        generalSynced++;

        logger.info({
          ticker: raw.ticker,
          title: raw.title,
          result: raw.result,
          resolution: normalized.resolution,
        }, 'General market resolution synced');
      } catch (err) {
        logger.debug({ err: (err as Error).message, ticker: raw.ticker }, 'Resolution upsert failed');
      }
    }
  } catch (err) {
    logger.error(err, 'General resolution sync failed');
  }

  return { crypto: cryptoSynced, general: generalSynced };
}

/**
 * Targeted resolution sync: directly queries Kalshi for markets that APEX
 * holds paper positions on and whose closesAt has passed. This catches
 * markets that the broad sweep misses due to pagination limits.
 */
async function syncPositionResolutions(): Promise<number> {
  let synced = 0;

  // Find paper positions whose markets have closesAt in the past but no resolution
  const unresolvedPositionMarkets = await prisma.market.findMany({
    where: {
      paperPositions: { some: {} },  // has paper positions
      resolution: null,
      platform: 'KALSHI',
      closesAt: { lt: new Date() },  // already expired
    },
    select: { id: true, platformMarketId: true, title: true },
  });

  if (unresolvedPositionMarkets.length === 0) return 0;

  logger.info({ count: unresolvedPositionMarkets.length }, 'Targeted resolution sync: checking expired position markets');

  for (const market of unresolvedPositionMarkets) {
    try {
      const raw = await kalshiClient.fetchMarketByTicker(market.platformMarketId);
      if (!raw) continue;

      if (raw.result) {
        // Market has settled — update with resolution
        const normalized = kalshiClient.normalizeMarket(kalshiClient.toRawMarket(raw));
        await upsertNormalizedMarket(normalized);
        synced++;

        logger.info({
          ticker: market.platformMarketId,
          title: market.title.slice(0, 50),
          result: raw.result,
          resolution: normalized.resolution,
        }, 'Position market resolution synced (targeted)');
      } else if (raw.status === 'closed' || raw.status === 'settled') {
        // Closed but no result yet — update status at minimum
        await prisma.market.update({
          where: { id: market.id },
          data: { status: 'RESOLVED' },
        });
      }
    } catch (err) {
      logger.debug({ err: (err as Error).message, ticker: market.platformMarketId }, 'Targeted resolution fetch failed');
    }
  }

  if (synced > 0) {
    logger.info({ synced }, 'Targeted resolution sync complete');
  }

  return synced;
}

// Export for manual backfill trigger
export { syncResolutions, syncPositionResolutions };
