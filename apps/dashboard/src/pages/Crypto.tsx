import { useState, useEffect } from 'react';
import { colors, fonts } from '../theme';
import { CardSkeleton } from '../components/Skeleton';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || '';

const apiFetch = async (path: string) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-API-Key': API_KEY },
  });
  return res.json();
};

interface CryptoMarket {
  id: string;
  ticker: string;
  title: string;
  closesAt: string;
  hoursRemaining: number | null;
  marketPrice: number;
  asset: string | null;
  strike: number | null;
  spotPrice: number | null;
  impliedProb: number | null;
  rawEdge: number | null;
  edgeAfterFees: number | null;
  moneyness: 'ITM' | 'ATM' | 'OTM' | null;
  contractType: 'BRACKET' | 'FLOOR' | 'UNKNOWN';
  bracketWidth: number | null;
  distanceFromStrike: number | null;
  speedexSignal: { probability: number; confidence: number; reasoning: string } | null;
  arbexSignal: { probability: number; confidence: number; reasoning: string } | null;
  cryptexSignal: { probability: number; confidence: number; reasoning: string } | null;
  volume: number;
  tradeable: boolean;
}

export function Crypto() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [assetFilter, setAssetFilter] = useState<string>('ALL');
  const [moneynessFilter, setMoneynessFilter] = useState<string>('ATM');
  const [contractTypeFilter, setContractTypeFilter] = useState<string>('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchData = () => {
    apiFetch('/crypto/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading) return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>Crypto Markets</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
      </div>
      <CardSkeleton height="400px" />
    </div>
  );

  if (!data) return <div style={{ color: colors.textMuted }}>Failed to load crypto data</div>;

  const { spotPrices, kalshiCrypto, stats } = data;

  // Apply filters
  let filtered: CryptoMarket[] = kalshiCrypto || [];
  if (assetFilter !== 'ALL') filtered = filtered.filter(m => m.asset === assetFilter);
  if (moneynessFilter !== 'ALL') filtered = filtered.filter(m => m.moneyness === moneynessFilter);
  if (contractTypeFilter !== 'ALL') filtered = filtered.filter(m => m.contractType === contractTypeFilter);

  return (
    <div style={{ maxWidth: '1200px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ fontFamily: fonts.mono, fontSize: '20px' }}>
          Crypto Markets
          <span style={{ color: colors.textMuted, fontSize: '13px', marginLeft: '8px' }}>
            ({filtered.length} contracts)
          </span>
        </h1>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          style={{
            ...btnStyle,
            backgroundColor: autoRefresh ? colors.green + '20' : 'transparent',
            borderColor: autoRefresh ? colors.green : colors.border,
            color: autoRefresh ? colors.green : colors.textMuted,
          }}
        >
          {autoRefresh ? '\u25cf Live (30s)' : '\u25cb Paused'}
        </button>
      </div>

      {/* Spot Price Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {Object.values(spotPrices || {}).map((p: any) => (
          <div key={p.symbol} style={{
            backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
            borderRadius: '8px', padding: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: fonts.mono, color: colors.accent, fontSize: '14px', fontWeight: 700 }}>{p.symbol}</span>
              <span style={{
                fontSize: '11px', fontFamily: fonts.mono,
                color: p.change24h >= 0 ? colors.green : colors.red,
              }}>
                {p.change24h >= 0 ? '+' : ''}{p.change24h.toFixed(2)}%
              </span>
            </div>
            <div style={{ fontFamily: fonts.mono, fontSize: '22px', fontWeight: 700, color: colors.text, marginTop: '4px' }}>
              ${p.price.toLocaleString(undefined, { maximumFractionDigits: p.price > 1000 ? 0 : 2 })}
            </div>
          </div>
        ))}
        {/* Stats card */}
        <div style={{
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
          borderRadius: '8px', padding: '16px',
        }}>
          <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase' }}>Tradeable Edges</div>
          <div style={{ fontFamily: fonts.mono, fontSize: '22px', fontWeight: 700, color: stats.withTradeableEdge > 0 ? colors.green : colors.textSecondary, marginTop: '4px' }}>
            {stats.withTradeableEdge}
          </div>
          <div style={{ color: colors.textMuted, fontSize: '11px' }}>
            of {stats.atmContracts} ATM | total: {stats.totalKalshiCrypto}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        {['ALL', 'BTC', 'ETH', 'SOL'].map(a => (
          <button key={a} onClick={() => setAssetFilter(a)} style={{
            ...btnStyle,
            backgroundColor: assetFilter === a ? colors.accent + '20' : 'transparent',
            borderColor: assetFilter === a ? colors.accent : colors.border,
            color: assetFilter === a ? colors.accent : colors.textSecondary,
          }}>
            {a}
          </button>
        ))}
        <span style={{ color: colors.border, margin: '0 4px' }}>|</span>
        {['ALL', 'FLOOR', 'BRACKET'].map(ct => (
          <button key={ct} onClick={() => setContractTypeFilter(ct)} style={{
            ...btnStyle, padding: '4px 10px', fontSize: '11px',
            backgroundColor: contractTypeFilter === ct ? colors.accent + '20' : 'transparent',
            borderColor: contractTypeFilter === ct ? colors.accent : colors.border,
            color: contractTypeFilter === ct ? colors.accent : colors.textSecondary,
          }}>
            {ct === 'FLOOR' ? 'Floor' : ct === 'BRACKET' ? 'Bracket' : 'All Types'}
          </button>
        ))}
        <span style={{ color: colors.border, margin: '0 4px' }}>|</span>
        {['ATM', 'ALL', 'ITM', 'OTM'].map(m => (
          <button key={m} onClick={() => setMoneynessFilter(m)} style={{
            ...btnStyle, padding: '4px 10px', fontSize: '11px',
            backgroundColor: moneynessFilter === m ? colors.accent + '20' : 'transparent',
            borderColor: moneynessFilter === m ? colors.accent : colors.border,
            color: moneynessFilter === m ? colors.accent : colors.textSecondary,
          }}>
            {m}
          </button>
        ))}
      </div>

      {/* Markets Table */}
      {filtered.length > 0 ? (
        <div style={{
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
          borderRadius: '8px', overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.mono, fontSize: '12px' }}>
            <thead>
              <tr>
                {['Asset', 'Strike', 'Spot', 'Dist', 'Contract', 'Money', 'Market', 'Implied', 'Edge', 'Time', 'Vol'].map(h => (
                  <th key={h} style={{
                    textAlign: 'left', padding: '10px 6px', color: colors.textMuted,
                    fontSize: '10px', textTransform: 'uppercase',
                    borderBottom: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgTertiary,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((m: CryptoMarket) => {
                const edge = m.edgeAfterFees ?? 0;
                const edgeColor = m.tradeable ? colors.green : edge > 0.02 ? colors.yellow : colors.textMuted;
                const mColor = m.moneyness === 'ATM' ? colors.accent : m.moneyness === 'ITM' ? colors.green : colors.red;
                const distPct = m.distanceFromStrike != null ? (m.distanceFromStrike * 100).toFixed(1) : '—';

                return (
                  <tr key={m.id} style={{
                    borderBottom: `1px solid ${colors.border}15`,
                    backgroundColor: m.tradeable ? colors.green + '08' : 'transparent',
                    opacity: m.moneyness !== 'ATM' && moneynessFilter === 'ALL' ? 0.5 : 1,
                  }}>
                    <td style={{ padding: '7px 6px', color: colors.accent, fontWeight: 700 }}>
                      {m.asset || '?'}
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      ${m.strike?.toLocaleString() || '—'}
                    </td>
                    <td style={{ padding: '7px 6px', color: colors.text }}>
                      ${m.spotPrice?.toLocaleString(undefined, { maximumFractionDigits: m.spotPrice && m.spotPrice > 1000 ? 0 : 2 }) || '—'}
                    </td>
                    <td style={{ padding: '7px 6px', color: colors.textMuted, fontSize: '11px' }}>
                      {distPct}%
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      <span style={{
                        color: m.contractType === 'BRACKET' ? colors.yellow : colors.accent,
                        fontSize: '10px', fontWeight: 700,
                        padding: '2px 4px', borderRadius: '3px',
                        backgroundColor: (m.contractType === 'BRACKET' ? colors.yellow : colors.accent) + '15',
                      }}>
                        {m.contractType === 'BRACKET' ? 'BKT' : m.contractType === 'FLOOR' ? 'FLR' : '?'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      <span style={{
                        color: mColor, fontSize: '10px', fontWeight: 700,
                        padding: '2px 4px', borderRadius: '3px',
                        backgroundColor: mColor + '15',
                      }}>
                        {m.moneyness || '?'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 6px' }}>
                      {m.marketPrice > 0 ? `${(m.marketPrice * 100).toFixed(1)}\u00a2` : '—'}
                    </td>
                    <td style={{ padding: '7px 6px', color: colors.textSecondary }}>
                      {m.impliedProb != null ? `${(m.impliedProb * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ padding: '7px 6px', color: edgeColor, fontWeight: edge >= 0.05 ? 700 : 400 }}>
                      {edge >= 0.05 ? `${(edge * 100).toFixed(1)}%` : '—'}
                      {m.tradeable && <span style={{ marginLeft: '3px', fontSize: '9px' }}>&#x2713;</span>}
                    </td>
                    <td style={{ padding: '7px 6px', color: (m.hoursRemaining ?? 999) < 6 ? colors.yellow : colors.textMuted, fontSize: '11px' }}>
                      {m.hoursRemaining != null ? formatTime(m.hoursRemaining) : '—'}
                    </td>
                    <td style={{ padding: '7px 6px', color: (m.volume ?? 0) >= 500 ? colors.textSecondary : colors.textMuted + '60', fontSize: '11px' }}>
                      {m.volume > 0 ? `$${m.volume >= 1000 ? `${(m.volume / 1000).toFixed(1)}K` : m.volume}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{
          padding: '60px', textAlign: 'center', color: colors.textMuted,
          backgroundColor: colors.bgSecondary, borderRadius: '8px', border: `1px solid ${colors.border}`,
        }}>
          <div style={{ fontSize: '14px', marginBottom: '8px' }}>No {moneynessFilter !== 'ALL' ? moneynessFilter : ''} crypto contracts found</div>
          <div style={{ fontSize: '12px' }}>
            {moneynessFilter === 'ATM' ? 'No strikes within 3% of spot price. Try showing All contracts.' : 'Run a market sync to ingest Kalshi crypto series. Contracts < 5 min to expiry are hidden.'}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px', fontSize: '12px', fontFamily: fonts.mono,
  backgroundColor: 'transparent', color: colors.textSecondary,
  border: `1px solid ${colors.border}`, borderRadius: '6px',
  cursor: 'pointer',
};
