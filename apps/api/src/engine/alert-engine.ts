import { prisma } from '../lib/prisma';
import { Prisma } from '@apex/db';
import type { AlertType, AlertSeverity } from '@apex/db';
import { ALERT_COOLDOWNS } from '@apex/shared';
import { logger } from '../lib/logger';
import { broadcast } from '../plugins/websocket';
import { telegramService } from '../services/telegram';

export interface CreateAlertInput {
  type: AlertType;
  severity: AlertSeverity;
  marketId?: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create an alert with cooldown logic.
 * Same type+market within cooldown period → suppressed.
 */
export async function createAlert(input: CreateAlertInput): Promise<string | null> {
  // Check cooldown
  const cooldownMinutes = ALERT_COOLDOWNS[input.type] ?? 60;
  if (cooldownMinutes !== Infinity) {
    const since = new Date(Date.now() - cooldownMinutes * 60 * 1000);
    const recentAlert = await prisma.alert.findFirst({
      where: {
        type: input.type,
        marketId: input.marketId ?? null,
        createdAt: { gte: since },
      },
    });
    if (recentAlert) {
      logger.debug({ type: input.type, marketId: input.marketId }, 'Alert suppressed by cooldown');
      return null;
    }
  }

  const alert = await prisma.alert.create({
    data: {
      type: input.type,
      severity: input.severity,
      marketId: input.marketId,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });

  logger.info({ alertId: alert.id, type: input.type, severity: input.severity }, 'Alert created');

  // Broadcast via WebSocket
  broadcast('alert:new', alert);

  // Send to Telegram for severity >= MEDIUM
  if (['MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity)) {
    telegramService.sendAlert(input.title, input.message, input.severity).catch(() => {});
  }

  return alert.id;
}

/**
 * Fire NEW_EDGE alert when an actionable edge is detected.
 */
export async function fireNewEdgeAlert(
  marketTitle: string,
  marketId: string,
  edgeMagnitude: number,
  expectedValue: number,
  direction: string
): Promise<void> {
  const severity: AlertSeverity = expectedValue > 0.05 ? 'HIGH' : 'MEDIUM';

  await createAlert({
    type: 'NEW_EDGE',
    severity,
    marketId,
    title: `Edge: ${marketTitle}`,
    message: `${direction} edge of ${(edgeMagnitude * 100).toFixed(1)}% detected (EV: ${(expectedValue * 100).toFixed(2)}%)`,
    metadata: { edgeMagnitude, expectedValue, direction },
  });
}

/**
 * Fire EDGE_EVAPORATION alert when an actionable edge drops below threshold.
 */
export async function fireEdgeEvaporationAlert(
  marketTitle: string,
  marketId: string,
  previousEdge: number,
  reason: string
): Promise<void> {
  await createAlert({
    type: 'EDGE_EVAPORATION',
    severity: 'MEDIUM',
    marketId,
    title: `Edge evaporated: ${marketTitle}`,
    message: `Previous edge of ${(previousEdge * 100).toFixed(1)}% has disappeared. ${reason}`,
    metadata: { previousEdge, reason },
  });
}

/**
 * Fire MODULE_FAILURE alert after consecutive failures.
 */
export async function fireModuleFailureAlert(moduleId: string, consecutiveFailures: number, lastError: string): Promise<void> {
  if (consecutiveFailures < 3) return;

  await createAlert({
    type: 'MODULE_FAILURE',
    severity: 'HIGH',
    title: `${moduleId} module failing`,
    message: `${consecutiveFailures} consecutive failures. Last error: ${lastError.slice(0, 200)}`,
    metadata: { moduleId, consecutiveFailures },
  });
}
