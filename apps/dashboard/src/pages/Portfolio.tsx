import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { DataTable, Column } from '../components/DataTable';
import { CardSkeleton, TableSkeleton } from '../components/Skeleton';
import { formatVolume, formatUSD, formatRelativeTime } from '../utils/format';
import { colors, fonts } from '../theme';

const positionColumns: Column<Record<string, unknown>>[] = [
  { key: '_market', label: 'Market', width: '35%',
    render: (_v, row) => (row as any).market?.title ?? '\u2014',
  },
  { key: 'platform', label: 'Platform', width: '80px',
    render: (v) => <span style={{ fontSize: '11px', color: colors.accent }}>{v as string}</span>,
  },
  { key: 'direction', label: 'Dir', width: '60px',
    render: (v) => <span style={{ color: v === 'BUY_YES' ? colors.green : colors.red, fontWeight: 700, fontSize: '12px' }}>{v === 'BUY_YES' ? 'YES' : 'NO'}</span>,
  },
  { key: 'entryPrice', label: 'Entry', width: '70px', align: 'right',
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
  { key: 'isOpen', label: 'Status', width: '70px',
    render: (v) => <span style={{ color: v ? colors.green : colors.textMuted, fontSize: '11px' }}>{v ? 'OPEN' : 'CLOSED'}</span>,
  },
];

export function Portfolio() {
  const [summary, setSummary] = useState<Record<string, any> | null>(null);
  const [positions, setPositions] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

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
        <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', marginBottom: '16px', color: colors.textSecondary }}>Positions</h2>
        <DataTable
          columns={positionColumns}
          data={positions}
          emptyMessage="No positions yet"
        />
      </div>
    </div>
  );
}
