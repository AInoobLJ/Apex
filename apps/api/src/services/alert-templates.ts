import type { ArbOpportunity } from '../modules/arbex';

/**
 * Telegram HTML message templates for alerts.
 * These format alert data into Telegram-compatible HTML strings.
 * Used by TelegramService (Phase 2) to deliver alerts.
 */

// ── ARB ALERT ──

export function formatArbAlert(arb: ArbOpportunity): string {
  const urgencyEmoji = arb.urgency === 'URGENT' ? '🚨' : '🔔';
  const urgencyLabel = arb.urgency === 'URGENT' ? '<b>URGENT</b>' : 'NORMAL';
  const typeLabel = arb.type === 'INTRA_PLATFORM' ? 'Intra-Platform' : 'Cross-Platform';

  let lines = [
    `⏰ <b>ARB ALERT</b> — ${urgencyEmoji} ${urgencyLabel}`,
    ``,
    `<b>Type:</b> ${typeLabel}`,
    `<b>Market:</b> ${escapeHtml(arb.marketTitle)}`,
  ];

  if (arb.type === 'CROSS_PLATFORM') {
    lines.push(`<b>YES:</b> ${arb.yesPlatform} @ $${arb.yesPrice.toFixed(2)}`);
    lines.push(`<b>NO:</b> ${arb.noPlatform} @ $${arb.noPrice.toFixed(2)}`);
    lines.push(`<b>Match:</b> ${escapeHtml(arb.crossPlatformTitle ?? '')} (${((arb.similarity ?? 0) * 100).toFixed(0)}% similarity)`);
  } else {
    lines.push(`<b>Platform:</b> ${arb.platform}`);
    lines.push(`<b>YES:</b> $${arb.yesPrice.toFixed(2)} | <b>NO:</b> $${arb.noPrice.toFixed(2)}`);
  }

  lines.push(``);
  lines.push(`<b>Gross Spread:</b> ${(arb.grossSpread * 100).toFixed(1)}%`);
  lines.push(`<b>Fees:</b> $${arb.totalFees.toFixed(4)}`);
  lines.push(`<b>Net Profit:</b> $${arb.netProfit.toFixed(4)}/contract`);
  lines.push(`<b>Recommended:</b> ${arb.contracts} contracts`);

  if (arb.urgency === 'URGENT') {
    lines.push(``);
    lines.push(`⚡ <i>Execute immediately — arbs average 2.7s lifespan</i>`);
  }

  return lines.join('\n');
}

// ── NEW EDGE ALERT ──

export interface NewEdgeAlertData {
  marketTitle: string;
  platform: string;
  cortexProbability: number;
  marketPrice: number;
  edgeMagnitude: number;
  direction: string;
  confidence: number;
  kellySize: number;
  topReasoning: string;
  isPaperOnly: boolean;
  moduleReasons?: { moduleId: string; reasoning: string }[];
}

export function formatNewEdgeAlert(data: NewEdgeAlertData): string {
  const prefix = data.isPaperOnly ? '📝 ' : '';
  const severity = data.edgeMagnitude > 0.05 ? '🔥🔥' : '🔥';

  const lines = [
    `${prefix}${severity} <b>NEW EDGE</b>: "${escapeHtml(data.marketTitle)}"`,
    `${data.direction} — ${(data.edgeMagnitude * 100).toFixed(1)}% edge`,
    ``,
    `CORTEX ${(data.cortexProbability * 100).toFixed(1)}% vs Market ${(data.marketPrice * 100).toFixed(1)}%`,
    `Conf: ${(data.confidence * 100).toFixed(0)}% | EV: ${(data.edgeMagnitude * data.confidence * 100).toFixed(2)}%`,
  ];

  // Add per-module one-liner reasoning
  if (data.moduleReasons && data.moduleReasons.length > 0) {
    lines.push('');
    for (const mr of data.moduleReasons.slice(0, 3)) {
      const emoji = mr.moduleId === 'LEGEX' ? '📜' : mr.moduleId === 'DOMEX' ? '🧠' : mr.moduleId === 'ALTEX' ? '📰' : mr.moduleId === 'COGEX' ? '🧮' : mr.moduleId === 'FLOWEX' ? '📊' : '📌';
      lines.push(`${emoji} <b>${mr.moduleId}:</b> ${escapeHtml(mr.reasoning.split('.')[0].slice(0, 100))}`);
    }
  }

  return lines.join('\n');
}

// ── MODULE FAILURE ALERT ──

export interface ModuleFailureAlertData {
  moduleId: string;
  consecutiveFailures: number;
  lastError: string;
}

export function formatModuleFailureAlert(data: ModuleFailureAlertData): string {
  return [
    `🚨 <b>MODULE FAILURE</b>`,
    ``,
    `<b>Module:</b> ${data.moduleId}`,
    `<b>Consecutive Failures:</b> ${data.consecutiveFailures}`,
    `<b>Last Error:</b> <code>${escapeHtml(data.lastError.slice(0, 200))}</code>`,
  ].join('\n');
}

// ── EDGE EVAPORATION ALERT ──

export interface EdgeEvaporationAlertData {
  marketTitle: string;
  previousEdge: number;
  reason: string;
}

export function formatEdgeEvaporationAlert(data: EdgeEvaporationAlertData): string {
  return [
    `💨 <b>EDGE EVAPORATED</b>`,
    ``,
    `<b>Market:</b> ${escapeHtml(data.marketTitle)}`,
    `<b>Previous Edge:</b> ${(data.previousEdge * 100).toFixed(1)}%`,
    `<b>Reason:</b> ${escapeHtml(data.reason)}`,
  ].join('\n');
}

// ── UTIL ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
