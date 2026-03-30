import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { CardSkeleton } from '../components/Skeleton';
import { formatPercent, formatRelativeTime, formatCents, formatVolume } from '../utils/format';
import { colors, fonts } from '../theme';

const MODULE_COLORS: Record<string, string> = {
  COGEX: '#8b5cf6', FLOWEX: '#06b6d4', ARBEX: '#f59e0b',
  LEGEX: '#ef4444', DOMEX: '#22c55e', ALTEX: '#3b82f6',
  SIGINT: '#ec4899', NEXUS: '#a855f7', SPEEDEX: '#f97316', REFLEX: '#14b8a6',
  CRYPTEX: '#facc15',
};

const LLM_MODULES = ['LEGEX', 'DOMEX', 'ALTEX', 'REFLEX'];

function classifyDataSource(moduleId: string, metadata: Record<string, unknown>): string {
  if (LLM_MODULES.includes(moduleId)) {
    if (metadata?.sportsDataSource) return String(metadata.sportsDataSource);
    return 'llm';
  }
  return 'quantitative';
}

export function TradeDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getPaperPositionDetails(id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ maxWidth: '1000px' }}>
      <CardSkeleton height="40px" />
      <CardSkeleton height="120px" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
        <CardSkeleton height="200px" /><CardSkeleton height="200px" />
      </div>
    </div>
  );

  if (error || !data) return (
    <div style={{ maxWidth: '1000px' }}>
      <Link to="/backtest" style={{ color: colors.textSecondary, textDecoration: 'none', fontSize: '13px' }}>&larr; Back to Performance</Link>
      <div style={{ padding: '60px', textAlign: 'center', color: colors.red, marginTop: '24px' }}>
        {error || 'Position not found'}
      </div>
    </div>
  );

  const { position, market, entryEdge, currentEdge, signals, fees, gates, outcome } = data;

  const statusColor = position.isOpen ? colors.accent : outcome?.directionCorrect ? colors.green : outcome?.directionCorrect === false ? colors.red : colors.textMuted;
  const statusText = position.isOpen ? 'OPEN' : position.closeReason === 'resolution' ? 'RESOLVED' : position.closeReason === 'take_profit' ? 'TAKE PROFIT' : 'CLOSED';

  return (
    <div style={{ maxWidth: '1000px' }}>
      <Link to="/backtest" style={{ color: colors.textSecondary, textDecoration: 'none', fontSize: '13px' }}>&larr; Back to Performance</Link>

      {/* ── Header ── */}
      <div style={{ ...card, marginTop: '12px', borderLeft: `3px solid ${statusColor}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: '300px' }}>
            <h1 style={{ fontFamily: fonts.mono, fontSize: '17px', marginBottom: '8px', lineHeight: 1.4 }}>
              {market.displayTitle || market.title}
            </h1>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Pill label={market.platform} color={colors.accent} />
              <Pill label={market.category} color={colors.textSecondary} />
              <Pill label={statusText} color={statusColor} />
              {position.direction === 'BUY_YES'
                ? <Pill label="BUY YES" color={colors.green} />
                : <Pill label="BUY NO" color={colors.red} />}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: position.paperPnl >= 0 ? colors.green : colors.red, fontFamily: fonts.mono, fontSize: '22px', fontWeight: 700 }}>
              {fmtPnl(position.paperPnl)}
            </div>
            <div style={{ color: colors.textMuted, fontSize: '11px' }}>Paper P&L</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${colors.border}` }}>
          <MiniStat label="Entry" value={formatCents(position.entryPrice)} />
          <MiniStat label="Current" value={formatCents(position.currentPrice)} />
          <MiniStat label="Time Held" value={formatHours(position.hoursHeld)} />
          <MiniStat label="Entered" value={formatRelativeTime(position.createdAt)} />
          <MiniStat label="Closes" value={market.closesAt ? formatRelativeTime(market.closesAt) : '\u2014'} />
          <MiniStat label="Volume" value={formatVolume(market.volume)} />
        </div>
      </div>

      {/* ── Trade Thesis ── */}
      <div style={{ ...card }}>
        <SectionTitle>Trade Thesis</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '16px' }}>
          <Stat label="Fair Value" value={position.fairValueAtEntry != null ? formatPercent(position.fairValueAtEntry) : '\u2014'} color={colors.accent} />
          <Stat label="Market at Entry" value={entryEdge ? formatPercent(entryEdge.marketPrice) : formatCents(position.entryPrice)} color={colors.textSecondary} />
          <Stat label="Edge at Entry" value={formatPercent(position.edgeAtEntry)} color={position.edgeAtEntry > 0.05 ? colors.green : colors.yellow} />
          <Stat label="Current Edge" value={currentEdge ? formatPercent(currentEdge.edgeMagnitude) : '\u2014'} color={currentEdge && currentEdge.edgeMagnitude > position.edgeAtEntry ? colors.green : colors.orange} />
          <Stat label="Confidence" value={formatPercent(position.confidenceAtEntry)} color={colors.text} />
          <Stat label="Direction" value={position.direction === 'BUY_YES' ? 'YES' : 'NO'} color={position.direction === 'BUY_YES' ? colors.green : colors.red} />
        </div>
        {entryEdge?.actionabilitySummary && (
          <div style={{ marginTop: '16px', padding: '12px', backgroundColor: colors.bgTertiary, borderRadius: '6px', fontSize: '12px', color: colors.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {entryEdge.actionabilitySummary}
          </div>
        )}
        {/* Edge trend indicator */}
        {currentEdge && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: colors.textMuted }}>
            {currentEdge.edgeMagnitude > position.edgeAtEntry
              ? <span style={{ color: colors.green }}>Edge has GROWN since entry ({formatPercent(position.edgeAtEntry)} &rarr; {formatPercent(currentEdge.edgeMagnitude)})</span>
              : currentEdge.edgeMagnitude < position.edgeAtEntry * 0.5
              ? <span style={{ color: colors.red }}>Edge has SHRUNK significantly ({formatPercent(position.edgeAtEntry)} &rarr; {formatPercent(currentEdge.edgeMagnitude)})</span>
              : <span>Edge stable ({formatPercent(position.edgeAtEntry)} &rarr; {formatPercent(currentEdge.edgeMagnitude)})</span>
            }
          </div>
        )}
      </div>

      {/* ── Signal Breakdown ── */}
      <div style={{ ...card }}>
        <SectionTitle>Signal Breakdown ({signals.length} modules)</SectionTitle>
        {signals.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: '13px', padding: '12px 0' }}>No signals found near entry time</div>
        ) : (
          <>
            {/* Signal table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.mono, fontSize: '12px', marginBottom: '16px' }}>
              <thead>
                <tr>
                  {['Module', 'Probability', 'Confidence', 'Data Source', 'Summary'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: colors.textMuted, fontSize: '10px', textTransform: 'uppercase', borderBottom: `1px solid ${colors.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {signals.map((s: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${colors.border}20` }}>
                    <td style={{ padding: '8px', color: MODULE_COLORS[s.moduleId] || colors.accent, fontWeight: 700 }}>{s.moduleId}</td>
                    <td style={{ padding: '8px' }}>{formatPercent(s.probability)}</td>
                    <td style={{ padding: '8px' }}>{formatPercent(s.confidence)}</td>
                    <td style={{ padding: '8px', color: colors.textMuted }}>{classifyDataSource(s.moduleId, s.metadata || {})}</td>
                    <td style={{ padding: '8px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.textSecondary }}>
                      {s.reasoning?.slice(0, 80)}{s.reasoning?.length > 80 ? '...' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Signal detail cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              {signals.map((s: any, i: number) => (
                <SignalCard key={i} signal={s} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Position Sizing ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ ...card }}>
          <SectionTitle>Position Sizing</SectionTitle>
          <div style={{ display: 'grid', gap: '8px' }}>
            <DetailRow label="Kelly Fraction" value={`${(position.kellySize * 100).toFixed(2)}%`} />
            <DetailRow label="Quarter-Kelly Applied" value="Yes (0.25x)" />
            <DetailRow label="Entry Fee" value={formatPercent(fees.entryFee)} />
            <DetailRow label="Exit Fee (est.)" value={formatPercent(fees.exitFee)} />
            <DetailRow label="Total Fees" value={formatPercent(fees.totalFees)} />
            <DetailRow label="Net EV After Fees" value={formatPercent(fees.netEvAfterFees)} color={fees.netEvAfterFees > 0 ? colors.green : colors.red} />
          </div>
        </div>

        {/* ── Preflight Gates ── */}
        <div style={{ ...card }}>
          <SectionTitle>Preflight Gates</SectionTitle>
          <div style={{ display: 'grid', gap: '6px' }}>
            {gates.map((g: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                <span style={{ fontSize: '14px' }}>{g.passed ? '\u2705' : '\u274c'}</span>
                <span style={{ color: g.passed ? colors.text : colors.red }}>{g.gate}</span>
                <span style={{ color: colors.textMuted, marginLeft: 'auto', fontFamily: fonts.mono }}>({g.actual})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Outcome (for closed/resolved positions) ── */}
      {!position.isOpen && (
        <div style={{ ...card, borderLeft: `3px solid ${outcome.directionCorrect ? colors.green : outcome.directionCorrect === false ? colors.red : colors.textMuted}` }}>
          <SectionTitle>Outcome</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '16px' }}>
            <Stat label="Exit Price" value={outcome.exitPrice != null ? formatCents(outcome.exitPrice) : '\u2014'} color={colors.text} />
            <Stat label="P&L" value={fmtPnl(outcome.grossPnl)} color={outcome.grossPnl >= 0 ? colors.green : colors.red} />
            <Stat label="Direction Correct?" value={outcome.directionCorrect === true ? 'YES' : outcome.directionCorrect === false ? 'NO' : '\u2014'} color={outcome.directionCorrect ? colors.green : outcome.directionCorrect === false ? colors.red : colors.textMuted} />
            <Stat label="Resolution" value={outcome.resolution || '\u2014'} color={colors.text} />
            <Stat label="Close Reason" value={position.closeReason || '\u2014'} color={colors.textSecondary} />
            {position.closedAt && <Stat label="Closed" value={formatRelativeTime(position.closedAt)} color={colors.textMuted} />}
          </div>
        </div>
      )}

      {/* Link to signal viewer for live view */}
      <div style={{ textAlign: 'center', padding: '16px' }}>
        <Link to={`/markets/${market.id}/signals`} style={{ color: colors.accent, fontSize: '13px' }}>
          View live signals for this market &rarr;
        </Link>
      </div>
    </div>
  );
}

/* ─── Subcomponents ──────────────────────────────── */

function SignalCard({ signal }: { signal: any }) {
  const [expanded, setExpanded] = useState(false);
  const meta = signal.metadata || {};

  return (
    <div style={{
      backgroundColor: colors.bgTertiary,
      border: `1px solid ${colors.border}`,
      borderLeft: `3px solid ${MODULE_COLORS[signal.moduleId] || colors.accent}`,
      borderRadius: '6px', padding: '12px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontFamily: fonts.mono, fontSize: '12px', color: MODULE_COLORS[signal.moduleId] || colors.accent, fontWeight: 700 }}>{signal.moduleId}</span>
        <span style={{ color: colors.textMuted, fontSize: '10px' }}>{formatRelativeTime(signal.createdAt)}</span>
      </div>

      {/* Probability bar */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ color: colors.textMuted, fontSize: '10px' }}>Probability</span>
          <span style={{ fontFamily: fonts.mono, fontSize: '14px', fontWeight: 700 }}>{formatPercent(signal.probability)}</span>
        </div>
        <div style={{ height: '5px', backgroundColor: colors.bgSecondary, borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ width: `${signal.probability * 100}%`, height: '100%', backgroundColor: MODULE_COLORS[signal.moduleId] || colors.accent, borderRadius: '3px' }} />
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span style={{ color: colors.textMuted, fontSize: '10px' }}>Confidence</span>
          <span style={{ fontFamily: fonts.mono, fontSize: '11px', color: colors.textSecondary }}>{formatPercent(signal.confidence)}</span>
        </div>
        <div style={{ height: '3px', backgroundColor: colors.bgSecondary, borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${signal.confidence * 100}%`, height: '100%', backgroundColor: colors.textSecondary, borderRadius: '2px' }} />
        </div>
      </div>

      {/* Metadata pills */}
      <MetadataPills moduleId={signal.moduleId} metadata={meta} />

      {/* Feature vector for DOMEX */}
      {signal.moduleId === 'DOMEX' && meta.features && (
        <FeatureVector features={meta.features as Record<string, unknown>} />
      )}

      {/* Reasoning */}
      {signal.reasoning && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ color: colors.textSecondary, fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {expanded || signal.reasoning.length <= 150 ? signal.reasoning : signal.reasoning.slice(0, 150) + '...'}
          </div>
          {signal.reasoning.length > 150 && (
            <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: colors.accent, fontSize: '10px', cursor: 'pointer', padding: '2px 0', marginTop: '2px' }}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MetadataPills({ moduleId, metadata }: { moduleId: string; metadata: Record<string, unknown> }) {
  const pills: { label: string; value: string; color: string }[] = [];

  if (metadata.sportsDataSource) pills.push({ label: 'Source', value: String(metadata.sportsDataSource), color: colors.accent });
  if (metadata.sportsMarketType) pills.push({ label: 'Type', value: String(metadata.sportsMarketType), color: colors.textSecondary });
  if (metadata.featureSchemaVersion) pills.push({ label: 'Schema', value: `v${metadata.featureSchemaVersion}`, color: colors.textMuted });

  if (moduleId === 'LEGEX') {
    if (metadata.ambiguityScore) pills.push({ label: 'Ambiguity', value: `${metadata.ambiguityScore}/5`, color: colors.orange });
    if (metadata.adjustmentDirection && metadata.adjustmentDirection !== 'NONE')
      pills.push({ label: 'Shift', value: `${metadata.adjustmentDirection === 'TOWARD_YES' ? '+' : '-'}${((metadata.adjustment as number || 0) * 100).toFixed(1)}%`, color: colors.yellow });
  } else if (moduleId === 'DOMEX') {
    if (metadata.agentCount) pills.push({ label: 'Agents', value: String(metadata.agentCount), color: colors.accent });
    if (metadata.agreement != null) pills.push({ label: 'Agreement', value: formatPercent(metadata.agreement as number), color: (metadata.agreement as number) > 0.7 ? colors.green : colors.yellow });
  } else if (moduleId === 'ALTEX') {
    if (metadata.direction) pills.push({ label: 'News', value: String(metadata.direction), color: metadata.direction === 'TOWARD_YES' ? colors.green : colors.red });
    if (metadata.likelyPricedIn != null) pills.push({ label: 'Priced In', value: formatPercent(metadata.likelyPricedIn as number), color: colors.textSecondary });
  } else if (moduleId === 'COGEX') {
    const adj = metadata.adjustments as Record<string, number> | undefined;
    if (adj) {
      Object.entries(adj).filter(([, v]) => Math.abs(v) > 0.01).forEach(([k, v]) =>
        pills.push({ label: k, value: `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`, color: colors.accent })
      );
    }
  } else if (moduleId === 'FLOWEX') {
    if (metadata.moveClassification) pills.push({ label: 'Move', value: String(metadata.moveClassification), color: metadata.moveClassification === 'INFORMATION' ? colors.red : colors.textSecondary });
    if (metadata.orderFlowImbalance != null) pills.push({ label: 'OFI', value: (metadata.orderFlowImbalance as number).toFixed(2), color: colors.accent });
  } else if (moduleId === 'SPEEDEX') {
    if (metadata.contractType) pills.push({ label: 'Type', value: String(metadata.contractType), color: colors.orange });
    if (metadata.priceSource) pills.push({ label: 'Feed', value: String(metadata.priceSource), color: colors.accent });
    if (metadata.nearBracketEdge) pills.push({ label: 'HIGH GAMMA', value: '', color: colors.yellow });
  }

  if (pills.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
      {pills.map((p, i) => (
        <span key={i} style={{
          padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontFamily: fonts.mono,
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, color: p.color,
        }}>
          {p.label}{p.value ? `: ${p.value}` : ''}
        </span>
      ))}
    </div>
  );
}

function FeatureVector({ features }: { features: Record<string, unknown> }) {
  const entries = Object.entries(features).filter(([, v]) => v != null && v !== '' && v !== 0);
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: '8px', padding: '8px', backgroundColor: colors.bgSecondary, borderRadius: '4px' }}>
      <div style={{ color: colors.textMuted, fontSize: '9px', textTransform: 'uppercase', marginBottom: '6px' }}>Feature Vector</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
        {entries.map(([key, val]) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
            <span style={{ color: colors.textMuted }}>{key}</span>
            <span style={{ color: colors.text, fontFamily: fonts.mono }}>
              {typeof val === 'number' ? (Math.abs(val) < 1 ? val.toFixed(3) : val.toFixed(1)) : String(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ color: colors.textMuted, fontSize: '10px', marginBottom: '2px' }}>{label}</div>
      <div style={{ color, fontFamily: fonts.mono, fontSize: '16px', fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: colors.textMuted, fontSize: '10px' }}>{label}</div>
      <div style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '13px' }}>{value}</div>
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
      <span style={{ color: colors.textMuted }}>{label}</span>
      <span style={{ color: color || colors.text, fontFamily: fonts.mono }}>{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontFamily: fonts.mono, fontSize: '13px', color: colors.textSecondary, marginBottom: '14px' }}>{children}</h2>;
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontFamily: fonts.mono,
      fontWeight: 600, color, backgroundColor: color + '15', border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  );
}

function fmtPnl(v: number): string {
  const abs = Math.abs(v);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  // Sub-dollar: show as cents
  return `${sign}${(abs * 100).toFixed(1)}\u00a2`;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(1)}d`;
  return `${Math.round(days)}d`;
}

const card: React.CSSProperties = {
  backgroundColor: colors.bgSecondary,
  border: `1px solid ${colors.border}`,
  borderRadius: '8px',
  padding: '20px',
  marginBottom: '16px',
};
