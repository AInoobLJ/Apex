import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';
import { CardSkeleton } from '../components/Skeleton';
import { colors, fonts } from '../theme';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY || '';

const apiFetch = async (path: string, method = 'GET') => {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'X-API-Key': API_KEY },
  });
  return res.json();
};

export function Backtest() {
  const navigate = useNavigate();
  const [freeData, setFreeData] = useState<any>(null);
  const [deepData, setDeepData] = useState<any>(null);
  const [liveData, setLiveData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<any>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepEstimate, setDeepEstimate] = useState<any>(null);
  const [sampleSize, setSampleSize] = useState(50);
  const [showConfirm, setShowConfirm] = useState(false);
  const [section, setSection] = useState<'live' | 'statistical' | 'llm'>('live');

  useEffect(() => {
    Promise.all([
      apiFetch('/backtest/historical').catch(() => null),
      apiFetch('/backtest/historical/deep').catch(() => null),
      apiFetch('/backtest/live-performance').catch(() => null),
    ]).then(([free, cachedDeep, live]) => {
      if (free) setFreeData(free);
      if (cachedDeep?.cached) setDeepData(cachedDeep);
      if (live) setLiveData(live);
    }).finally(() => setLoading(false));
  }, []);

  const handleIngest = async () => {
    setIngesting(true);
    try {
      const result = await apiFetch('/backtest/ingest-historical', 'POST');
      setIngestResult(result);
      const newData = await apiFetch('/backtest/historical');
      setFreeData(newData);
    } catch (e) { console.error(e); }
    setIngesting(false);
  };

  const handleEstimate = async () => {
    const est = await apiFetch(`/backtest/historical/estimate-deep?sample=${sampleSize}`);
    setDeepEstimate(est);
    setShowConfirm(true);
  };

  const handleDeepBacktest = async () => {
    setShowConfirm(false);
    setDeepLoading(true);
    try {
      const result = await apiFetch(`/backtest/historical/deep?sample=${sampleSize}`, 'POST');
      setDeepData(result);
    } catch (e) { console.error(e); }
    setDeepLoading(false);
  };

  if (loading) return (
    <div>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>Performance</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
      </div>
      <CardSkeleton height="300px" />
    </div>
  );

  return (
    <div style={{ maxWidth: '1100px' }}>
      <h1 style={{ fontFamily: fonts.mono, fontSize: '20px', marginBottom: '16px' }}>Performance & Validation</h1>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
        <TabBtn active={section === 'live'} onClick={() => setSection('live')}>
          Live Paper Performance
        </TabBtn>
        <TabBtn active={section === 'statistical'} onClick={() => setSection('statistical')}>
          Statistical Backtest
        </TabBtn>
        <TabBtn active={section === 'llm'} onClick={() => setSection('llm')}>
          LLM Backtest (Indicative)
        </TabBtn>
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* SECTION 1: LIVE PAPER PERFORMANCE — the only trustworthy metric */}
      {/* ══════════════════════════════════════════════════════════ */}
      {section === 'live' && (
        <div>
          <div style={{ ...warningBanner, borderColor: colors.accent + '60', backgroundColor: colors.accent + '08' }}>
            <strong style={{ color: colors.accent }}>The Only Metric That Matters</strong>
            <p style={{ margin: '4px 0 0', color: colors.textSecondary, fontSize: '12px' }}>
              Live paper trading tracks predictions made BEFORE resolution. This is the only unbiased measure of APEX's edge.
              Target: 30 days of forward data before considering real money.
            </p>
          </div>

          {liveData && liveData.totalPositions > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <StatCard label="Paper Positions" value={String(liveData.totalPositions)} subtitle={`${liveData.openPositions} open`} color={colors.accent} />
                <StatCard label="Resolved" value={String(liveData.resolvedPositions)} subtitle="with outcomes" color={colors.textSecondary} />
                <StatCard label="Hit Rate" value={liveData.resolvedPositions > 0 ? `${(liveData.hitRate * 100).toFixed(1)}%` : '—'} subtitle="direction accuracy" color={liveData.hitRate > 0.55 ? colors.green : colors.textSecondary} />
                <StatCard label="Paper P&L" value={liveData.resolvedPositions > 0 ? `${liveData.paperPnl >= 0 ? '+' : ''}$${liveData.paperPnl.toFixed(2)}` : '—'} subtitle="simulated" color={liveData.paperPnl >= 0 ? colors.green : colors.red} />
                <StatCard label="Avg Edge" value={liveData.avgEdge ? `${(liveData.avgEdge * 100).toFixed(1)}%` : '—'} subtitle="at entry" color={colors.textSecondary} />
                <StatCard label="Days Active" value={String(liveData.daysActive || 0)} subtitle="of 30 target" color={colors.textSecondary} />
              </div>

              {/* Live positions table */}
              {liveData.positions && liveData.positions.length > 0 && (
                <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px' }}>
                  <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>Paper Positions</h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fonts.mono, fontSize: '12px' }}>
                    <thead>
                      <tr>
                        {['Market', 'Direction', 'Entry', 'Current', 'Edge', 'P&L', 'Status'].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: colors.textMuted, fontSize: '10px', textTransform: 'uppercase', borderBottom: `1px solid ${colors.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {liveData.positions.map((p: any, i: number) => (
                        <tr key={i} onClick={() => p.marketId && navigate(`/markets/${p.marketId}/signals`)} style={{ borderBottom: `1px solid ${colors.border}20`, cursor: p.marketId ? 'pointer' : 'default' }} onMouseEnter={(e) => { if (p.marketId) (e.currentTarget as HTMLElement).style.backgroundColor = colors.bgTertiary; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}>
                          <td style={{ padding: '6px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                          <td style={{ padding: '6px 8px', color: p.direction === 'BUY_YES' ? colors.green : colors.red }}>{p.direction}</td>
                          <td style={{ padding: '6px 8px' }}>{(p.entryPrice * 100).toFixed(1)}{'\u00a2'}</td>
                          <td style={{ padding: '6px 8px' }}>{(p.currentPrice * 100).toFixed(1)}{'\u00a2'}</td>
                          <td style={{ padding: '6px 8px' }}>{(p.edge * 100).toFixed(1)}%</td>
                          <td style={{ padding: '6px 8px', color: p.pnl >= 0 ? colors.green : colors.red }}>{p.pnl >= 0 ? '+' : ''}{(p.pnl * 100).toFixed(1)}{'\u00a2'}</td>
                          <td style={{ padding: '6px 8px', color: p.isOpen ? colors.accent : colors.textMuted }}>{p.isOpen ? 'OPEN' : 'CLOSED'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '60px', textAlign: 'center', color: colors.textMuted, backgroundColor: colors.bgSecondary, borderRadius: '8px', border: `1px solid ${colors.border}` }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>&#128203;</div>
              <div style={{ fontSize: '14px', marginBottom: '8px' }}>No paper positions yet</div>
              <div style={{ fontSize: '12px', lineHeight: 1.6, maxWidth: '400px', margin: '0 auto' }}>
                The worker automatically enters paper positions when actionable edges are detected.
                Run the worker (<code style={{ color: colors.accent }}>npm run worker</code>) and wait for the signal pipeline to find edges.
                Paper positions will appear here as markets resolve.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* SECTION 2: STATISTICAL BACKTEST (COGEX/FLOWEX) — no look-ahead bias */}
      {/* ══════════════════════════════════════════════════════════ */}
      {section === 'statistical' && (
        <div>
          <div style={{ ...warningBanner, borderColor: colors.green + '40', backgroundColor: colors.green + '08' }}>
            <strong style={{ color: colors.green }}>Bias-Free Statistical Backtest</strong>
            <p style={{ margin: '4px 0 0', color: colors.textSecondary, fontSize: '12px' }}>
              COGEX and FLOWEX use pure math (bias detection, orderbook analysis) — no LLM involved.
              These results are NOT affected by look-ahead bias and are valid for evaluation.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleIngest} disabled={ingesting} style={btnStyle}>
              {ingesting ? 'Ingesting...' : 'Ingest Historical Data'}
            </button>
            {ingestResult && (
              <span style={{ fontSize: '12px', color: colors.green, fontFamily: fonts.mono }}>
                +{ingestResult.ingested?.polymarket || 0} Poly, +{ingestResult.ingested?.kalshi || 0} Kalshi ({ingestResult.totalResolved} total resolved)
              </span>
            )}
          </div>

          {freeData && freeData.overall ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <StatCard label="Brier Score" value={freeData.overall.brierScore.toFixed(4)} subtitle="lower = better" color={freeData.overall.brierScore < 0.20 ? colors.green : colors.yellow} />
                <StatCard label="Hit Rate" value={`${(freeData.overall.hitRate * 100).toFixed(1)}%`} subtitle="direction accuracy" color={freeData.overall.hitRate > 0.55 ? colors.green : colors.textSecondary} />
                <StatCard label="Simulated Return" value={`${(freeData.pnl.totalReturn * 100).toFixed(2)}%`} subtitle={`${freeData.pnl.trades} trades`} color={freeData.pnl.totalReturn >= 0 ? colors.green : colors.red} />
                <StatCard label="Win Rate" value={`${(freeData.pnl.winRate * 100).toFixed(1)}%`} subtitle={`DD: ${(freeData.pnl.maxDrawdown * 100).toFixed(1)}%`} color={freeData.pnl.winRate > 0.5 ? colors.green : colors.red} />
                <StatCard label="Sharpe" value={freeData.pnl.sharpeRatio.toFixed(2)} subtitle="risk-adjusted" color={freeData.pnl.sharpeRatio > 1 ? colors.green : colors.textSecondary} />
                <StatCard label="Sample" value={String(freeData.overall.totalMarkets)} subtitle="resolved markets" color={colors.textSecondary} />
              </div>

              {/* Module scores */}
              {freeData.byModule.length > 0 && <ModuleScoreCards data={freeData.byModule} />}

              {/* Calibration */}
              {freeData.calibration.filter((c: any) => c.count > 0).length > 0 && (
                <CalibrationChart data={freeData.calibration} />
              )}

              {/* Equity curve */}
              {freeData.pnl.equityCurve.length > 0 && (
                <EquityCurve data={freeData.pnl.equityCurve} />
              )}
            </>
          ) : (
            <div style={{ padding: '60px', textAlign: 'center', color: colors.textMuted }}>
              No resolved market data. Click "Ingest Historical Data" to pull resolved markets from Polymarket and Kalshi.
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* SECTION 3: LLM DEEP BACKTEST — look-ahead bias warning */}
      {/* ══════════════════════════════════════════════════════════ */}
      {section === 'llm' && (
        <div>
          {/* PROMINENT WARNING BANNER */}
          <div style={{ ...warningBanner, borderColor: colors.red + '60', backgroundColor: colors.red + '08' }}>
            <strong style={{ color: colors.red }}>Look-Ahead Bias Warning</strong>
            <p style={{ margin: '4px 0 0', color: colors.textSecondary, fontSize: '12px', lineHeight: 1.6 }}>
              LLM backtest results are subject to severe look-ahead bias. Claude's training data includes the outcomes of these events.
              A 100% hit rate or extreme Sharpe ratio confirms the model is "remembering" outcomes, not predicting them.
              These results are NOT reliable indicators of future performance. Only live paper trading results (above) are trustworthy.
            </p>
          </div>

          <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
            <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, marginBottom: '4px' }}>
              Deep Backtest (LLM Modules) <span style={{ color: colors.yellow, fontSize: '11px', marginLeft: '8px' }}>INDICATIVE ONLY — NOT VALIDATED</span>
            </h2>
            <p style={{ color: colors.textMuted, fontSize: '12px', marginBottom: '16px', lineHeight: 1.5 }}>
              Run LEGEX, DOMEX, and ALTEX on resolved markets. Useful for testing module connectivity and output format, NOT for measuring predictive accuracy.
            </p>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: colors.textSecondary }}>Sample:</span>
                <input type="range" min={10} max={100} step={10} value={sampleSize}
                  onChange={(e) => setSampleSize(Number(e.target.value))}
                  style={{ width: '120px', accentColor: colors.accent }} />
                <span style={{ fontFamily: fonts.mono, fontSize: '13px', color: colors.accent, minWidth: '30px' }}>{sampleSize}</span>
              </div>
              <span style={{ fontSize: '11px', color: colors.textMuted }}>
                ~{sampleSize * 3} Claude calls, est. ${(sampleSize * 3 * 0.01).toFixed(2)}
              </span>
              <button onClick={handleEstimate} disabled={deepLoading} style={btnStyle}>
                {deepLoading ? 'Running...' : 'Run Deep Backtest'}
              </button>
            </div>

            {showConfirm && deepEstimate && (
              <div style={{ marginTop: '16px', padding: '16px', backgroundColor: colors.bgTertiary, borderRadius: '6px', border: `1px solid ${colors.yellow}40` }}>
                <p style={{ color: colors.yellow, fontSize: '13px', marginBottom: '12px' }}>
                  This will analyze {deepEstimate.sample} markets x 3 LLM modules = ~{deepEstimate.llmCalls} Claude calls.
                  Estimated cost: <strong>${deepEstimate.estimatedCost.toFixed(2)}</strong>.
                  Results are indicative only due to look-ahead bias.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={handleDeepBacktest} style={{ ...btnStyle, backgroundColor: colors.yellow + '20', borderColor: colors.yellow }}>
                    Proceed (Indicative Only)
                  </button>
                  <button onClick={() => setShowConfirm(false)} style={{ ...btnStyle, backgroundColor: 'transparent' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {deepData?.cost && (
              <div style={{ marginTop: '12px', fontSize: '12px', color: colors.textMuted }}>
                Completed: {deepData.cost.calls} LLM calls, actual cost ~${deepData.cost.estimatedCost.toFixed(2)}
                {deepData.runAt && (
                  <span style={{ marginLeft: '12px' }}>
                    · Last run: {new Date(deepData.runAt).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Show deep results if available */}
          {deepData && deepData.overall && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                <StatCard label="Brier Score" value={deepData.overall.brierScore.toFixed(4)} subtitle="biased — indicative" color={colors.yellow} />
                <StatCard label="Hit Rate" value={`${(deepData.overall.hitRate * 100).toFixed(1)}%`} subtitle="biased — indicative" color={colors.yellow} />
                <StatCard label="Sample" value={String(deepData.overall.totalMarkets)} subtitle="resolved markets" color={colors.textSecondary} />
              </div>
              {deepData.byModule.length > 0 && <ModuleScoreCards data={deepData.byModule} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Shared Components ──────────────────────────────── */

function StatCard({ label, value, subtitle, color }: { label: string; value: string; subtitle: string; color: string }) {
  return (
    <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '12px' }}>
      <div style={{ color: colors.textMuted, fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
      <div style={{ color, fontFamily: fonts.mono, fontSize: '20px', fontWeight: 700 }}>{value}</div>
      <div style={{ color: colors.textMuted, fontSize: '10px', marginTop: '2px' }}>{subtitle}</div>
    </div>
  );
}

function TabBtn({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 16px', fontSize: '12px', fontFamily: fonts.mono, fontWeight: active ? 700 : 400,
      backgroundColor: active ? colors.accent + '20' : 'transparent',
      color: active ? colors.accent : disabled ? colors.textMuted : colors.textSecondary,
      border: `1px solid ${active ? colors.accent : colors.border}`,
      borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
  );
}

function ModuleScoreCards({ data }: { data: any[] }) {
  return (
    <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>Module Scores</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {data.map((m: any) => (
          <div key={m.moduleId} style={{ backgroundColor: colors.bgTertiary, borderRadius: '6px', padding: '12px' }}>
            <div style={{ fontFamily: fonts.mono, color: colors.accent, fontSize: '13px', marginBottom: '8px' }}>{m.moduleId}</div>
            {[
              ['Brier', m.brierScore.toFixed(4), m.brierScore < 0.20 ? colors.green : colors.text],
              ['Hit Rate', `${(m.hitRate * 100).toFixed(0)}%`, m.hitRate > 0.55 ? colors.green : colors.text],
              ['Samples', String(m.sampleSize), colors.text],
              ['Avg Edge', `${(m.avgEdge * 100).toFixed(1)}%`, colors.text],
            ].map(([label, val, clr]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: colors.textMuted }}>{label}</span>
                <span style={{ color: clr as string, fontFamily: fonts.mono }}>{val}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalibrationChart({ data }: { data: any[] }) {
  const filtered = data.filter((c: any) => c.count > 0);
  return (
    <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>Calibration Curve</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={filtered}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
          <XAxis dataKey="bin" tick={{ fill: colors.textMuted, fontSize: 10 }} stroke={colors.border} />
          <YAxis tick={{ fill: colors.textMuted, fontSize: 10 }} stroke={colors.border} domain={[0, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip contentStyle={{ backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`, fontSize: '12px' }} />
          <Bar dataKey="predictedAvg" name="Predicted" fill={colors.accent} opacity={0.6} />
          <Bar dataKey="actualRate" name="Actual" fill={colors.green} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ color: colors.textMuted, fontSize: '11px', textAlign: 'center', marginTop: '4px' }}>
        Perfect calibration = bars match. Predicted (blue) vs Actual outcome rate (green)
      </div>
    </div>
  );
}

function EquityCurve({ data }: { data: any[] }) {
  return (
    <div style={{ backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
      <h2 style={{ fontFamily: fonts.mono, fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>Equity Curve</h2>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
          <XAxis dataKey="market" tick={{ fill: colors.textMuted, fontSize: 9 }} stroke={colors.border} />
          <YAxis tick={{ fill: colors.textMuted, fontSize: 10 }} stroke={colors.border} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
          <Tooltip contentStyle={{ backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`, fontSize: '12px' }} />
          <Line type="monotone" dataKey="equity" stroke={colors.green} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px', fontSize: '13px', fontFamily: fonts.mono,
  backgroundColor: colors.bgTertiary, color: colors.text,
  border: `1px solid ${colors.border}`, borderRadius: '6px',
  cursor: 'pointer',
};

const warningBanner: React.CSSProperties = {
  padding: '12px 16px', borderRadius: '8px', marginBottom: '20px',
  border: '1px solid', fontSize: '13px',
};
