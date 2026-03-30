import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { DataTable, Column } from '../components/DataTable';
import { CardSkeleton, TableSkeleton } from '../components/Skeleton';
import { formatUSD } from '../utils/format';
import { colors, fonts } from '../theme';

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const TIME_FILTERS = [
  { label: 'All', ms: 0 },
  { label: '1h', ms: 3600000 },
  { label: '24h', ms: 86400000 },
  { label: '7d', ms: 604800000 },
];

const positionColumns: Column<Record<string, unknown>>[] = [
  { key: '_market', label: 'Market', width: '28%',
    render: (_v, row) => (row as any).market?.title ?? '\u2014',
  },
  { key: 'direction', label: 'Dir', width: '50px',
    render: (v) => <span style={{ color: v === 'BUY_YES' ? colors.green : colors.red, fontWeight: 700, fontSize: '12px' }}>{v === 'BUY_YES' ? 'YES' : 'NO'}</span>,
  },
  { key: 'createdAt', label: 'Entered', width: '90px',
    render: (v) => <span style={{ fontSize: '11px', color: colors.textSecondary }}>{fmtTime(v as string)}</span>,
  },
  { key: 'closedAt', label: 'Exited', width: '90px',
    render: (v) => <span style={{ fontSize: '11px', color: v ? colors.textMuted : colors.textMuted + '40' }}>{v ? fmtTime(v as string) : '\u2014'}</span>,
  },
  { key: 'entryPrice', label: 'Entry', width: '65px', align: 'right',
    render: (v) => `${((v as number) * 100).toFixed(1)}\u00A2`,
  },
  { key: 'size', label: 'Size', width: '70px', align: 'right',
    render: (v) => formatUSD(v as number),
  },
  { key: 'unrealizedPnl', label: 'P&L', width: '80px', align: 'right',
    render: (v) => {
      const pnl = v as number;
      return <span style={{ color: pnl >= 0 ? colors.green : colors.red, fontWeight: 600 }}>{formatUSD(pnl)}</span>;
    },
  },
  { key: 'isOpen', label: 'Status', width: '65px',
    render: (v) => <span style={{ color: v ? colors.green : colors.textMuted, fontSize: '11px' }}>{v ? 'OPEN' : 'CLOSED'}</span>,
  },
];

export function Portfolio() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Record<string, any> | null>(null);
  const [positions, setPositions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getPortfolioSummary(),
      api.getPositions(),
    ]).then(([s, p]) => {
      setSummary(s);
      setPositions(p.data as Record<string, unknown>[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Filter + sort
  let filtered = positions;
  if (timeFilter > 0) {
    const cutoff = new Date(Date.now() - timeFilter).toISOString();
    filtered = filtered.filter(p => (p.createdAt as string) >= cutoff);
  }
  filtered = [...filtered].sort((a, b) => {
    const ta = new Date(a.createdAt as string).getTime();
    const tb = new Date(b.createdAt as string).getTime();
    return sortDesc ? tb - ta : ta - tb;
  });

  if (loading) return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>Portfolio</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
      </div>
      <TableSkeleton rows={5} columns={7} />
    </div>
  );

  return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>Portfolio</h1>

      {/* Summary Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          {[
            { label: 'Total Value', value: formatUSD(summary.totalValue), color: colors.text },
            { label: 'Deployed', value: formatUSD(summary.deployedCapital), color: colors.accent },
            { label: 'Unrealized P&L', value: formatUSD(summary.unrealizedPnl), color: summary.unrealizedPnl >= 0 ? colors.green : colors.red },
            { label: 'Realized P&L', value: formatUSD(summary.realizedPnl), color: summary.realizedPnl >= 0 ? colors.green : colors.red },
            { label: 'Open Positions', value: String(summary.openPositions), color: colors.text },
            { label: 'Portfolio Heat', value: `${((summary.portfolioHeat || 0) * 100).toFixed(0)}%`, color: summary.portfolioHeat > 0.5 ? colors.red : colors.yellow },
            { label: 'Paper Positions', value: String(summary.paper?.openPositions ?? 0), color: colors.textSecondary },
            { label: 'Paper P&L', value: formatUSD(summary.paper?.pnl ?? 0), color: (summary.paper?.pnl ?? 0) >= 0 ? colors.green : colors.red },
          ].map(item => (
            <div key={item.label} style={{
              backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px',
            }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>{item.label}</div>
              <div style={{ color: item.color, fontFamily: fonts.mono, fontSize: '16px', fontWeight: 600 }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Positions Table */}
      <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, margin: 0 }}>
            Positions
            <span style={{ color: colors.textMuted, fontWeight: 400, marginLeft: '8px' }}>({filtered.length})</span>
          </h2>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {TIME_FILTERS.map(f => (
              <button key={f.label} onClick={() => setTimeFilter(f.ms)} style={{
                padding: '3px 8px', fontSize: '11px', fontFamily: fonts.mono,
                backgroundColor: timeFilter === f.ms ? colors.accent + '20' : 'transparent',
                color: timeFilter === f.ms ? colors.accent : colors.textMuted,
                border: `1px solid ${timeFilter === f.ms ? colors.accent : colors.border}`,
                borderRadius: '4px', cursor: 'pointer',
              }}>{f.label}</button>
            ))}
            <button onClick={() => setSortDesc(!sortDesc)} style={{
              padding: '3px 8px', fontSize: '11px', fontFamily: fonts.mono,
              backgroundColor: 'transparent', color: colors.textMuted,
              border: `1px solid ${colors.border}`, borderRadius: '4px', cursor: 'pointer',
            }}>{sortDesc ? '\u2193 Newest' : '\u2191 Oldest'}</button>
          </div>
        </div>
        <DataTable
          columns={positionColumns}
          data={filtered}
          onRowClick={(row) => {
            const marketId = (row as any).marketId;
            if (marketId) navigate(`/markets/${marketId}/signals`);
          }}
          emptyMessage="No positions yet"
        />
      </div>
    </div>
  );
}
