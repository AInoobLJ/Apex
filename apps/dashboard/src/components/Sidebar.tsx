import { useEffect } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { colors, fonts } from '../theme';

const NAV_ITEMS = [
  { path: '/', label: 'Markets', key: '1' },
  { path: '/edges', label: 'Edges', key: '2' },
  { path: '/crypto', label: 'Crypto', key: '3' },
  { path: '/portfolio', label: 'Portfolio', key: '4' },
  { path: '/execution', label: 'Execution', key: '5' },
  { path: '/backtest', label: 'Backtest', key: '6' },
  { path: '/settings', label: 'Settings', key: '7' },
  { path: '/system', label: 'System', key: '8' },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      const item = NAV_ITEMS.find(n => n.key === e.key);
      if (item) navigate(item.path);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <nav style={{
      width: '200px',
      minWidth: '200px',
      backgroundColor: colors.bgSecondary,
      borderRight: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      padding: '16px 0',
    }}>
      <div style={{
        padding: '0 16px 24px',
        fontFamily: fonts.mono,
        fontSize: '18px',
        fontWeight: 700,
        color: colors.accent,
        letterSpacing: '2px',
      }}>
        APEX
      </div>

      {NAV_ITEMS.map(item => {
        const active = location.pathname === item.path ||
          (item.path === '/' && location.pathname.startsWith('/markets/'));
        return (
          <Link
            key={item.path}
            to={item.path}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 16px',
              color: active ? colors.accent : colors.textSecondary,
              backgroundColor: active ? colors.accentDim + '30' : 'transparent',
              borderLeft: active ? `3px solid ${colors.accent}` : '3px solid transparent',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: active ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            <span>{item.label}</span>
            <span style={{
              fontFamily: fonts.mono,
              fontSize: '10px',
              color: colors.textMuted,
              backgroundColor: colors.bgTertiary,
              padding: '1px 5px',
              borderRadius: '3px',
            }}>
              {item.key}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
