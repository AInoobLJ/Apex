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
      actionableOnly = 'false',
    } = request.query;

    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const minEV = parseFloat(minExpectedValue);
    const onlyActionable = actionableOnly === 'true';

    // Build where clause
    const whereConditions: string[] = [];
    if (minEV > 0) whereConditions.push(`"expectedValue" >= ${minEV}`);
    if (onlyActionable) whereConditions.push(`"isActionable" = true`);
    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Get the latest edge per market
    const latestEdges = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT DISTINCT ON ("marketId") id
       FROM "Edge"
       ${whereClause}
       ORDER BY "marketId", "createdAt" DESC`
    );

    const edgeIds = latestEdges.map(e => e.id);

    if (edgeIds.length === 0) {
      return { data: [] };
    }

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
      take: limitNum,
    });

    // Filter by category/platform if specified
    let filtered = edges;
    if (category) filtered = filtered.filter(e => e.market.category === category);
    if (platform) filtered = filtered.filter(e => e.market.platform === platform);

    // Compute TTR and capital efficiency, then optionally sort by capEff
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

    // Sort by capitalEfficiency if requested
    if (sort === 'capitalEfficiency') {
      mapped.sort((a, b) => direction === 'asc'
        ? a.capitalEfficiency - b.capitalEfficiency
        : b.capitalEfficiency - a.capitalEfficiency);
    }

    return { data: mapped };
  });
}
