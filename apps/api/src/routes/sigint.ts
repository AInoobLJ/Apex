import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export default async function sigintRoutes(fastify: FastifyInstance) {
  // GET /sigint/wallets — wallet leaderboard
  fastify.get('/sigint/wallets', async (request) => {
    const { classification, limit = '50' } = request.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (classification) where.classification = classification;

    const wallets = await prisma.wallet.findMany({
      where,
      orderBy: { totalVolume: 'desc' },
      take: parseInt(limit),
      select: {
        id: true, address: true, classification: true, roi: true, winRate: true,
        avgPositionSize: true, marketCount: true, totalVolume: true, lastActiveAt: true,
      },
    });

    return { data: wallets };
  });

  // GET /sigint/wallets/:address
  fastify.get('/sigint/wallets/:address', async (request) => {
    const { address } = request.params as { address: string };
    const wallet = await prisma.wallet.findUnique({
      where: { address },
      include: { positions: { take: 50, orderBy: { updatedAt: 'desc' } } },
    });
    return wallet ?? { error: 'Wallet not found' };
  });

  // GET /sigint/moves — recent smart money moves
  fastify.get('/sigint/moves', async () => {
    const recentPositions = await prisma.walletPosition.findMany({
      where: { wallet: { classification: { in: ['SMART_MONEY', 'WHALE'] } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { wallet: { select: { address: true, classification: true, roi: true } } },
    });
    return { data: recentPositions };
  });
}
