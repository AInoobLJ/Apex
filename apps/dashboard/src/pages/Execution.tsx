import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { DataTable, Column } from '../components/DataTable';
import { TableSkeleton, CardSkeleton } from '../components/Skeleton';
import { formatRelativeTime, formatUSD } from '../utils/format';
import { colors, fonts } from '../theme';

const STATUS_COLORS: Record<string, string> = {
  FILLED: colors.green,
  PARTIAL: colors.yellow,
  PENDING: colors.accent,
  FAILED: colors.red,
  CANCELLED: colors.textMuted,
  EXPIRED: colors.orange,
};

const columns: Column<Record<string, unknown>>[] = [
  { key: '_market', label: 'Market', width: '250px', minWidth: '150px',
    render: (_v, row) => (row as any).market?.title ?? '\u2014',
  },
  { key: 'platform', label: 'Platform', width: '100px',
    render: (v) => <span style={{ fontSize: '11px', color: colors.accent }}>{v as string}</span>,
  },
  { key: 'direction', label: 'Dir', width: '70px',
    render: (v) => <span style={{ color: v === 'BUY_YES' ? colors.green : colors.red, fontWeight: 700, fontSize: '12px' }}>
      {v === 'BUY_YES' ? 'YES' : 'NO'}
    </span>,
  },
  { key: 'executionMode', label: 'Mode', width: '80px',
    render: (v) => <span style={{ color: v === 'FAST_EXEC' ? colors.orange : colors.accent, fontSize: '11px' }}>{v as string}</span>,
  },
  { key: 'requestedPrice', label: 'Price', width: '70px', align: 'right',
    render: (v, row) => formatUSD((row as any).filledPrice ?? v as number),
  },
  { key: 'requestedSize', label: 'Size', width: '60px', align: 'right',
    render: (v, row) => String((row as any).filledSize ?? v),
  },
  { key: 'fee', label: 'Fee', width: '70px', align: 'right',
    render: (v) => v != null ? formatUSD(v as number, 4) : '\u2014',
  },
  { key: 'status', label: 'Status', width: '80px',
    render: (v) => <span style={{ color: STATUS_COLORS[v as string] ?? colors.textMuted, fontWeight: 600, fontSize: '11px' }}>{v as string}</span>,
  },
  { key: 'latencyMs', label: 'Latency', width: '70px', align: 'right',
    render: (v) => v != null ? `${v}ms` : '\u2014',
  },
  { key: 'createdAt', label: 'Time', width: '80px',
    render: (v) => <span style={{ color: colors.textMuted, fontSize: '11px' }}>{formatRelativeTime(v as string)}</span>,
  },
];

export function Execution() {
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [balances, setBalances] = useState<Record<string, { available: number; deployed: number; demo: boolean }>>({});
  const [killSwitch, setKillSwitch] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getExecutionLog(),
      api.getExecutionBalances(),
      api.getKillSwitch(),
    ]).then(([logData, balanceData, switchData]) => {
      setLogs(logData.data as Record<string, unknown>[]);
      setBalances(balanceData);
      setKillSwitch(switchData.tradexEnabled);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '20px' }}>Execution</h1>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <CardSkeleton /><CardSkeleton />
        </div>
        <TableSkeleton rows={6} columns={8} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '20px' }}>Execution</h1>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 12px', borderRadius: '6px',
          backgroundColor: killSwitch ? colors.greenDim : colors.redDim,
          border: `1px solid ${killSwitch ? colors.green : colors.red}`,
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: killSwitch ? colors.green : colors.red }} />
          <span style={{ color: killSwitch ? colors.green : colors.red, fontSize: '13px', fontWeight: 600 }}>
            {killSwitch ? 'ACTIVE' : 'DISABLED'}
          </span>
        </div>
      </div>

      {/* Platform Balances */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {Object.entries(balances).map(([platform, balance]) => (
          <div key={platform} style={{
            backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '16px',
          }}>
            <div style={{ color: colors.textMuted, fontSize: '12px', textTransform: 'uppercase', marginBottom: '8px' }}>
              {platform} {balance.demo && <span style={{ color: colors.yellow }}>(DEMO)</span>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <div style={{ color: colors.textSecondary, fontSize: '11px' }}>Available</div>
                <div style={{ color: colors.green, fontFamily: fonts.mono, fontSize: '16px' }}>${balance.available.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ color: colors.textSecondary, fontSize: '11px' }}>Deployed</div>
                <div style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: '16px' }}>${balance.deployed.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Execution Log */}
      <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px' }}>
        <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '14px', marginBottom: '16px' }}>Execution Log</h2>
        <DataTable
          columns={columns}
          data={logs}
          emptyMessage="No executions yet"
        />
      </div>
    </div>
  );
}
