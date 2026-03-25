import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { CardSkeleton } from '../components/Skeleton';
import { colors, fonts } from '../theme';

const LIMIT_LABELS: Record<string, { label: string; prefix: string; suffix: string }> = {
  maxPerTrade: { label: 'Max Per Trade', prefix: '$', suffix: '' },
  maxDailyNewTrades: { label: 'Max Daily New Trades', prefix: '$', suffix: '' },
  maxSimultaneousPositions: { label: 'Max Simultaneous Positions', prefix: '', suffix: '' },
  maxTotalDeployed: { label: 'Max Total Deployed', prefix: '$', suffix: '' },
  consecutiveLossHalt: { label: 'Consecutive Loss Halt', prefix: '', suffix: ' losses' },
  dailyPnlHalt: { label: 'Daily P&L Halt', prefix: '$', suffix: '' },
  maxArbExecutionsPerHour: { label: 'Max Arb Executions / Hour', prefix: '', suffix: '' },
};

export function Settings() {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [ceilings, setCeilings] = useState<Record<string, number>>({});
  const [killSwitch, setKillSwitch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, number>>({});
  const [auditLog, setAuditLog] = useState<{ id: string; setting: string; previousValue: string; newValue: string; changedAt: string }[]>([]);

  useEffect(() => {
    Promise.all([
      api.getRiskLimits(),
      api.getKillSwitch(),
      api.getAuditLog(),
    ]).then(([riskData, switchData, auditData]) => {
      setLimits(riskData.limits);
      setCeilings(riskData.hardCeilings);
      setKillSwitch(switchData.tradexEnabled);
      setAuditLog(auditData.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleSliderChange = (key: string, value: number) => {
    setPendingChanges(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    if (Object.keys(pendingChanges).length === 0) return;
    setConfirmModal(true);
  };

  const handleConfirmSave = async () => {
    if (confirmText !== 'CONFIRM') return;
    try {
      const result = await api.updateRiskLimits({ ...limits, ...pendingChanges });
      setLimits(result.limits);
      setPendingChanges({});
      setConfirmModal(false);
      setConfirmText('');
      const auditData = await api.getAuditLog();
      setAuditLog(auditData.data);
    } catch (err) {
      console.error('Failed to update risk limits', err);
    }
  };

  const handleKillSwitch = async () => {
    try {
      const result = await api.setKillSwitch(!killSwitch);
      setKillSwitch(result.tradexEnabled);
      const auditData = await api.getAuditLog();
      setAuditLog(auditData.data);
    } catch (err) {
      console.error('Failed to toggle kill switch', err);
    }
  };

  if (loading) return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>TRADEX Settings</h1>
      <CardSkeleton height="80px" />
      <div style={{ marginTop: '16px' }}><CardSkeleton height="400px" /></div>
    </div>
  );

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <h1 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '20px', marginBottom: '24px' }}>
        TRADEX Settings
      </h1>

      {/* Kill Switch */}
      <div style={{
        backgroundColor: killSwitch ? colors.redDim : colors.bgTertiary,
        border: `1px solid ${killSwitch ? colors.red : colors.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ color: colors.text, fontWeight: 600, fontSize: '16px' }}>
            TRADEX Kill Switch
          </div>
          <div style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '4px' }}>
            {killSwitch ? 'Execution engine is ACTIVE' : 'Execution engine is DISABLED'}
          </div>
        </div>
        <button
          onClick={handleKillSwitch}
          style={{
            backgroundColor: killSwitch ? colors.red : colors.green,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: fonts.mono,
          }}
        >
          {killSwitch ? 'KILL' : 'ENABLE'}
        </button>
      </div>

      {/* Risk Limits */}
      <div style={{
        backgroundColor: colors.bgSecondary,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '24px',
      }}>
        <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '16px', marginBottom: '16px' }}>
          Risk Limits
        </h2>

        {Object.entries(LIMIT_LABELS).map(([key, { label, prefix, suffix }]) => {
          const currentValue = pendingChanges[key] ?? limits[key] ?? 0;
          const ceiling = Math.abs(ceilings[key] ?? 100);
          const isNegative = key === 'dailyPnlHalt';

          return (
            <div key={key} style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{label}</span>
                <span style={{ color: colors.accent, fontFamily: fonts.mono, fontSize: '13px' }}>
                  {isNegative ? '-' : ''}{prefix}{Math.abs(currentValue)}{suffix}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={ceiling}
                step={key === 'maxSimultaneousPositions' || key === 'consecutiveLossHalt' || key === 'maxArbExecutionsPerHour' ? 1 : 5}
                value={Math.abs(currentValue)}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  handleSliderChange(key, isNegative ? -val : val);
                }}
                style={{ width: '100%', accentColor: colors.accent }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: colors.textMuted }}>
                <span>0</span>
                <span>Ceiling: {isNegative ? '-' : ''}{prefix}{ceiling}{suffix}</span>
              </div>
            </div>
          );
        })}

        {Object.keys(pendingChanges).length > 0 && (
          <button
            onClick={handleSave}
            style={{
              backgroundColor: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: '8px',
            }}
          >
            Save Changes
          </button>
        )}
      </div>

      {/* Audit Log */}
      <div style={{
        backgroundColor: colors.bgSecondary,
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        padding: '20px',
      }}>
        <h2 style={{ color: colors.text, fontFamily: fonts.mono, fontSize: '16px', marginBottom: '16px' }}>
          Audit Log
        </h2>
        {auditLog.length === 0 ? (
          <div style={{ color: colors.textMuted, fontSize: '13px' }}>No changes recorded</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Setting', 'Previous', 'New', 'Changed At'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px', color: colors.textMuted, fontSize: '12px', borderBottom: `1px solid ${colors.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {auditLog.slice(0, 20).map(log => (
                <tr key={log.id}>
                  <td style={{ padding: '8px', color: colors.text, fontSize: '13px', fontFamily: fonts.mono }}>{log.setting}</td>
                  <td style={{ padding: '8px', color: colors.red, fontSize: '13px', fontFamily: fonts.mono }}>{log.previousValue}</td>
                  <td style={{ padding: '8px', color: colors.green, fontSize: '13px', fontFamily: fonts.mono }}>{log.newValue}</td>
                  <td style={{ padding: '8px', color: colors.textSecondary, fontSize: '12px' }}>{new Date(log.changedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirm Modal */}
      {confirmModal && (
        <div style={{
          position: 'fixed', inset: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            backgroundColor: colors.bgSecondary,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '24px',
            width: '400px',
          }}>
            <h3 style={{ color: colors.text, marginBottom: '16px' }}>Confirm Risk Limit Changes</h3>
            <p style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '16px' }}>
              Type <strong style={{ color: colors.accent }}>CONFIRM</strong> to save changes.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type CONFIRM"
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: colors.bgTertiary,
                border: `1px solid ${colors.border}`,
                borderRadius: '6px',
                color: colors.text,
                fontFamily: fonts.mono,
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setConfirmModal(false); setConfirmText(''); }}
                style={{
                  backgroundColor: 'transparent',
                  color: colors.textSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={confirmText !== 'CONFIRM'}
                style={{
                  backgroundColor: confirmText === 'CONFIRM' ? colors.accent : colors.bgTertiary,
                  color: confirmText === 'CONFIRM' ? '#fff' : colors.textMuted,
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  cursor: confirmText === 'CONFIRM' ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
