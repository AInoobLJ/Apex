import type {
  ListMarketsResponse,
  MarketDetailResponse,
  PriceHistoryResponse,
  OrderBookResponse,
  ListEdgesResponse,
  HealthResponse,
  JobStatusResponse,
} from '@apex/shared';
import { queryString } from '@apex/shared';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

function qs(params: Record<string, unknown>): string {
  return queryString(params);
}

export const api = {
  listMarkets: (query: Record<string, unknown> = {}) =>
    apiFetch<ListMarketsResponse>(`/markets?${qs(query)}`),

  getMarket: (id: string) =>
    apiFetch<MarketDetailResponse>(`/markets/${id}`),

  getPriceHistory: (id: string, query: Record<string, unknown> = {}) =>
    apiFetch<PriceHistoryResponse>(`/markets/${id}/prices?${qs(query)}`),

  getOrderBook: (id: string) =>
    apiFetch<OrderBookResponse>(`/markets/${id}/orderbook`),

  listEdges: (query: Record<string, unknown> = {}) =>
    apiFetch<ListEdgesResponse>(`/edges?${qs(query)}`),

  getHealth: () =>
    apiFetch<HealthResponse>('/system/health'),

  getJobs: () =>
    apiFetch<JobStatusResponse>('/system/jobs'),

  // Execution / TRADEX
  getExecutionLog: (query: Record<string, unknown> = {}) =>
    apiFetch<{ data: unknown[]; pagination: unknown }>(`/execution/log?${qs(query)}`),

  getExecutionPositions: () =>
    apiFetch<{ data: unknown[] }>('/execution/positions'),

  getExecutionBalances: () =>
    apiFetch<Record<string, { available: number; deployed: number; demo: boolean }>>('/execution/balances'),

  getRiskLimits: () =>
    apiFetch<{ limits: Record<string, number>; hardCeilings: Record<string, number>; defaults: Record<string, number> }>('/execution/risk-limits'),

  updateRiskLimits: (limits: Record<string, number>) =>
    apiFetch<{ limits: Record<string, number>; changes: unknown[] }>('/execution/risk-limits', {
      method: 'PUT',
      body: JSON.stringify({ limits, confirm: 'CONFIRM' }),
    }),

  getKillSwitch: () =>
    apiFetch<{ tradexEnabled: boolean }>('/execution/kill-switch'),

  setKillSwitch: (enabled: boolean) =>
    apiFetch<{ tradexEnabled: boolean }>('/execution/kill-switch', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  getAuditLog: () =>
    apiFetch<{ data: { id: string; setting: string; previousValue: string; newValue: string; changedAt: string }[] }>('/execution/audit-log'),

  // Signals
  getMarketSignals: (marketId: string) =>
    apiFetch<{ marketId: string; signals: unknown[]; cortex: unknown | null }>(`/markets/${marketId}/signals`),

  getModuleStatus: () =>
    apiFetch<{ modules: { moduleId: string; lastRunAt: string | null; signalsLast24h: number; status: string }[] }>('/signals/modules'),

  // Portfolio
  getPortfolioSummary: () =>
    apiFetch<Record<string, unknown>>('/portfolio/summary'),

  getPositions: () =>
    apiFetch<{ data: unknown[] }>('/portfolio/positions'),

  createPosition: (data: Record<string, unknown>) =>
    apiFetch<unknown>('/portfolio/positions', { method: 'POST', body: JSON.stringify(data) }),

  // Alerts
  getAlerts: (query: Record<string, unknown> = {}) =>
    apiFetch<{ data: unknown[] }>(`/alerts?${qs(query)}`),

  acknowledgeAlert: (id: string) =>
    apiFetch<unknown>(`/alerts/${id}/acknowledge`, { method: 'PATCH' }),

  snoozeAlert: (id: string, minutes = 60) =>
    apiFetch<unknown>(`/alerts/${id}/snooze`, { method: 'PATCH', body: JSON.stringify({ minutes }) }),

  // System — API usage
  getApiUsage: () =>
    apiFetch<{ today: { totalCost: number; totalCalls: number; totalTokensIn: number; totalTokensOut: number; byEndpoint: Record<string, { calls: number; cost: number }> }; budget: number }>('/system/api-usage'),

  // SIGINT
  getWallets: (query: Record<string, unknown> = {}) =>
    apiFetch<{ data: unknown[] }>(`/sigint/wallets?${qs(query)}`),

  getSmartMoneyMoves: () =>
    apiFetch<{ data: unknown[] }>('/sigint/moves'),

  // NEXUS
  getNexusGraph: () =>
    apiFetch<{ nodes: unknown[]; edges: unknown[] }>('/nexus/graph'),

  getNexusInconsistencies: () =>
    apiFetch<{ data: unknown[] }>('/nexus/inconsistencies'),
};
