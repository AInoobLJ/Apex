import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketStore } from '../stores/market-store';
import { DataTable, Column } from '../components/DataTable';
import { TableSkeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/StatusBadge';
import { useDebounce } from '../hooks/useDebounce';
import { formatVolume, formatCents } from '../utils/format';
import { colors, fonts } from '../theme';

const CATEGORIES = ['', 'POLITICS', 'FINANCE', 'CRYPTO', 'SCIENCE', 'SPORTS', 'CULTURE', 'OTHER'];
const PLATFORMS = ['', 'KALSHI', 'POLYMARKET'];
const STATUSES = ['', 'ACTIVE', 'CLOSED', 'RESOLVED'];

const statusMap: Record<string, 'up' | 'down' | 'unknown'> = {
  ACTIVE: 'up', CLOSED: 'down', RESOLVED: 'unknown', SUSPENDED: 'down',
};

const columns: Column<Record<string, unknown>>[] = [
  { key: 'platform', label: 'Platform', width: '90px', minWidth: '70px',
    render: (v) => {
      const p = v as string;
      return <span style={{ fontSize: '10px', color: colors.accent }}>{p === 'POLYMARKET' ? 'POLY' : p}</span>;
    },
  },
  { key: 'title', label: 'Market', width: '35%', minWidth: '180px' },
  { key: 'category', label: 'Cat', width: '70px', minWidth: '60px',
    render: (v) => <span style={{ fontSize: '10px', color: colors.textSecondary }}>{(v as string).slice(0, 5)}</span>,
  },
  {
    key: 'yesPrice', label: 'Yes', width: '55px', minWidth: '50px', align: 'right', sortable: true,
    render: (v) => <span style={{ color: v != null ? colors.green : colors.textMuted }}>{formatCents(v as number | null)}</span>,
  },
  {
    key: 'volume', label: 'Volume', width: '75px', minWidth: '65px', align: 'right', sortable: true,
    render: (v) => <span style={{ color: colors.textSecondary }}>{formatVolume(v as number)}</span>,
  },
  {
    key: 'hasEdge', label: 'Edge', width: '55px', minWidth: '50px', align: 'center',
    render: (v, row) => (v as boolean)
      ? <span style={{ color: colors.green, fontWeight: 700 }}>{((row.edgeMagnitude as number) * 100).toFixed(1)}%</span>
      : <span style={{ color: colors.textMuted }}>{'\u2014'}</span>,
  },
  { key: 'status', label: 'Status', width: '75px', minWidth: '70px',
    render: (v) => <StatusBadge status={statusMap[v as string] || 'unknown'} label={v as string} />,
  },
];

export function Markets() {
  const { markets, loading, filters, pagination, fetchMarkets, setFilters, setPage } = useMarketStore();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const debouncedSearch = useDebounce(searchInput, 300);
  const isFirstRender = useRef(true);

  useEffect(() => { fetchMarkets(); }, []);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setFilters({ search: debouncedSearch || undefined });
  }, [debouncedSearch]);

  return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '16px' }}>
        Market Explorer <span style={{ color: colors.textMuted, fontSize: '14px' }}>({pagination.total.toLocaleString()})</span>
      </h1>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={filters.platform || ''}
          onChange={(e) => setFilters({ platform: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">All Platforms</option>
          {PLATFORMS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={filters.category || ''}
          onChange={(e) => setFilters({ category: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={filters.status || ''}
          onChange={(e) => setFilters({ status: e.target.value || undefined })}
          style={selectStyle}
        >
          <option value="">All Statuses</option>
          {STATUSES.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <input
          type="text"
          placeholder="Search markets..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            ...selectStyle,
            flex: 1,
            minWidth: '200px',
          }}
        />
      </div>

      {loading ? (
        <TableSkeleton rows={12} columns={7} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={markets as unknown as Record<string, unknown>[]}
            onRowClick={(row) => navigate(`/markets/${row.id}`)}
            emptyMessage="No markets match your filters"
          />
          {pagination.totalPages > 1 && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'center', alignItems: 'center' }}>
              <button disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)} style={btnStyle}>Prev</button>
              <span style={{ color: colors.textSecondary, padding: '6px 12px', fontSize: '13px', fontFamily: fonts.mono }}>
                {pagination.page} / {pagination.totalPages}
              </span>
              <button disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(pagination.page + 1)} style={btnStyle}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  backgroundColor: colors.bgTertiary,
  border: `1px solid ${colors.border}`,
  color: colors.text,
  padding: '8px 12px',
  borderRadius: '6px',
  fontSize: '13px',
  fontFamily: fonts.sans,
  outline: 'none',
};

const btnStyle: React.CSSProperties = {
  ...selectStyle,
  cursor: 'pointer',
  fontFamily: fonts.mono,
  fontSize: '12px',
};
