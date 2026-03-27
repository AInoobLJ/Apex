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

  return syncResults;
}
