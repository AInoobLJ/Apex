import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, Column } from '../components/DataTable';
import { CardSkeleton, TableSkeleton } from '../components/Skeleton';
import { formatRelativeTime } from '../utils/format';
import type { HealthResponse, JobStatusResponse } from '@apex/shared';
import { colors, fonts } from '../theme';

const jobColumns: Column<Record<string, unknown>>[] = [
  { key: 'name', label: 'Queue', width: '150px' },
  { key: 'active', label: 'Active', align: 'right', width: '80px',
    render: (v) => <span style={{ color: (v as number) > 0 ? colors.accent : colors.textMuted }}>{String(v)}</span>,
  },
  { key: 'waiting', label: 'Waiting', align: 'right', width: '80px' },
  { key: 'completed', label: 'Completed', align: 'right', width: '100px',
    render: (v) => <span style={{ color: colors.textSecondary }}>{String(v)}</span>,
  },
  { key: 'failed', label: 'Failed', align: 'right', width: '80px',
    render: (v) => {
      const n = v as number;
      return <span style={{ color: n > 0 ? colors.red : colors.textMuted, fontWeight: n > 0 ? 700 : 400 }}>{String(n)}</span>;
    },
  },
  { key: 'delayed', label: 'Delayed', align: 'right', width: '80px' },
];

export function System() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobs, setJobs] = useState<JobStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [modules, setModules] = useState<{ moduleId: string; lastRunAt: string | null; signalsLast24h: number; status: string }[] | null>(null);
  const [apiUsage, setApiUsage] = useState<{ today: { totalCost: number; totalCalls: number; totalTokensIn: number; totalTokensOut: number }; budget: number } | null>(null);

  useEffect(() => {
    Promise.all([
      api.getHealth().catch(() => null),
      api.getJobs().catch(() => null),
      api.getModuleStatus().catch(() => null),
      api.getApiUsage().catch(() => null),
    ]).then(([h, j, m, u]) => {
      setHealth(h);
      setJobs(j);
      setModules(m?.modules ?? null);
      setApiUsage(u);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div>
        <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>System Monitor</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
          <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
        </div>
        <TableSkeleton rows={4} columns={6} />
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>System Monitor</h1>

      {/* Health cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {health && Object.entries(health.checks).map(([name, check]) => (
          <div key={name} style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${check.status === 'up' ? colors.green + '40' : check.status === 'down' ? colors.red + '40' : colors.border}`,
            borderRadius: '8px',
            padding: '16px',
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '8px' }}>
              {name}
            </div>
            <StatusBadge status={check.status} />
            {'latencyMs' in check && (
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '8px', fontFamily: fonts.mono }}>
                {check.latencyMs}ms
              </div>
            )}
            {'lastSuccessAt' in check && check.lastSuccessAt && (
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
                Last: {formatRelativeTime(check.lastSuccessAt)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Overall status */}
      {health && (
        <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: colors.textSecondary }}>Overall:</span>
          <StatusBadge status={health.status} />
          <span style={{ color: colors.textMuted, fontSize: '13px', fontFamily: fonts.mono }}>
            Uptime: {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
          </span>
        </div>
      )}

      {/* Job queues */}
      <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px', color: colors.textSecondary }}>
        Job Queues
      </h2>
      {jobs && (
        <DataTable
          columns={jobColumns}
          data={jobs.queues as unknown as Record<string, unknown>[]}
          rowAccent={(row) => (row.failed as number) > 0 ? colors.red : undefined}
        />
      )}

      {/* Module Health */}
      {modules && modules.length > 0 && (
        <>
          <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px', marginTop: '24px', color: colors.textSecondary }}>
            Signal Modules
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
            {modules.map(m => (
              <div key={m.moduleId} style={{
                backgroundColor: colors.bgSecondary,
                border: `1px solid ${m.status === 'healthy' ? colors.green + '40' : m.status === 'degraded' ? colors.yellow + '40' : colors.border}`,
                borderRadius: '8px', padding: '12px',
              }}>
                <div style={{ fontFamily: fonts.mono, fontSize: '13px', color: colors.accent, marginBottom: '4px' }}>{m.moduleId}</div>
                <StatusBadge status={m.status === 'healthy' ? 'up' : m.status === 'degraded' ? 'unknown' : 'down'} label={m.status.toUpperCase()} />
                <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '4px' }}>
                  {m.signalsLast24h} signals (24h)
                </div>
                {m.lastRunAt && (
                  <div style={{ color: colors.textMuted, fontSize: '11px' }}>
                    Last: {formatRelativeTime(m.lastRunAt)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* API Usage / LLM Costs */}
      {apiUsage && (
        <>
          <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px', marginTop: '24px', color: colors.textSecondary }}>
            Claude API Usage (Today)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Cost Today</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: colors.accent }}>${apiUsage.today.totalCost.toFixed(4)}</div>
            </div>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Budget</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: colors.text }}>${apiUsage.budget.toFixed(2)}</div>
            </div>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>API Calls</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: colors.text }}>{apiUsage.today.totalCalls}</div>
            </div>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Tokens</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary }}>
                <span style={{ color: colors.green }}>{(apiUsage.today.totalTokensIn / 1000).toFixed(1)}K</span> in / <span style={{ color: colors.accent }}>{(apiUsage.today.totalTokensOut / 1000).toFixed(1)}K</span> out
              </div>
            </div>
          </div>
          {/* Budget bar */}
          <div style={{ marginTop: '8px', height: '6px', backgroundColor: colors.bgTertiary, borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (apiUsage.today.totalCost / apiUsage.budget) * 100)}%`,
              height: '100%',
              backgroundColor: apiUsage.today.totalCost / apiUsage.budget > 0.8 ? colors.red : colors.accent,
              borderRadius: '3px',
            }} />
          </div>
          <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
            {((apiUsage.today.totalCost / apiUsage.budget) * 100).toFixed(1)}% of daily budget used
          </div>
        </>
      )}
    </div>
  );
}
