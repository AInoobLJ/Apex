import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { getCryptoPrices, parseKalshiCryptoTicker, calculateSpotImpliedProb } from '../services/crypto-price';
import { calculateKalshiFee } from '../services/fee-calculator';

// Moneyness thresholds
const ATM_THRESHOLD = 0.03;  // Within 3% of spot = at the money
const MIN_VOLUME = 500;      // Minimum $500 volume to be tradeable
const MIN_EDGE_AFTER_FEES = 0.05; // 5% edge after vol-adjusted implied prob to be actionable
const MIN_MINUTES_REMAINING = 5;  // Filter out contracts expiring in < 5 minutes

type Moneyness = 'ITM' | 'ATM' | 'OTM';

function classifyMoneyness(spotPrice: number, strike: number): Moneyness {
  const distance = Math.abs(spotPrice - strike) / spotPrice;
  if (distance <= ATM_THRESHOLD) return 'ATM';
  return spotPrice > strike ? 'ITM' : 'OTM';
}

export default async function cryptoRoutes(fastify: FastifyInstance) {
  // GET /crypto/dashboard — all crypto market data with spot comparison
  fastify.get('/crypto/dashboard', async () => {
    const prices = await getCryptoPrices();

    const cryptoMarkets = await prisma.market.findMany({
      where: {
        platform: 'KALSHI',
        status: 'ACTIVE',
        platformMarketId: { startsWith: 'KX' },
      },
      include: {
        contracts: { where: { outcome: 'YES' }, take: 1 },
        signals: {
          where: { moduleId: { in: ['SPEEDEX', 'ARBEX', 'CRYPTEX'] } },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { closesAt: 'asc' },
    });

    const polymarketCrypto = await prisma.market.findMany({
      where: {
        platform: 'POLYMARKET',
        status: 'ACTIVE',
        category: 'CRYPTO',
        closesAt: { lte: new Date(Date.now() + 2 * 86400000) },
      },
      include: {
        contracts: { where: { outcome: 'YES' }, take: 1 },
      },
      orderBy: { closesAt: 'asc' },
      take: 50,
    });

    const enrichedMarkets = cryptoMarkets.map(m => {
      const parsed = parseKalshiCryptoTicker(m.platformMarketId);
      const yesContract = m.contracts[0];
      const marketPrice = yesContract?.lastPrice ?? 0;

      let spotPrice: number | null = null;
      let impliedProb: number | null = null;
      let rawEdge: number | null = null;
      let edgeAfterFees: number | null = null;
      let moneyness: Moneyness | null = null;
      let distanceFromStrike: number | null = null;

      if (parsed && prices[parsed.asset]) {
        spotPrice = prices[parsed.asset].price;
        distanceFromStrike = (spotPrice - parsed.strike) / spotPrice;
        moneyness = classifyMoneyness(spotPrice, parsed.strike);

        const hoursToRes = m.closesAt
          ? Math.max(0, (m.closesAt.getTime() - Date.now()) / 3600000)
          : 24;
        impliedProb = calculateSpotImpliedProb(spotPrice, parsed.strike, hoursToRes);

        if (marketPrice > 0) {
          rawEdge = Math.abs(impliedProb - marketPrice);

          // Calculate fee for round-trip (buy + sell or buy + resolution)
          const fee = calculateKalshiFee(marketPrice, 10);
          const feePerContract = fee / 10;
          edgeAfterFees = Math.max(0, rawEdge - feePerContract);
        }
      }

      const speedexSignal = m.signals.find(s => s.moduleId === 'SPEEDEX');
      const arbexSignal = m.signals.find(s => s.moduleId === 'ARBEX');
      const cryptexSignal = m.signals.find(s => s.moduleId === 'CRYPTEX');

      return {
        id: m.id,
        ticker: m.platformMarketId,
        title: m.title,
        platform: m.platform,
        closesAt: m.closesAt,
        hoursRemaining: m.closesAt ? Math.max(0, (m.closesAt.getTime() - Date.now()) / 3600000) : null,
        marketPrice,
        asset: parsed?.asset ?? null,
        strike: parsed?.strike ?? null,
        spotPrice,
        impliedProb,
        rawEdge,
        edgeAfterFees,
        moneyness,
        distanceFromStrike,
        speedexSignal: speedexSignal ? {
          probability: speedexSignal.probability,
          confidence: speedexSignal.confidence,
          reasoning: speedexSignal.reasoning,
        } : null,
        arbexSignal: arbexSignal ? {
          probability: arbexSignal.probability,
          confidence: arbexSignal.confidence,
          reasoning: arbexSignal.reasoning,
        } : null,
        cryptexSignal: cryptexSignal ? {
          probability: cryptexSignal.probability,
          confidence: cryptexSignal.confidence,
          reasoning: cryptexSignal.reasoning,
        } : null,
        volume: m.volume,
        tradeable: moneyness === 'ATM' && (m.volume ?? 0) >= MIN_VOLUME && (edgeAfterFees ?? 0) >= MIN_EDGE_AFTER_FEES,
      };
    })
    // Filter out contracts expiring in < 5 minutes — untradeable
    .filter(m => {
      if (m.hoursRemaining === null) return true;
      return m.hoursRemaining * 60 >= MIN_MINUTES_REMAINING;
    });

    // Sort: ATM first, then by MOST time remaining (freshest opportunities),
    // then by edge size. Best trades = 30-50 min remaining with clear edge.
    enrichedMarkets.sort((a, b) => {
      // ATM contracts first
      const aAtm = a.moneyness === 'ATM' ? 0 : 1;
      const bAtm = b.moneyness === 'ATM' ? 0 : 1;
      if (aAtm !== bAtm) return aAtm - bAtm;

      // Then by most time remaining first (freshest opportunities)
      const aHours = a.hoursRemaining ?? 999;
      const bHours = b.hoursRemaining ?? 999;
      if (Math.abs(aHours - bHours) > 0.1) return bHours - aHours;

      // Then by edge after fees (largest first)
      return (b.edgeAfterFees ?? 0) - (a.edgeAfterFees ?? 0);
    });

    // Stats — only count ATM contracts with real edge (5%+ after fees)
    const atmContracts = enrichedMarkets.filter(m => m.moneyness === 'ATM');
    const tradeableContracts = enrichedMarkets.filter(m => m.tradeable);

    return {
      spotPrices: prices,
      kalshiCrypto: enrichedMarkets,
      polymarketCrypto: polymarketCrypto.map(m => ({
        id: m.id,
        title: m.title,
        closesAt: m.closesAt,
        marketPrice: m.contracts[0]?.lastPrice ?? 0,
        volume: m.volume,
      })),
      stats: {
        totalKalshiCrypto: enrichedMarkets.length,
        atmContracts: atmContracts.length,
        withTradeableEdge: tradeableContracts.length,
        avgEdgeATM: atmContracts.length > 0
          ? atmContracts.reduce((s, m) => s + (m.edgeAfterFees ?? 0), 0) / atmContracts.length
          : 0,
      },
    };
  });

  // GET /crypto/prices — just spot prices
  fastify.get('/crypto/prices', async () => {
    return getCryptoPrices();
  });
}
