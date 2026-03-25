import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { calculateKelly, getPortfolioSummary, checkConcentrationLimits } from '../services/portfolio-manager';
import type { Platform, EdgeDirection, MarketCategory } from '@apex/db';

const BANKROLL = parseFloat(process.env.BANKROLL || '10000');

export default async function portfolioRoutes(fastify: FastifyInstance) {
  // GET /portfolio/positions
  fastify.get('/portfolio/positions', async () => {
    const positions = await prisma.position.findMany({
      orderBy: { createdAt: 'desc' },
      include: { market: { select: { title: true, platform: true, category: true } } },
    });
    return { data: positions };
  });

  // GET /portfolio/summary
  fastify.get('/portfolio/summary', async () => {
    const summary = await getPortfolioSummary(BANKROLL);
    const paperPositions = await prisma.paperPosition.findMany({ where: { isOpen: true } });
    const paperPnl = paperPositions.reduce((sum, p) => sum + p.paperPnl, 0);

    return {
      ...summary,
      bankroll: BANKROLL,
      paper: { openPositions: paperPositions.length, pnl: paperPnl },
    };
  });

  // POST /portfolio/positions
  fastify.post('/portfolio/positions', async (request, reply) => {
    const body = request.body as {
      marketId: string;
      platform: string;
      direction: string;
      entryPrice: number;
      size: number;
      quantity: number;
    };

    // Check concentration limits
    const market = await prisma.market.findUnique({ where: { id: body.marketId } });
    if (!market) return reply.status(404).send({ error: 'Market not found' });

    const check = await checkConcentrationLimits(
      body.marketId,
      market.category as MarketCategory,
      body.platform as Platform,
      body.size,
      BANKROLL
    );
    if (!check.pass) {
      return reply.status(400).send({ error: 'Concentration limit exceeded', violations: check.violations });
    }

    const position = await prisma.position.create({
      data: {
        marketId: body.marketId,
        platform: body.platform as Platform,
        direction: body.direction as EdgeDirection,
        entryPrice: body.entryPrice,
        size: body.size,
        quantity: body.quantity,
      },
    });
    return position;
  });

  // PATCH /portfolio/positions/:id
  fastify.patch('/portfolio/positions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { currentPrice?: number; exitPrice?: number; isOpen?: boolean };

    const updates: Record<string, unknown> = {};
    if (body.currentPrice !== undefined) updates.currentPrice = body.currentPrice;
    if (body.exitPrice !== undefined) {
      updates.exitPrice = body.exitPrice;
      updates.isOpen = false;
      updates.closedAt = new Date();
    }
    if (body.isOpen !== undefined) updates.isOpen = body.isOpen;

    return prisma.position.update({ where: { id }, data: updates });
  });

  // GET /portfolio/history — portfolio value over time
  fastify.get('/portfolio/history', async (request) => {
    const { days = '30' } = request.query as { days?: string };
    const since = new Date(Date.now() - parseInt(days) * 86400000);

    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });

    return { data: snapshots };
  });

  // GET /portfolio/kelly — calculate Kelly sizing for an edge
  fastify.get('/portfolio/kelly', async (request) => {
    const { probability, price } = request.query as { probability: string; price: string };
    return calculateKelly({
      cortexProbability: parseFloat(probability),
      marketPrice: parseFloat(price),
      bankroll: BANKROLL,
    });
  });
}
