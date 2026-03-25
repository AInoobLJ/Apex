import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils/format';
import { colors, fonts } from '../theme';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: colors.red,
  HIGH: colors.orange,
  MEDIUM: colors.yellow,
  LOW: colors.textMuted,
};

const TYPE_EMOJI: Record<string, string> = {
  NEW_EDGE: '\uD83D\uDD25',
  SMART_MONEY_MOVE: '\uD83D\uDC0B',
  PRICE_SPIKE: '\u26A1',
  MODULE_FAILURE: '\uD83D\uDEA8',
  EDGE_EVAPORATION: '\uD83D\uDCA8',
  CAUSAL_INCONSISTENCY: '\uD83D\uDD17',
};

interface AlertItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

export function AlertPanel() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState(false);

  const fetchAlerts = () => {
    api.getAlerts({ limit: 20, acknowledged: 'false' })
      .then(res => setAlerts(res.data as AlertItem[]))
      .catch(() => {});
  };

  useEffect(() => { fetchAlerts(); const t = setInterval(fetchAlerts, 30000); return () => clearInterval(t); }, []);

  const unacked = alerts.filter(a => !a.acknowledged).length;

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          backgroundColor: 'transparent',
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          padding: '6px 12px',
          color: colors.text,
          cursor: 'pointer',
          fontSize: '13px',
          position: 'relative',
        }}
      >
        Alerts
        {unacked > 0 && (
          <span style={{
            position: 'absolute', top: '-6px', right: '-6px',
            backgroundColor: colors.red, color: '#fff',
            borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: 700,
          }}>
            {unacked}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '40px', right: 0, width: '380px', maxHeight: '500px', overflowY: 'auto',
          backgroundColor: colors.bgSecondary, border: `1px solid ${colors.border}`, borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 100,
        }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}`, fontFamily: fonts.mono, fontSize: '13px', color: colors.text }}>
            Alerts ({unacked} unread)
          </div>
          {alerts.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: colors.textMuted, fontSize: '13px' }}>No alerts</div>
          ) : (
            alerts.map(alert => (
              <div key={alert.id} style={{
                padding: '10px 16px', borderBottom: `1px solid ${colors.border}20`,
                opacity: alert.acknowledged ? 0.5 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px' }}>
                    <span>{TYPE_EMOJI[alert.type] || ''} </span>
                    <span style={{ color: SEVERITY_COLORS[alert.severity] || colors.text, fontWeight: 600 }}>{alert.severity}</span>
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: '11px' }}>{formatRelativeTime(alert.createdAt)}</span>
                </div>
                <div style={{ color: colors.text, fontSize: '13px', marginBottom: '4px' }}>{alert.title}</div>
                <div style={{ color: colors.textSecondary, fontSize: '12px', lineHeight: 1.4 }}>{alert.message.slice(0, 120)}</div>
                {!alert.acknowledged && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      api.acknowledgeAlert(alert.id).then(fetchAlerts);
                    }}
                    style={{
                      marginTop: '6px', backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`,
                      borderRadius: '4px', padding: '3px 8px', fontSize: '11px', color: colors.textSecondary, cursor: 'pointer',
                    }}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
