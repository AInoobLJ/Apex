import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { MarketCategory, Platform, MarketStatus } from '@apex/db';

interface ListMarketsQuery {
  status?: string;
  category?: string;
  platform?: string;
  search?: string;
  page?: string;
  limit?: string;
  sort?: string;
  direction?: string;
}

export default async function marketRoutes(fastify: FastifyInstance) {
  // GET /markets
  fastify.get('/markets', async (request: FastifyRequest<{ Querystring: ListMarketsQuery }>, reply: FastifyReply) => {
    const { status, category, platform, search, page = '1', limit = '50', sort = 'volume', direction = 'desc' } = request.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};
    if (status) where.status = status as MarketStatus;
    if (category) where.category = category as MarketCategory;
    if (platform) where.platform = platform as Platform;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const orderBy: Record<string, string> = {};
    const sortField = ['volume', 'liquidity', 'closesAt', 'createdAt'].includes(sort) ? sort : 'volume';
    orderBy[sortField] = direction === 'asc' ? 'asc' : 'desc';

    // Fast estimate for unfiltered count, exact for filtered
    const hasFilters = status || category || platform || search;
    const [markets, total] = await Promise.all([
      prisma.market.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include: {
          contracts: { where: { outcome: 'YES' }, take: 1, select: { lastPrice: true } },
        },
      }),
      hasFilters
        ? prisma.market.count({ where })
        : prisma.$queryRaw<[{ estimate: bigint }]>`SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'Market'`.then(r => Number(r[0]?.estimate ?? 0)),
    ]);

    // Batch-fetch latest edges for these markets
    const marketIds = markets.map(m => m.id);
    const edges = marketIds.length > 0
      ? await prisma.edge.findMany({
          where: { marketId: { in: marketIds }, isActionable: true },
          orderBy: { createdAt: 'desc' },
          distinct: ['marketId'],
          select: { marketId: true, edgeMagnitude: true, isActionable: true },
        })
      : [];
    const edgeMap = new Map(edges.map(e => [e.marketId, e]));

    const data = markets.map(m => {
      const yesContract = m.contracts[0];
      const edge = edgeMap.get(m.id);
      return {
        id: m.id,
        platform: m.platform,
        title: m.title,
        category: m.category,
        status: m.status,
        yesPrice: yesContract?.lastPrice ?? null,
        noPrice: yesContract?.lastPrice != null ? 1 - yesContract.lastPrice : null,
        volume: m.volume,
        liquidity: m.liquidity,
        closesAt: m.closesAt?.toISOString() ?? null,
        hasEdge: edge?.isActionable ?? false,
        edgeMagnitude: edge?.edgeMagnitude ?? null,
      };
    });

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  });

  // GET /markets/:id
  fastify.get('/markets/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const market = await prisma.market.findUnique({
      where: { id: request.params.id },
      include: {
        contracts: true,
        edges: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!market) {
      return reply.code(404).send({ error: 'Market not found' });
    }

    const latestEdge = market.edges[0];

    return {
      id: market.id,
      platform: market.platform,
      platformMarketId: market.platformMarketId,
      title: market.title,
      description: market.description,
      category: market.category,
      status: market.status,
      resolutionText: market.resolutionText,
      resolutionSource: market.resolutionSource,
      resolutionDate: market.resolutionDate?.toISOString() ?? null,
      resolution: market.resolution,
      volume: market.volume,
      liquidity: market.liquidity,
      closesAt: market.closesAt?.toISOString() ?? null,
      createdAt: market.createdAt.toISOString(),
      contracts: market.contracts.map(c => ({
        id: c.id,
        outcome: c.outcome,
        lastPrice: c.lastPrice,
        bestBid: c.bestBid,
        bestAsk: c.bestAsk,
        volume: c.volume,
      })),
      latestEdge: latestEdge ? {
        marketId: latestEdge.marketId,
        cortexProbability: latestEdge.cortexProbability,
        marketPrice: latestEdge.marketPrice,
        edgeMagnitude: latestEdge.edgeMagnitude,
        edgeDirection: latestEdge.edgeDirection,
        confidence: latestEdge.confidence,
        expectedValue: latestEdge.expectedValue,
        signals: latestEdge.signals,
        kellySize: latestEdge.kellySize,
        isActionable: latestEdge.isActionable,
        conflictFlag: latestEdge.conflictFlag,
        timestamp: latestEdge.createdAt,
      } : null,
    };
  });

  // GET /markets/:id/prices
  fastify.get('/markets/:id/prices', async (request: FastifyRequest<{ Params: { id: string }; Querystring: { from?: string; to?: string; interval?: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const { from, to } = request.query;

    const where: Record<string, unknown> = { marketId: id };
    if (from || to) {
      const timestampFilter: Record<string, Date> = {};
      if (from) timestampFilter.gte = new Date(from);
      if (to) timestampFilter.lte = new Date(to);
      where.timestamp = timestampFilter;
    }

    const snapshots = await prisma.priceSnapshot.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: 1000,
    });

    return {
      marketId: id,
      points: snapshots.map(s => ({
        timestamp: s.timestamp.toISOString(),
        yesPrice: s.yesPrice,
        volume: s.volume,
      })),
    };
  });

  // GET /markets/:id/orderbook
  fastify.get('/markets/:id/orderbook', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const contracts = await prisma.contract.findMany({
      where: { marketId: request.params.id },
      include: {
        orderBookSnapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });

    return {
      marketId: request.params.id,
      contracts: contracts.map(c => {
        const snap = c.orderBookSnapshots[0];
        return {
          outcome: c.outcome,
          bids: snap?.bids ?? [],
          asks: snap?.asks ?? [],
          spread: snap?.spread ?? 0,
          midPrice: snap?.midPrice ?? 0,
          totalBidDepth: snap?.totalBidDepth ?? 0,
          totalAskDepth: snap?.totalAskDepth ?? 0,
          timestamp: snap?.timestamp.toISOString() ?? null,
        };
      }),
    };
  });
}
