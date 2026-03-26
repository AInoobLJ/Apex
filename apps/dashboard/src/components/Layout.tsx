import React, { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { ErrorBoundary } from './ErrorBoundary';
import { AlertPanel } from './AlertPanel';
import { ShortcutHelp } from './ShortcutHelp';
import { CommandPalette } from './CommandPalette';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { colors, fonts } from '../theme';

export function Layout({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const { showHelp, setShowHelp } = useKeyboardShortcuts(openPalette);

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: fonts.sans,
    }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar with alerts */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: '8px 24px',
          borderBottom: `1px solid ${colors.border}`,
          minHeight: '44px',
        }}>
          <AlertPanel />
        </div>
        <main style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>

      {/* Overlays */}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}
