import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { TableSkeleton } from '../components/Skeleton';
import { useDebounce } from '../hooks/useDebounce';
import { colors, fonts } from '../theme';

const CATEGORIES = ['', 'POLITICS', 'FINANCE', 'CRYPTO', 'SCIENCE', 'SPORTS', 'CULTURE', 'OTHER'];
const PLATFORMS = ['', 'KALSHI', 'POLYMARKET'];
const SORT_OPTIONS = [
  { value: 'capitalEfficiency', label: 'Cap Efficiency' },
  { value: 'edgeMagnitude', label: 'Edge Size' },
  { value: 'expectedValue', label: 'Expected Value' },
  { value: 'confidence', label: 'Confidence' },
];

const MODULE_COLORS: Record<string, string> = {
  COGEX: '#8b5cf6', FLOWEX: '#06b6d4', ARBEX: '#f59e0b',
  LEGEX: '#ef4444', DOMEX: '#22c55e', ALTEX: '#3b82f6',
};

function formatTTR(days: number): string {
  if (days <= 0) return '<1d';
  if (days <= 7) return `${days}d`;
  if (days <= 30) return `${Math.round(days / 7)}w`;
  if (days <= 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

interface SignalContrib {
  moduleId: string;
  probability: number;
  confidence: number;
  weight: number;
  reasoning: string;
}

interface EdgeRow {
  marketId: string;
  marketTitle: string;
  platform: string;
  category: string;
  cortexProbability: number;
  marketPrice: number;
  edgeMagnitude: number;
  edgeDirection: string;
  confidence: number;
  expectedValue: number;
  signals: SignalContrib[];
  isActionable: boolean;
  conflictFlag: boolean;
  daysToResolution: number;
  capitalEfficiency: number;
}

export function Edges() {
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [platform, setPlatform] = useState('');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState('capitalEfficiency');
  const [minEV, setMinEV] = useState(0);
  const [hideExtreme, setHideExtreme] = useState(true);
  const debouncedMinEV = useDebounce(minEV, 300);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    const query: Record<string, unknown> = { sort: sortBy, direction: 'desc', limit: 50 };
    if (platform) query.platform = platform;
    if (category) query.category = category;
    if (debouncedMinEV > 0) query.minExpectedValue = (debouncedMinEV / 100).toString();

    api.listEdges(query)
      .then(res => setEdges(res.data as unknown as EdgeRow[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [platform, category, debouncedMinEV, sortBy]);

  const filteredEdges = hideExtreme
    ? edges.filter(e => e.marketPrice >= 0.05 && e.marketPrice <= 0.95)
    : edges;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const summarizeEdge = (edge: EdgeRow): string => {
    const sigs = (edge.signals || []).filter(s => s.weight > 0);
    if (sigs.length === 0) return 'No module signals';
    return sigs.map(s => {
      const short = s.reasoning.split('.')[0].slice(0, 80);
      return `${s.moduleId}: ${short}`;
    }).join(' + ');
  };

  const GRID = '28px 70px 1fr 42px 58px 58px 52px 42px 48px 52px 48px';

  return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '16px' }}>
        Edge Ranking <span style={{ color: colors.textMuted, fontSize: '14px' }}>({filteredEdges.length}{hideExtreme && filteredEdges.length !== edges.length ? ` / ${edges.length}` : ''})</span>
      </h1>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={selectStyle}>
          <option value="">All Platforms</option>
          {PLATFORMS.filter(Boolean).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
          <option value="">All Categories</option>
          {CATEGORIES.filter(Boolean).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: colors.textSecondary, fontSize: '12px', whiteSpace: 'nowrap' }}>Min EV:</span>
          <input type="range" min={0} max={20} step={0.5} value={minEV}
            onChange={(e) => setMinEV(Number(e.target.value))}
            style={{ width: '120px', accentColor: colors.accent }} />
          <span style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: '12px', minWidth: '40px' }}>
            {minEV.toFixed(1)}%
          </span>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: colors.textSecondary }}>
          <input type="checkbox" checked={hideExtreme} onChange={() => setHideExtreme(!hideExtreme)}
            style={{ accentColor: colors.accent }} />
          Hide extreme (&lt;5%, &gt;95%)
        </label>
      </div>

      {loading ? <TableSkeleton rows={10} columns={11} /> : (
        <div>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: '4px', padding: '8px 12px', borderBottom: `1px solid ${colors.border}`, fontSize: '10px', color: colors.textSecondary, textTransform: 'uppercase', fontWeight: 500 }}>
            <span></span><span>Platform</span><span>Market</span><span>Dir</span>
            <span style={{ textAlign: 'right' }}>CORTEX</span><span style={{ textAlign: 'right' }}>Market</span>
            <span style={{ textAlign: 'right' }}>Edge</span>
            <span style={{ textAlign: 'right' }}>TTR</span>
            <span style={{ textAlign: 'right' }}>Cap Eff</span>
            <span style={{ textAlign: 'right' }}>Conf</span><span style={{ textAlign: 'right' }}>EV</span>
          </div>

          {filteredEdges.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: colors.textMuted }}>No edges match your filters</div>
          ) : filteredEdges.map(edge => {
            const isOpen = expanded.has(edge.marketId);
            const sigs = (edge.signals || []).filter(s => s.weight > 0);
            const accentColor = edge.expectedValue >= 0.05 ? colors.green : edge.expectedValue >= 0.03 ? colors.yellow : undefined;
            const ttr = edge.daysToResolution ?? 365;
            const capEff = edge.capitalEfficiency ?? 0;

            return (
              <div key={edge.marketId} style={{ borderBottom: `1px solid ${colors.border}30`, borderLeft: accentColor ? `3px solid ${accentColor}` : '3px solid transparent' }}>
                {/* Main row */}
                <div
                  style={{ display: 'grid', gridTemplateColumns: GRID, gap: '4px', padding: '10px 12px', alignItems: 'center', cursor: 'pointer', fontSize: '13px', fontFamily: fonts.mono, transition: 'background 0.1s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.bgTertiary)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span onClick={(e) => { e.stopPropagation(); toggle(edge.marketId); }}
                    style={{ cursor: 'pointer', color: colors.textMuted, fontSize: '10px', userSelect: 'none' }}>
                    {sigs.length > 0 ? (isOpen ? '\u25BC' : '\u25B6') : ''}
                  </span>
                  <span style={{ fontSize: '10px', color: colors.accent }}>{edge.platform === 'POLYMARKET' ? 'POLY' : edge.platform}</span>
                  <span onClick={() => navigate(`/markets/${edge.marketId}`)} style={{ color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                    {edge.marketTitle}
                  </span>
                  <span style={{ color: edge.edgeDirection === 'BUY_YES' ? colors.green : colors.red, fontWeight: 700, fontSize: '12px' }}>
                    {edge.edgeDirection === 'BUY_YES' ? 'YES' : 'NO'}
                  </span>
                  <span style={{ textAlign: 'right' }}>{(edge.cortexProbability * 100).toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: colors.textSecondary }}>{(edge.marketPrice * 100).toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: colors.green, fontWeight: 700 }}>{(edge.edgeMagnitude * 100).toFixed(1)}%</span>
                  <span style={{ textAlign: 'right', color: ttr <= 7 ? colors.red : ttr <= 30 ? colors.yellow : colors.textMuted, fontSize: '11px' }}>
                    {formatTTR(ttr)}
                  </span>
                  <span style={{ textAlign: 'right', color: capEff >= 0.02 ? colors.green : capEff >= 0.005 ? colors.yellow : colors.textMuted, fontWeight: 600, fontSize: '11px' }}>
                    {(capEff * 100).toFixed(1)}
                  </span>
                  <span style={{ textAlign: 'right' }}>{(edge.confidence * 100).toFixed(0)}%</span>
                  <span style={{ textAlign: 'right', color: edge.expectedValue >= 0.05 ? colors.green : edge.expectedValue >= 0.03 ? colors.yellow : colors.textSecondary, fontWeight: 700 }}>
                    {(edge.expectedValue * 100).toFixed(2)}%
                  </span>
                </div>

                {/* Expanded reasoning */}
                {isOpen && sigs.length > 0 && (
                  <div style={{ padding: '0 12px 12px 40px', fontSize: '12px' }}>
                    {/* One-line summary */}
                    <div style={{ color: colors.textSecondary, marginBottom: '8px', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {summarizeEdge(edge)}
                    </div>

                    {/* Per-module breakdown */}
                    {sigs.map((s, i) => {
                      const agreesWithEdge =
                        (edge.edgeDirection === 'BUY_YES' && s.probability > edge.marketPrice) ||
                        (edge.edgeDirection === 'BUY_NO' && s.probability < edge.marketPrice);

                      return (
                        <div key={i} style={{
                          padding: '8px 10px', marginBottom: '4px', borderRadius: '4px',
                          backgroundColor: colors.bgTertiary,
                          borderLeft: `3px solid ${MODULE_COLORS[s.moduleId] || colors.accent}`,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontFamily: fonts.mono, fontWeight: 700, color: MODULE_COLORS[s.moduleId] || colors.accent, fontSize: '11px' }}>
                              {s.moduleId}
                            </span>
                            <span style={{ fontFamily: fonts.mono, fontSize: '11px' }}>
                              <span style={{ color: agreesWithEdge ? colors.green : colors.red }}>{(s.probability * 100).toFixed(1)}%</span>
                              <span style={{ color: colors.textMuted }}> @ {(s.confidence * 100).toFixed(0)}% conf</span>
                              <span style={{ color: colors.textMuted }}> (w: {(s.weight * 100).toFixed(0)}%)</span>
                            </span>
                          </div>
                          <div style={{ color: colors.textSecondary, lineHeight: 1.5, fontSize: '11px' }}>
                            {s.reasoning.slice(0, 250)}{s.reasoning.length > 250 ? '...' : ''}
                          </div>
                        </div>
                      );
                    })}

                    {edge.conflictFlag && (
                      <div style={{ color: colors.yellow, fontSize: '11px', marginTop: '4px' }}>
                        {'\u26A0'} Module conflict detected — signals disagree by &gt;20%
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
