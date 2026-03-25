import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client';
import { colors, fonts } from '../theme';
import { StatusBadge } from '../components/StatusBadge';
import { CardSkeleton, Skeleton } from '../components/Skeleton';
import { formatVolume, formatCents, formatRelativeTime } from '../utils/format';
import type { MarketDetailResponse, PriceHistoryResponse, OrderBookResponse } from '@apex/shared';

export function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const [market, setMarket] = useState<MarketDetailResponse | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryResponse | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getMarket(id).catch(() => null),
      api.getPriceHistory(id).catch(() => null),
      api.getOrderBook(id).catch(() => null),
    ]).then(([m, p, o]) => {
      setMarket(m);
      setPriceHistory(p);
      setOrderBook(o);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px' }}>
        <Skeleton width="60%" height="28px" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '24px' }}>
          <CardSkeleton height="100px" />
          <CardSkeleton height="100px" />
        </div>
        <div style={{ marginTop: '24px' }}><CardSkeleton height="300px" /></div>
      </div>
    );
  }

  if (!market) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: colors.textMuted }}>
        <Link to="/" style={{ color: colors.accent, textDecoration: 'none' }}>&larr; Back to Markets</Link>
        <p style={{ marginTop: '24px' }}>Market not found</p>
      </div>
    );
  }

  const yesContract = market.contracts.find(c => c.outcome === 'YES');
  const noContract = market.contracts.find(c => c.outcome === 'NO');
  const edge = market.latestEdge;

  const chartData = (priceHistory?.points || []).map(p => ({
    time: new Date(p.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    price: Math.round(p.yesPrice * 100),
  }));

  const statusMap: Record<string, 'up' | 'down' | 'unknown'> = {
    ACTIVE: 'up', CLOSED: 'down', RESOLVED: 'unknown', SUSPENDED: 'down',
  };

  return (
    <div style={{ maxWidth: '1000px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Link to="/" style={{ color: colors.textSecondary, textDecoration: 'none', fontSize: '13px' }}>
            &larr; Back to Markets
          </Link>
          <Link to={`/markets/${id}/signals`} style={{ color: colors.accent, textDecoration: 'none', fontSize: '13px' }}>
            View Signals &rarr;
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
          <h1 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '20px', margin: 0, lineHeight: 1.3 }}>
            {market.title}
          </h1>
          <StatusBadge status={statusMap[market.status] || 'unknown'} label={market.status} />
          <span style={{
            backgroundColor: colors.bgTertiary,
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            color: colors.accent,
            fontFamily: fonts.mono,
          }}>
            {market.platform}
          </span>
        </div>
      </div>

      {/* Info Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Category', value: market.category },
          { label: 'Volume', value: formatVolume(market.volume) },
          { label: 'Liquidity', value: formatVolume(market.liquidity) },
          { label: 'Closes', value: market.closesAt ? formatRelativeTime(market.closesAt) : 'N/A' },
        ].map(item => (
          <div key={item.label} style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '12px',
          }}>
            <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>{item.label}</div>
            <div style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '15px' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Price Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
        <PriceCard label="YES" price={yesContract?.lastPrice} bid={yesContract?.bestBid} ask={yesContract?.bestAsk} color={colors.green} />
        <PriceCard label="NO" price={noContract?.lastPrice} bid={noContract?.bestBid} ask={noContract?.bestAsk} color={colors.red} />
      </div>

      {/* Price Chart */}
      {chartData.length > 1 && (
        <div style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '14px', marginBottom: '16px' }}>Price History</h2>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
              <XAxis dataKey="time" tick={{ fill: colors.textMuted, fontSize: 11 }} stroke={colors.border} />
              <YAxis domain={[0, 100]} tick={{ fill: colors.textMuted, fontSize: 11 }} stroke={colors.border} tickFormatter={(v) => `${v}\u00A2`} />
              <Tooltip
                contentStyle={{ backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`, borderRadius: '6px', fontFamily: fonts.mono, fontSize: '12px' }}
                labelStyle={{ color: colors.textSecondary }}
                itemStyle={{ color: colors.accent }}
                formatter={(v: number) => [`${v}\u00A2`, 'YES Price']}
              />
              <Line type="monotone" dataKey="price" stroke={colors.accent} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Edge Panel */}
      {edge && edge.edgeMagnitude > 0 && (
        <div style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${edge.isActionable ? colors.green : colors.border}`,
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '14px', marginBottom: '16px' }}>
            CORTEX Edge {edge.isActionable && <span style={{ color: colors.green, fontSize: '12px' }}>ACTIONABLE</span>}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px' }}>
            {[
              { label: 'CORTEX Prob', value: `${(edge.cortexProbability * 100).toFixed(1)}%`, color: colors.accent },
              { label: 'Market Price', value: `${(edge.marketPrice * 100).toFixed(1)}%`, color: colors.textSecondary },
              { label: 'Edge', value: `${(edge.edgeMagnitude * 100).toFixed(1)}%`, color: edge.edgeMagnitude > 0.05 ? colors.green : colors.yellow },
              { label: 'Direction', value: edge.edgeDirection, color: edge.edgeDirection === 'BUY_YES' ? colors.green : colors.red },
              { label: 'Confidence', value: `${(edge.confidence * 100).toFixed(0)}%`, color: colors.text },
              { label: 'EV', value: `${(edge.expectedValue * 100).toFixed(2)}%`, color: colors.accent },
            ].map(item => (
              <div key={item.label}>
                <div style={{ color: colors.textMuted, fontSize: '11px', marginBottom: '4px' }}>{item.label}</div>
                <div style={{ color: item.color, fontFamily: fonts.mono, fontSize: '16px', fontWeight: 600 }}>{item.value}</div>
              </div>
            ))}
          </div>
          {edge.signals.length > 0 && (
            <div style={{ marginTop: '16px', borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
              <div style={{ color: colors.textMuted, fontSize: '11px', marginBottom: '8px' }}>Signal Contributions</div>
              {edge.signals.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px' }}>
                  <span style={{ color: colors.accent, fontFamily: fonts.mono }}>{s.moduleId}</span>
                  <span style={{ color: colors.text, fontFamily: fonts.mono }}>{(s.probability * 100).toFixed(1)}% @ {(s.confidence * 100).toFixed(0)}% conf</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Orderbook */}
      {orderBook && orderBook.contracts.length > 0 && (
        <div style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '24px',
        }}>
          <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '14px', marginBottom: '16px' }}>Order Book</h2>
          {orderBook.contracts.map((c, i) => (
            <div key={i} style={{ marginBottom: i < orderBook.contracts.length - 1 ? '16px' : 0 }}>
              <div style={{ color: colors.textSecondary, fontSize: '12px', marginBottom: '8px' }}>{c.outcome}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px', fontFamily: fonts.mono }}>
                <div>
                  <span style={{ color: colors.textMuted }}>Spread: </span>
                  <span style={{ color: colors.text }}>{(c.spread * 100).toFixed(1)}&cent;</span>
                </div>
                <div>
                  <span style={{ color: colors.textMuted }}>Mid: </span>
                  <span style={{ color: colors.text }}>{(c.midPrice * 100).toFixed(1)}&cent;</span>
                </div>
                <div>
                  <span style={{ color: colors.textMuted }}>Depth: </span>
                  <span style={{ color: colors.green }}>{c.totalBidDepth.toFixed(0)}</span>
                  {' / '}
                  <span style={{ color: colors.red }}>{c.totalAskDepth.toFixed(0)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      {market.description && (
        <div style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          padding: '20px',
        }}>
          <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '14px', marginBottom: '12px' }}>Description</h2>
          <p style={{ color: colors.textSecondary, fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {market.description}
          </p>
        </div>
      )}
    </div>
  );
}

function PriceCard({ label, price, bid, ask, color }: {
  label: string;
  price: number | null | undefined;
  bid: number | null | undefined;
  ask: number | null | undefined;
  color: string;
}) {
  return (
    <div style={{
      backgroundColor: colors.bgSecondary,
      border: `1px solid ${color}30`,
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{ color: colors.textMuted, fontSize: '12px', marginBottom: '8px' }}>{label}</div>
      <div style={{ color, fontFamily: fonts.mono, fontSize: '28px', fontWeight: 700 }}>
        {price != null ? `${(price * 100).toFixed(1)}\u00A2` : '\u2014'}
      </div>
      {(bid != null || ask != null) && (
        <div style={{ color: colors.textMuted, fontSize: '11px', fontFamily: fonts.mono, marginTop: '4px' }}>
          Bid {bid != null ? `${(bid * 100).toFixed(1)}` : '-'} / Ask {ask != null ? `${(ask * 100).toFixed(1)}` : '-'}
        </div>
      )}
    </div>
  );
}
