import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../theme';
import { CardSkeleton } from '../components/Skeleton';
import { api } from '../api/client';

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
  const [bracketGroups, setBracketGroups] = useState<any>(null);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchBracketGroups = () => {
    api.getBracketGroups()
      .then(setBracketGroups)
      .catch(() => setBracketGroups(null));
  };

  const openDetail = (marketId: string) => {
    if (selectedMarket === marketId) { setSelectedMarket(null); setDetail(null); return; }
    setSelectedMarket(marketId);
    setDetailLoading(true);
    api.getCryptoMarketDetail(marketId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  };

  const fetchData = () => {
    apiFetch('/crypto/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    fetchBracketGroups();
    if (!autoRefresh) return;
    const interval = setInterval(() => { fetchData(); fetchBracketGroups(); }, 30000);
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

  if (!data || data.error) return <div style={{ color: colors.textMuted }}>Failed to load crypto data</div>;

  const { spotPrices, volatility, kalshiCrypto, stats = { withTradeableEdge: 0, atmContracts: 0, totalKalshiCrypto: 0, avgEdgeATM: 0 } } = data;

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
        {/* DVOL + Regime cards */}
        {volatility && Object.keys(volatility).length > 0 && Object.entries(volatility as Record<string, any>).map(([sym, v]) => v && v.dvol && (
          <div key={`dvol-${sym}`} style={{
            backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
            borderRadius: '8px', padding: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: fonts.mono, color: colors.yellow, fontSize: '13px', fontWeight: 700 }}>{sym} DVOL</span>
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '3px',
                color: v.regime === 'COMPRESSED' ? colors.yellow : v.regime === 'EXPANDING' ? colors.red : v.regime === 'EXHAUSTION' ? colors.accent : colors.textMuted,
                backgroundColor: (v.regime === 'COMPRESSED' ? colors.yellow : v.regime === 'EXPANDING' ? colors.red : v.regime === 'EXHAUSTION' ? colors.accent : colors.textMuted) + '15',
              }}>{v.regime || 'NORMAL'}</span>
            </div>
            <div style={{ fontFamily: fonts.mono, fontSize: '22px', fontWeight: 700, color: colors.text, marginTop: '4px' }}>
              {v.dvol.toFixed(1)}%
            </div>
            <div style={{ color: colors.textMuted, fontSize: '11px' }}>
              {'\u00b1'}{v.expectedDailyMove?.toFixed(1) ?? '?'}% daily
              {v.variancePremium != null && (
                <span style={{ marginLeft: '6px', color: v.variancePremium > 10 ? colors.yellow : colors.textMuted }}>
                  VP: {v.variancePremium > 0 ? '+' : ''}{v.variancePremium.toFixed(0)}%
                </span>
              )}
            </div>
          </div>
        ))}
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

      {/* Bracket Group Summary */}
      {bracketGroups && bracketGroups.groups.length > 0 && (
        <div style={{
          marginBottom: '16px', padding: '12px 16px',
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`,
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '8px', fontWeight: 600 }}>
            Bracket Position Groups
            {bracketGroups.conflictGroups > 0 && (
              <span style={{ color: colors.red, marginLeft: '8px', textTransform: 'none' }}>
                ({bracketGroups.conflictGroups} conflict{bracketGroups.conflictGroups > 1 ? 's' : ''})
              </span>
            )}
          </div>
          {bracketGroups.groups.map((g: any) => (
            <div key={`${g.asset}-${g.expiry}`} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '8px 12px', marginBottom: '4px', borderRadius: '6px',
              backgroundColor: g.isNegativeEV ? colors.red + '10' : colors.bgTertiary,
              borderLeft: `3px solid ${g.isNegativeEV ? colors.red : colors.yellow}`,
              fontFamily: fonts.mono, fontSize: '12px',
            }}>
              <span style={{ color: colors.accent, fontWeight: 700, minWidth: '60px' }}>{g.asset}</span>
              <span style={{ color: colors.textSecondary, minWidth: '100px' }}>{g.expiry}</span>
              <span style={{ color: colors.textMuted }}>{g.positionCount} positions</span>
              <span style={{ color: colors.text }}>cost: {g.combinedCostCents}c</span>
              <span style={{ color: colors.textMuted }}>max: {g.maxPayoutCents}c</span>
              <span style={{ color: g.isNegativeEV ? colors.red : colors.green, fontWeight: 700 }}>
                EV: {g.combinedEVCents}c
              </span>
              {g.isNegativeEV && (
                <span style={{ color: colors.red, fontSize: '11px' }}>-EV CONFLICT</span>
              )}
            </div>
          ))}
        </div>
      )}

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
                const isSelected = selectedMarket === m.id;

                return (
                  <React.Fragment key={m.id}>
                  <tr
                    onClick={() => openDetail(m.id)}
                    style={{
                      borderBottom: `1px solid ${colors.border}15`,
                      backgroundColor: isSelected ? colors.accent + '15' : m.tradeable ? colors.green + '08' : 'transparent',
                      opacity: m.moneyness !== 'ATM' && moneynessFilter === 'ALL' ? 0.5 : 1,
                      cursor: 'pointer',
                    }}
                  >
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
                  {isSelected && (
                    <tr>
                      <td colSpan={11} style={{ padding: 0, borderBottom: `1px solid ${colors.border}` }}>
                        <CryptoDetailPanel detail={detail} loading={detailLoading} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
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

const MODULE_COLORS: Record<string, string> = {
  SPEEDEX: '#f59e0b', COGEX: '#8b5cf6', FLOWEX: '#06b6d4',
  DOMEX: '#22c55e', LEGEX: '#ef4444', ALTEX: '#3b82f6', ARBEX: '#f97316',
};

function CryptoDetailPanel({ detail, loading }: { detail: any; loading: boolean }) {
  if (loading) return <div style={{ padding: '20px', color: colors.textMuted, fontFamily: fonts.mono, fontSize: '12px' }}>Loading...</div>;
  if (!detail) return <div style={{ padding: '20px', color: colors.textMuted, fontFamily: fonts.mono, fontSize: '12px' }}>Failed to load detail</div>;

  const { market, pricing, signals, edge, positions } = detail;
  const pStyle: React.CSSProperties = { margin: '2px 0', fontSize: '12px', fontFamily: fonts.mono };
  const labelStyle: React.CSSProperties = { color: colors.textMuted, display: 'inline-block', width: '130px' };

  return (
    <div style={{ padding: '16px 20px', backgroundColor: colors.bgTertiary }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
        {/* Pricing Analysis */}
        <div>
          <div style={{ fontSize: '11px', color: colors.accent, fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Pricing Analysis</div>
          <p style={pStyle}><span style={labelStyle}>Market Price</span> {pricing.marketPrice > 0 ? `${(pricing.marketPrice * 100).toFixed(1)}\u00a2` : '--'}</p>
          <p style={pStyle}><span style={labelStyle}>Spot Price</span> ${pricing.spotPrice?.toLocaleString() ?? '--'}</p>
          <p style={pStyle}><span style={labelStyle}>Strike</span> ${pricing.strike?.toLocaleString() ?? '--'}</p>
          <p style={pStyle}><span style={labelStyle}>Type</span> {pricing.contractType}{pricing.bracketWidth ? ` ($${pricing.bracketWidth.toLocaleString()} wide)` : ''}</p>
          <p style={pStyle}><span style={labelStyle}>Implied Prob</span> <span style={{ color: colors.text, fontWeight: 600 }}>{pricing.impliedProb != null ? `${(pricing.impliedProb * 100).toFixed(1)}%` : '--'}</span></p>
          <p style={pStyle}><span style={labelStyle}>Raw Edge</span> {pricing.rawEdge != null ? `${(pricing.rawEdge * 100).toFixed(1)}%` : '--'}</p>
          <p style={pStyle}><span style={labelStyle}>Edge After Fees</span> <span style={{ color: (pricing.edgeAfterFees ?? 0) > 0.05 ? colors.green : colors.textSecondary, fontWeight: 700 }}>{pricing.edgeAfterFees != null ? `${(pricing.edgeAfterFees * 100).toFixed(1)}%` : '--'}</span></p>
          <p style={pStyle}><span style={labelStyle}>Direction</span> <span style={{ color: pricing.direction === 'BUY_YES' ? colors.green : pricing.direction === 'BUY_NO' ? colors.red : colors.textMuted }}>{pricing.direction ?? '--'}</span></p>
          <p style={pStyle}><span style={labelStyle}>Time to Expiry</span> {formatTime(pricing.hoursToResolution)}</p>
        </div>

        {/* Signals */}
        <div>
          <div style={{ fontSize: '11px', color: colors.accent, fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>Module Signals ({signals.length})</div>
          {signals.length === 0 && <p style={{ ...pStyle, color: colors.textMuted }}>No signals yet</p>}
          {signals.map((s: any) => (
            <div key={s.moduleId} style={{
              padding: '6px 8px', marginBottom: '4px', borderRadius: '4px',
              backgroundColor: colors.bgSecondary, borderLeft: `3px solid ${MODULE_COLORS[s.moduleId] || colors.border}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: MODULE_COLORS[s.moduleId] || colors.text, fontWeight: 700, fontSize: '11px', fontFamily: fonts.mono }}>{s.moduleId}</span>
                <span style={{ fontFamily: fonts.mono, fontSize: '11px', color: colors.text }}>{(s.probability * 100).toFixed(1)}% @ {(s.confidence * 100).toFixed(0)}%</span>
              </div>
              {s.reasoning && <div style={{ fontSize: '10px', color: colors.textMuted, marginTop: '3px', lineHeight: '1.3' }}>{s.reasoning.slice(0, 120)}</div>}
            </div>
          ))}
        </div>

        {/* Edge + Positions */}
        <div>
          <div style={{ fontSize: '11px', color: colors.accent, fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }}>CORTEX Edge</div>
          {edge ? (
            <>
              <p style={pStyle}><span style={labelStyle}>Composite Prob</span> {(edge.compositeProb * 100).toFixed(1)}%</p>
              <p style={pStyle}><span style={labelStyle}>Edge</span> <span style={{ color: colors.green, fontWeight: 700 }}>{(edge.edgeMagnitude * 100).toFixed(1)}%</span></p>
              <p style={pStyle}><span style={labelStyle}>Direction</span> <span style={{ color: edge.edgeDirection === 'BUY_YES' ? colors.green : colors.red }}>{edge.edgeDirection}</span></p>
              <p style={pStyle}><span style={labelStyle}>Confidence</span> {(edge.confidence * 100).toFixed(0)}%</p>
              <p style={pStyle}><span style={labelStyle}>EV</span> {(edge.expectedValue * 100).toFixed(2)}%</p>
              <p style={pStyle}><span style={labelStyle}>Actionable</span> <span style={{ color: edge.isActionable ? colors.green : colors.red }}>{edge.isActionable ? 'YES' : 'NO'}</span></p>
            </>
          ) : <p style={{ ...pStyle, color: colors.textMuted }}>No edge computed yet</p>}

          {positions.length > 0 && (
            <>
              <div style={{ fontSize: '11px', color: colors.accent, fontWeight: 700, textTransform: 'uppercase', marginTop: '12px', marginBottom: '6px' }}>Positions ({positions.length})</div>
              {positions.map((p: any) => (
                <div key={p.id} style={{ ...pStyle, padding: '4px 0' }}>
                  <span style={{ color: p.direction === 'BUY_YES' ? colors.green : colors.red, fontWeight: 700 }}>{p.direction === 'BUY_YES' ? 'YES' : 'NO'}</span>
                  {' @ '}{(p.entryPrice * 100).toFixed(1)}{'\u00a2'}
                  {' → '}{(p.currentPrice * 100).toFixed(1)}{'\u00a2'}
                  {' P&L: '}<span style={{ color: p.pnl >= 0 ? colors.green : colors.red }}>${p.pnl?.toFixed(2)}</span>
                  {p.isOpen ? '' : ' (closed)'}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
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
