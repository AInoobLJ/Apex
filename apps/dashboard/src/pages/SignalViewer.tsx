import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { CardSkeleton } from '../components/Skeleton';
import { formatPercent, formatRelativeTime } from '../utils/format';
import { colors, fonts } from '../theme';

interface SignalData {
  moduleId: string;
  probability: number;
  confidence: number;
  reasoning: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface CortexData {
  cortexProbability: number;
  marketPrice: number;
  edgeMagnitude: number;
  edgeDirection: string;
  confidence: number;
  expectedValue: number;
  isActionable: boolean;
  conflictFlag: boolean;
}

const MODULE_COLORS: Record<string, string> = {
  COGEX: '#8b5cf6', FLOWEX: '#06b6d4', ARBEX: '#f59e0b',
  LEGEX: '#ef4444', DOMEX: '#22c55e', ALTEX: '#3b82f6',
  SIGINT: '#ec4899', NEXUS: '#a855f7', SPEEDEX: '#f97316', REFLEX: '#14b8a6',
};

export function SignalViewer() {
  const { id } = useParams<{ id: string }>();
  const [signals, setSignals] = useState<SignalData[]>([]);
  const [cortex, setCortex] = useState<CortexData | null>(null);
  const [marketTitle, setMarketTitle] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.getMarketSignals(id),
      api.getMarket(id).catch(() => null),
    ]).then(([sigData, mktData]) => {
      setSignals(sigData.signals as SignalData[]);
      setCortex(sigData.cortex as CortexData | null);
      setMarketTitle(mktData?.title ?? '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ maxWidth: '1000px' }}>
      <CardSkeleton height="40px" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '24px' }}>
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} height="180px" />)}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: '1000px' }}>
      <Link to={`/markets/${id}`} style={{ color: colors.textSecondary, textDecoration: 'none', fontSize: '13px' }}>
        &larr; Back to Market
      </Link>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '18px', marginTop: '8px', marginBottom: '24px', lineHeight: 1.4 }}>
        Signals: {marketTitle}
      </h1>

      {/* CORTEX Synthesis Panel */}
      {cortex && (
        <div style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${cortex.isActionable ? colors.green : colors.border}`,
          borderRadius: '8px', padding: '20px', marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.accent }}>CORTEX Synthesis</h2>
            {cortex.isActionable && <span style={{ color: colors.green, fontSize: '12px', fontWeight: 700 }}>ACTIONABLE</span>}
            {cortex.conflictFlag && <span style={{ color: colors.yellow, fontSize: '12px' }}>CONFLICT</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '16px' }}>
            <Stat label="CORTEX" value={formatPercent(cortex.cortexProbability)} color={colors.accent} />
            <Stat label="Market" value={formatPercent(cortex.marketPrice)} color={colors.textSecondary} />
            <Stat label="Edge" value={formatPercent(cortex.edgeMagnitude)} color={cortex.edgeMagnitude > 0.05 ? colors.green : colors.yellow} />
            <Stat label="Direction" value={cortex.edgeDirection === 'BUY_YES' ? 'YES' : 'NO'} color={cortex.edgeDirection === 'BUY_YES' ? colors.green : colors.red} />
            <Stat label="Confidence" value={formatPercent(cortex.confidence)} color={colors.text} />
            <Stat label="EV" value={formatPercent(cortex.expectedValue)} color={colors.accent} />
          </div>
        </div>
      )}

      {/* Module Signal Grid */}
      {signals.length === 0 ? (
        <div style={{ textAlign: 'center', color: colors.textMuted, padding: '40px' }}>No signals for this market yet</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {signals.map((s, i) => (
            <div key={i} style={{
              backgroundColor: colors.bgSecondary,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${MODULE_COLORS[s.moduleId] || colors.accent}`,
              borderRadius: '8px', padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontFamily: fonts.mono, fontSize: '13px', color: MODULE_COLORS[s.moduleId] || colors.accent, fontWeight: 700 }}>
                  {s.moduleId}
                </span>
                <span style={{ color: colors.textMuted, fontSize: '11px' }}>{formatRelativeTime(s.createdAt)}</span>
              </div>

              {/* Probability gauge */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: colors.textMuted, fontSize: '11px' }}>Probability</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: '16px', fontWeight: 700, color: colors.text }}>
                    {formatPercent(s.probability)}
                  </span>
                </div>
                <div style={{ height: '6px', backgroundColor: colors.bgTertiary, borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${s.probability * 100}%`, height: '100%',
                    backgroundColor: MODULE_COLORS[s.moduleId] || colors.accent,
                    borderRadius: '3px', transition: 'width 0.3s',
                  }} />
                </div>
              </div>

              {/* Confidence bar */}
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: colors.textMuted, fontSize: '11px' }}>Confidence</span>
                  <span style={{ fontFamily: fonts.mono, fontSize: '12px', color: colors.textSecondary }}>
                    {formatPercent(s.confidence)}
                  </span>
                </div>
                <div style={{ height: '4px', backgroundColor: colors.bgTertiary, borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${s.confidence * 100}%`, height: '100%',
                    backgroundColor: colors.textSecondary, borderRadius: '2px',
                  }} />
                </div>
              </div>

              {/* Module-specific context */}
              {s.metadata && (
                <ModuleContext moduleId={s.moduleId} metadata={s.metadata} />
              )}

              {/* Reasoning */}
              <ReasoningBlock reasoning={s.reasoning} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ color: colors.textMuted, fontSize: '11px', marginBottom: '2px' }}>{label}</div>
      <div style={{ color, fontFamily: fonts.mono, fontSize: '16px', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function ModuleContext({ moduleId, metadata }: { moduleId: string; metadata: Record<string, unknown> }) {
  const pills: { label: string; value: string; color: string }[] = [];

  if (moduleId === 'LEGEX') {
    if (metadata.ambiguityScore) pills.push({ label: 'Ambiguity', value: `${metadata.ambiguityScore}/5`, color: colors.orange });
    if (metadata.adjustmentDirection && metadata.adjustmentDirection !== 'NONE')
      pills.push({ label: 'Shift', value: `${metadata.adjustmentDirection === 'TOWARD_YES' ? '+' : '-'}${((metadata.adjustment as number || 0) * 100).toFixed(1)}%`, color: colors.yellow });
  } else if (moduleId === 'DOMEX') {
    if (metadata.agentCount) pills.push({ label: 'Agents', value: String(metadata.agentCount), color: colors.accent });
    if (metadata.agreement != null) pills.push({ label: 'Agreement', value: `${((metadata.agreement as number) * 100).toFixed(0)}%`, color: (metadata.agreement as number) > 0.7 ? colors.green : colors.yellow });
  } else if (moduleId === 'ALTEX') {
    if (metadata.direction) pills.push({ label: 'News', value: metadata.direction as string, color: metadata.direction === 'TOWARD_YES' ? colors.green : colors.red });
    if (metadata.likelyPricedIn != null) pills.push({ label: 'Priced In', value: `${((metadata.likelyPricedIn as number) * 100).toFixed(0)}%`, color: colors.textSecondary });
  } else if (moduleId === 'COGEX') {
    const adj = metadata.adjustments as Record<string, number> | undefined;
    if (adj) {
      const biases = Object.entries(adj).filter(([, v]) => Math.abs(v) > 0.01);
      biases.forEach(([k, v]) => pills.push({ label: k, value: `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`, color: colors.accent }));
    }
  } else if (moduleId === 'FLOWEX') {
    if (metadata.moveClassification) pills.push({ label: 'Move', value: metadata.moveClassification as string, color: metadata.moveClassification === 'INFORMATION' ? colors.red : colors.textSecondary });
    if (metadata.orderFlowImbalance != null) pills.push({ label: 'OFI', value: (metadata.orderFlowImbalance as number).toFixed(2), color: colors.accent });
  }

  if (pills.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
      {pills.map((p, i) => (
        <span key={i} style={{
          padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontFamily: fonts.mono,
          backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`,
          color: p.color,
        }}>
          {p.label}: {p.value}
        </span>
      ))}
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = reasoning.length > 150;
  const display = expanded || !isLong ? reasoning : reasoning.slice(0, 150) + '...';

  return (
    <div>
      <div style={{ color: colors.textSecondary, fontSize: '12px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {display}
      </div>
      {isLong && (
        <button onClick={() => setExpanded(!expanded)} style={{
          background: 'none', border: 'none', color: colors.accent, fontSize: '11px',
          cursor: 'pointer', padding: '2px 0', marginTop: '2px',
        }}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
