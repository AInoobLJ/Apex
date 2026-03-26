/**
 * Opportunity State Machine — manages lifecycle transitions with audit logging.
 * Every state change is logged to OpportunityTransition for full traceability.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { OpportunityStatus } from '@prisma/client';

// Valid transitions: [fromStatus] → [toStatus[]]
const VALID_TRANSITIONS: Record<string, string[]> = {
  DISCOVERED:     ['RESEARCHED', 'CLOSED'],
  RESEARCHED:     ['RANKED', 'CLOSED'],
  RANKED:         ['APPROVED', 'CLOSED'],
  APPROVED:       ['PAPER_TRACKING', 'ORDERED', 'CLOSED'],
  PAPER_TRACKING: ['ORDERED', 'MONITORING', 'CLOSED', 'RESOLVED'],
  ORDERED:        ['FILLED', 'CLOSED'],         // CLOSED = order failed/cancelled
  FILLED:         ['MONITORING'],
  MONITORING:     ['CLOSED', 'RESOLVED'],
  CLOSED:         ['RESOLVED'],                  // edge case: market resolves after we close
  RESOLVED:       [],                            // terminal state
};

export async function transitionOpportunity(
  opportunityId: string,
  toStatus: OpportunityStatus,
  reason: string,
  updates: Record<string, unknown> = {}
): Promise<void> {
  const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  const fromStatus = opp.status;

  if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    throw new Error(`Invalid transition: ${fromStatus} → ${toStatus} for opportunity ${opportunityId}`);
  }

  await prisma.$transaction([
    prisma.opportunity.update({
      where: { id: opportunityId },
      data: { status: toStatus, ...updates },
    }),
    prisma.opportunityTransition.create({
      data: {
        opportunityId,
        fromStatus,
        toStatus,
        reason,
      },
    }),
  ]);

  logger.info({ opportunityId, fromStatus, toStatus, reason }, 'Opportunity transition');
}

/**
 * Create a new opportunity in DISCOVERED state.
 */
export async function createOpportunity(params: {
  marketId: string;
  platform: 'KALSHI' | 'POLYMARKET';
  mode: 'RESEARCH' | 'SPEED';
  discoveredBy: string;
  marketPriceAtDiscovery: number;
  signalIds?: string[];
}): Promise<string> {
  // Check for existing active opportunity on this market
  const existing = await prisma.opportunity.findFirst({
    where: {
      marketId: params.marketId,
      status: { notIn: ['CLOSED', 'RESOLVED'] },
    },
  });
  if (existing) return existing.id;

  const opp = await prisma.opportunity.create({
    data: {
      marketId: params.marketId,
      platform: params.platform,
      mode: params.mode,
      discoveredBy: params.discoveredBy,
      marketPriceAtDiscovery: params.marketPriceAtDiscovery,
      signalIds: params.signalIds || [],
      transitions: {
        create: {
          fromStatus: 'DISCOVERED',
          toStatus: 'DISCOVERED',
          reason: `Discovered by ${params.discoveredBy}`,
        },
      },
    },
  });

  logger.info({ opportunityId: opp.id, marketId: params.marketId, mode: params.mode }, 'Opportunity created');
  return opp.id;
}

/**
 * Get opportunity pipeline summary for dashboard.
 */
export async function getOpportunityPipeline() {
  const counts = await prisma.opportunity.groupBy({
    by: ['status', 'mode'],
    _count: true,
  });

  const recent = await prisma.opportunity.findMany({
    where: { status: { notIn: ['CLOSED', 'RESOLVED'] } },
    include: {
      market: { select: { title: true, category: true, closesAt: true } },
      transitions: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { rank: 'asc' },
    take: 50,
  });

  return { counts, pipeline: recent };
}
