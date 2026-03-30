import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma';

interface ListEdgesQuery {
  minExpectedValue?: string;
  minConfidence?: string;
  category?: string;
  platform?: string;
  sort?: string;
  direction?: string;
  limit?: string;
  page?: string;
  actionableOnly?: string;
}

export default async function edgeRoutes(fastify: FastifyInstance) {
  fastify.get('/edges', async (request: FastifyRequest<{ Querystring: ListEdgesQuery }>) => {
    const {
      minExpectedValue = '0',
      minConfidence,
      category,
      platform,
      sort = 'edgeMagnitude',
      direction = 'desc',
      limit = '50',
      page = '1',
      actionableOnly = 'false',
    } = request.query;

    const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
    const pageNum = Math.max(1, parseInt(page));
    const minEV = parseFloat(minExpectedValue);
    const onlyActionable = actionableOnly === 'true';

    // Build where clause
    const whereConditions: string[] = [];
    if (minEV > 0) whereConditions.push(`"expectedValue" >= ${minEV}`);
    if (onlyActionable) whereConditions.push(`"isActionable" = true`);
    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Get the latest edge per market (all of them — we paginate after filtering)
    const latestEdges = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT DISTINCT ON ("marketId") id
       FROM "Edge"
       ${whereClause}
       ORDER BY "marketId", "createdAt" DESC`
    );

    const edgeIds = latestEdges.map(e => e.id);

    if (edgeIds.length === 0) {
      return { data: [], total: 0, page: pageNum, pageSize };
    }

    // Fetch all matching edges (we need the full set for category/platform filtering and total count)
    const edges = await prisma.edge.findMany({
      where: {
        id: { in: edgeIds },
        ...(minConfidence ? { confidence: { gte: parseFloat(minConfidence) } } : {}),
      },
      include: {
        market: {
          select: { title: true, platform: true, category: true, status: true, closesAt: true },
        },
      },
      orderBy: {
        [['expectedValue', 'edgeMagnitude', 'confidence', 'createdAt'].includes(sort) ? sort : 'edgeMagnitude']:
          direction === 'asc' ? 'asc' : 'desc',
      },
    });

    // Filter out expired markets (closesAt in the past) and apply category/platform filters
    const now = new Date();
    let filtered = edges.filter(e => !e.market.closesAt || e.market.closesAt > now);
    if (category) filtered = filtered.filter(e => e.market.category === category);
    if (platform) filtered = filtered.filter(e => e.market.platform === platform);

    // Compute TTR and capital efficiency
    const mapped = filtered.map(e => {
      const daysToResolution = e.market.closesAt
        ? Math.max(1, Math.ceil((e.market.closesAt.getTime() - Date.now()) / 86400000))
        : 365;
      const capitalEfficiency = e.edgeMagnitude / Math.sqrt(daysToResolution);

      return {
        marketId: e.marketId,
        marketTitle: e.market.title,
        platform: e.market.platform,
        category: e.market.category,
        cortexProbability: e.cortexProbability,
        marketPrice: e.marketPrice,
        edgeMagnitude: e.edgeMagnitude,
        edgeDirection: e.edgeDirection,
        confidence: e.confidence,
        expectedValue: e.expectedValue,
        signals: e.signals,
        kellySize: e.kellySize,
        isActionable: e.isActionable,
        conflictFlag: e.conflictFlag,
        timestamp: e.createdAt,
        daysToResolution,
        capitalEfficiency,
      };
    });

    // Sort by capitalEfficiency if requested (computed field, not in DB)
    if (sort === 'capitalEfficiency') {
      mapped.sort((a, b) => direction === 'asc'
        ? a.capitalEfficiency - b.capitalEfficiency
        : b.capitalEfficiency - a.capitalEfficiency);
    }

    // Paginate
    const total = mapped.length;
    const offset = (pageNum - 1) * pageSize;
    const paginated = mapped.slice(offset, offset + pageSize);

    return { data: paginated, total, page: pageNum, pageSize };
  });
}
