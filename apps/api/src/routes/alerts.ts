import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import type { AlertSeverity, AlertType } from '@apex/db';

export default async function alertRoutes(fastify: FastifyInstance) {
  // GET /alerts
  fastify.get('/alerts', async (request) => {
    const { acknowledged, severity, type, limit = '50' } = request.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (acknowledged !== undefined) where.acknowledged = acknowledged === 'true';
    if (severity) where.severity = severity as AlertSeverity;
    if (type) where.type = type as AlertType;

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      include: { market: { select: { title: true, platform: true } } },
    });

    return { data: alerts };
  });

  // PATCH /alerts/:id/acknowledge
  fastify.patch('/alerts/:id/acknowledge', async (request) => {
    const { id } = request.params as { id: string };
    return prisma.alert.update({
      where: { id },
      data: { acknowledged: true },
    });
  });

  // PATCH /alerts/:id/snooze
  fastify.patch('/alerts/:id/snooze', async (request) => {
    const { id } = request.params as { id: string };
    const { minutes = 60 } = request.body as { minutes?: number };
    return prisma.alert.update({
      where: { id },
      data: { snoozedUntil: new Date(Date.now() + minutes * 60 * 1000) },
    });
  });
}
