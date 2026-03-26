import React from 'react';
import { colors, fonts } from '../theme';

const SHORTCUTS = [
  { key: '1', desc: 'Markets' },
  { key: '2', desc: 'Edges' },
  { key: '3', desc: 'Execution' },
  { key: '4', desc: 'Portfolio' },
  { key: '5', desc: 'Crypto' },
  { key: '6', desc: 'Backtest' },
  { key: '7', desc: 'Settings' },
  { key: '8', desc: 'System' },
  { key: '/', desc: 'Command Palette' },
  { key: '?', desc: 'Toggle this help' },
  { key: 'Esc', desc: 'Close overlay' },
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: 12, padding: '24px 32px',
          minWidth: 320, maxWidth: 400,
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16, color: colors.text, fontFamily: fonts.sans }}>
          Keyboard Shortcuts
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SHORTCUTS.map(({ key, desc }) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans }}>{desc}</span>
              <kbd style={{
                backgroundColor: colors.bgTertiary, border: `1px solid ${colors.border}`,
                borderRadius: 4, padding: '2px 8px', fontSize: 12,
                fontFamily: fonts.mono, color: colors.accent, minWidth: 24, textAlign: 'center',
              }}>{key}</kbd>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
          Press ? or Esc to close
        </div>
      </div>
    </div>
  );
}
