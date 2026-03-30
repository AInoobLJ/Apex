import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, Column } from '../components/DataTable';
import { CardSkeleton, TableSkeleton } from '../components/Skeleton';
import { formatRelativeTime } from '../utils/format';
import type { HealthResponse, JobStatusResponse } from '@apex/shared';
import { colors, fonts } from '../theme';

type JobError = { queue: string; jobName: string; failedAt: string; error: string; attemptsMade: number };
type CostDay = { date: string; cost: number; calls: number };
type CostForecast = {
  history: CostDay[];
  avgDailyCost: number;
  recentTrend: number;
  forecast: { date: string; projectedCost: number }[];
  budget: number;
  daysUntilBudgetExceeded: number | null;
};

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

type TrainingStatus = {
  trainingData: { totalSnapshots: number; resolvedSnapshots: number; unresolvedSnapshots: number; byCategory: { category: string; count: number }[] };
  featureModel: { status: string; sampleSize: number; validationAccuracy: number; trainedAt: string | null };
  calibration: { bucket: string; positions: number; wins: number; predictedAvg: number; actualWinRate: number; calibrationError: number }[];
  directionalBalance: { buyYes: number; buyNo: number; total: number; yesRatio: number };
};

export function System() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [jobs, setJobs] = useState<JobStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [modules, setModules] = useState<{ moduleId: string; lastRunAt: string | null; signalsLast24h: number; status: string }[] | null>(null);
  const [apiUsage, setApiUsage] = useState<{ today: { totalCost: number; totalCalls: number; totalTokensIn: number; totalTokensOut: number }; budget: number } | null>(null);
  const [jobErrors, setJobErrors] = useState<JobError[] | null>(null);
  const [costForecast, setCostForecast] = useState<CostForecast | null>(null);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(null);
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getHealth().catch(() => null),
      api.getJobs().catch(() => null),
      api.getModuleStatus().catch(() => null),
      api.getApiUsage().catch(() => null),
      api.getJobErrors().catch(() => null),
      api.getCostForecast().catch(() => null),
      api.getTrainingStatus().catch(() => null),
    ]).then(([h, j, m, u, errs, forecast, training]) => {
      setHealth(h);
      setJobs(j);
      setModules(m?.modules ?? null);
      setApiUsage(u);
      setJobErrors(errs?.errors ?? null);
      setCostForecast(forecast);
      setTrainingStatus(training);
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

      {/* Overall status banner */}
      {health && (
        <div style={{
          marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 16px', borderRadius: '8px',
          backgroundColor: health.status === 'healthy' ? colors.green + '10' : health.status === 'degraded' ? colors.yellow + '10' : colors.red + '10',
          border: `1px solid ${health.status === 'healthy' ? colors.green + '40' : health.status === 'degraded' ? colors.yellow + '40' : colors.red + '40'}`,
        }}>
          <StatusBadge status={health.status} />
          <span style={{ color: colors.textMuted, fontSize: '13px', fontFamily: fonts.mono }}>
            Uptime: {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
          </span>
          {health.timestamp && (
            <span style={{ color: colors.textMuted, fontSize: '11px', marginLeft: 'auto' }}>
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Core services */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {health?.services && (
          <>
            <div style={{
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${health.services.database.status === 'up' ? colors.green + '40' : colors.red + '40'}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '8px' }}>Database</div>
              <StatusBadge status={health.services.database.status} />
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '8px', fontFamily: fonts.mono }}>
                {health.services.database.latencyMs}ms
              </div>
            </div>
            <div style={{
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${health.services.redis.status === 'up' ? colors.green + '40' : colors.red + '40'}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '8px' }}>Redis</div>
              <StatusBadge status={health.services.redis.status} />
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '8px', fontFamily: fonts.mono }}>
                {health.services.redis.latencyMs}ms
              </div>
            </div>
            <div style={{
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${health.services.worker.status === 'up' ? colors.green + '40' : health.services.worker.status === 'idle' ? colors.yellow + '40' : colors.red + '40'}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '8px' }}>Worker</div>
              <StatusBadge status={health.services.worker.status === 'up' ? 'up' : health.services.worker.status === 'idle' ? 'unknown' : 'down'} label={health.services.worker.status.toUpperCase()} />
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '8px', fontFamily: fonts.mono }}>
                {health.services.worker.activeJobs} active jobs
              </div>
            </div>
          </>
        )}
        {health?.platforms && Object.entries(health.platforms).map(([name, check]) => (
          <div key={name} style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${check.status === 'up' ? colors.green + '40' : check.status === 'down' ? colors.red + '40' : colors.border}`,
            borderRadius: '8px', padding: '16px',
          }}>
            <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '8px' }}>{name}</div>
            <StatusBadge status={check.status} />
            {check.lastSuccessAt && (
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
                Last: {formatRelativeTime(check.lastSuccessAt)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Circuit Breakers + Portfolio + Budget in a row */}
      {health && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          {/* Circuit Breakers */}
          {health.circuitBreakers && Object.keys(health.circuitBreakers).length > 0 && (
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '12px' }}>Circuit Breakers</div>
              {Object.entries(health.circuitBreakers).map(([name, cb]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: '12px', color: colors.text }}>{name}</span>
                  <span style={{
                    fontFamily: fonts.mono, fontSize: '11px', fontWeight: 700,
                    color: cb.state === 'CLOSED' ? colors.green : cb.state === 'OPEN' ? colors.red : colors.yellow,
                  }}>
                    {cb.state} {cb.failures > 0 && `(${cb.failures})`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* Portfolio summary */}
          {health.portfolio && (
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontSize: '12px', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: '12px' }}>Paper Portfolio</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: colors.textMuted }}>Positions</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: '14px', fontWeight: 700, color: colors.text }}>{health.portfolio.paperPositions}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: colors.textMuted }}>Deployed</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: '14px', fontWeight: 700, color: colors.text }}>${health.portfolio.totalDeployed.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: colors.textMuted }}>Unrealized P&L</span>
                  <span style={{
                    fontFamily: fonts.mono, fontSize: '14px', fontWeight: 700,
                    color: health.portfolio.unrealizedPnl >= 0 ? colors.green : colors.red,
                  }}>
                    {health.portfolio.unrealizedPnl >= 0 ? '+' : ''}${health.portfolio.unrealizedPnl.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Job queues — clickable for drill-down */}
      <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px', color: colors.textSecondary }}>
        Job Queues
        <span style={{ fontSize: '11px', color: colors.textMuted, fontWeight: 400, marginLeft: '8px' }}>
          (click a row to see errors)
        </span>
      </h2>
      {jobs && (
        <DataTable
          columns={jobColumns}
          data={jobs.queues as unknown as Record<string, unknown>[]}
          rowAccent={(row) => (row.failed as number) > 0 ? colors.red : undefined}
          onRowClick={(row) => {
            const name = row.name as string;
            setExpandedQueue(expandedQueue === name ? null : name);
          }}
        />
      )}

      {/* Job error drill-down */}
      {expandedQueue && jobErrors && (
        <div style={{
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
          borderRadius: '8px', padding: '16px', marginTop: '8px', marginBottom: '16px',
        }}>
          <h3 style={{ fontFamily: fonts.mono, fontSize: '13px', color: colors.red, marginBottom: '12px' }}>
            Failed Jobs: {expandedQueue}
          </h3>
          {(() => {
            const queueErrors = jobErrors.filter(e => e.queue === expandedQueue.replace(/ \(.*\)/, ''));
            if (queueErrors.length === 0) {
              return <div style={{ color: colors.textMuted, fontSize: '13px' }}>No recent errors</div>;
            }
            return queueErrors.slice(0, 10).map((err, idx) => (
              <div key={idx} style={{
                padding: '8px 12px', marginBottom: '6px',
                backgroundColor: colors.bgTertiary, borderRadius: '6px',
                borderLeft: `3px solid ${colors.red}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontFamily: fonts.mono, fontSize: '12px', color: colors.accent }}>{err.jobName}</span>
                  <span style={{ fontSize: '11px', color: colors.textMuted }}>
                    {err.failedAt ? formatRelativeTime(err.failedAt) : 'N/A'} | Attempts: {err.attemptsMade}
                  </span>
                </div>
                <div style={{
                  fontFamily: fonts.mono, fontSize: '11px', color: colors.red,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '60px', overflow: 'hidden',
                }}>
                  {err.error}
                </div>
              </div>
            ));
          })()}
        </div>
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

      {/* Cost Forecasting */}
      {costForecast && (
        <>
          <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px', marginTop: '24px', color: colors.textSecondary }}>
            Cost Forecast (7-Day)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>7-Day Avg</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: colors.text }}>
                ${costForecast.avgDailyCost.toFixed(4)}/day
              </div>
            </div>
            <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Recent Trend</div>
              <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: costForecast.recentTrend > costForecast.avgDailyCost ? colors.yellow : colors.green }}>
                ${costForecast.recentTrend.toFixed(4)}/day
              </div>
            </div>
            {costForecast.daysUntilBudgetExceeded && (
              <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
                <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Budget Runway</div>
                <div style={{ fontFamily: fonts.mono, fontSize: '18px', fontWeight: 700, color: costForecast.daysUntilBudgetExceeded < 3 ? colors.red : colors.text }}>
                  {costForecast.daysUntilBudgetExceeded} days
                </div>
              </div>
            )}
          </div>

          {/* Bar chart: history + forecast */}
          <div style={{
            backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
            borderRadius: '8px', padding: '16px',
          }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '120px' }}>
              {costForecast.history.map(day => {
                const maxCost = Math.max(
                  ...costForecast.history.map(d => d.cost),
                  ...costForecast.forecast.map(d => d.projectedCost),
                  costForecast.budget * 0.5
                );
                const pct = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                return (
                  <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div style={{
                      width: '100%', maxWidth: '40px',
                      height: `${Math.max(2, pct)}%`,
                      backgroundColor: day.cost > costForecast.budget ? colors.red : colors.accent,
                      borderRadius: '3px 3px 0 0',
                    }} />
                    <div style={{ fontSize: '9px', color: colors.textMuted, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
                      {day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
              {/* Separator */}
              <div style={{ width: '2px', height: '100%', backgroundColor: colors.border, margin: '0 2px' }} />
              {costForecast.forecast.map(day => {
                const maxCost = Math.max(
                  ...costForecast.history.map(d => d.cost),
                  ...costForecast.forecast.map(d => d.projectedCost),
                  costForecast.budget * 0.5
                );
                const pct = maxCost > 0 ? (day.projectedCost / maxCost) * 100 : 0;
                return (
                  <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div style={{
                      width: '100%', maxWidth: '40px',
                      height: `${Math.max(2, pct)}%`,
                      backgroundColor: colors.accentDim,
                      borderRadius: '3px 3px 0 0',
                      border: `1px dashed ${colors.accent}`,
                    }} />
                    <div style={{ fontSize: '9px', color: colors.textMuted, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>
                      {day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: colors.textMuted }}>
              <span><span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: colors.accent, borderRadius: '2px', marginRight: '4px' }} />Actual</span>
              <span><span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: colors.accentDim, borderRadius: '2px', border: `1px dashed ${colors.accent}`, marginRight: '4px' }} />Projected</span>
            </div>
          </div>
        </>
      )}

      {/* ── Training & Calibration ── */}
      {trainingStatus && (
        <>
          <h2 style={{ fontFamily: fonts.mono, fontSize: '16px', marginTop: '32px', marginBottom: '16px', color: colors.text }}>
            Training & Calibration
          </h2>

          {/* Training data + model + directional balance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            {/* Training Data */}
            <div style={{ padding: '14px', borderRadius: '8px', backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '6px', fontFamily: fonts.mono }}>Training Snapshots</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: colors.text }}>{trainingStatus.trainingData.totalSnapshots}</div>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
                {trainingStatus.trainingData.resolvedSnapshots} resolved / {trainingStatus.trainingData.unresolvedSnapshots} pending
              </div>
            </div>

            {/* Model Status */}
            <div style={{ padding: '14px', borderRadius: '8px', backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '6px', fontFamily: fonts.mono }}>FeatureModel</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: trainingStatus.featureModel.status === 'trained' ? colors.green : colors.yellow }}>
                {trainingStatus.featureModel.status === 'trained'
                  ? `Trained (${trainingStatus.featureModel.sampleSize} samples)`
                  : 'Untrained'}
              </div>
              {trainingStatus.featureModel.validationAccuracy > 0 && (
                <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
                  Val accuracy: {(trainingStatus.featureModel.validationAccuracy * 100).toFixed(1)}%
                </div>
              )}
            </div>

            {/* Directional Balance */}
            <div style={{ padding: '14px', borderRadius: '8px', backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginBottom: '6px', fontFamily: fonts.mono }}>Direction (7d)</div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: trainingStatus.directionalBalance.yesRatio > 75 || trainingStatus.directionalBalance.yesRatio < 25 ? colors.red : colors.green }}>
                {trainingStatus.directionalBalance.yesRatio}% YES / {100 - trainingStatus.directionalBalance.yesRatio}% NO
              </div>
              <div style={{ fontSize: '11px', color: colors.textMuted, marginTop: '4px' }}>
                {trainingStatus.directionalBalance.buyYes}Y / {trainingStatus.directionalBalance.buyNo}N ({trainingStatus.directionalBalance.total} total)
              </div>
            </div>
          </div>

          {/* Calibration Table */}
          {trainingStatus.calibration.length > 0 && (
            <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text, marginBottom: '12px', fontFamily: fonts.mono }}>
                Calibration by Decile
              </div>
              <table style={{ width: '100%', fontSize: '12px', fontFamily: fonts.mono, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: colors.textMuted }}>Bucket</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: colors.textMuted }}>Positions</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: colors.textMuted }}>Predicted</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: colors.textMuted }}>Actual</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: colors.textMuted }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingStatus.calibration.filter(c => c.positions > 0).map(c => (
                    <tr key={c.bucket} style={{ borderBottom: `1px solid ${colors.border}20` }}>
                      <td style={{ padding: '6px 8px', color: colors.text }}>{c.bucket}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: colors.textSecondary }}>{c.positions}</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: colors.textSecondary }}>{c.predictedAvg.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: colors.textSecondary }}>{c.actualWinRate.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', padding: '6px 8px', color: Math.abs(c.calibrationError) > 10 ? colors.red : colors.green, fontWeight: 600 }}>
                        {c.calibrationError > 0 ? '+' : ''}{c.calibrationError.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {trainingStatus.calibration.every(c => c.positions === 0) && (
                <div style={{ textAlign: 'center', padding: '20px', color: colors.textMuted, fontSize: '12px' }}>
                  No calibration data yet. Waiting for markets to resolve.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
