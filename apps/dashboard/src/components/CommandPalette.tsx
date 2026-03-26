import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../theme';
import { api } from '../api/client';

interface PaletteItem {
  id: string;
  label: string;
  sublabel?: string;
  path: string;
  type: 'page' | 'market';
}

const PAGES: PaletteItem[] = [
  { id: 'p-markets', label: 'Markets', sublabel: 'Market Explorer', path: '/', type: 'page' },
  { id: 'p-edges', label: 'Edges', sublabel: 'Edge Ranking', path: '/edges', type: 'page' },
  { id: 'p-execution', label: 'Execution', sublabel: 'Order Execution', path: '/execution', type: 'page' },
  { id: 'p-portfolio', label: 'Portfolio', sublabel: 'Positions & P&L', path: '/portfolio', type: 'page' },
  { id: 'p-crypto', label: 'Crypto', sublabel: 'Crypto Strategy', path: '/crypto', type: 'page' },
  { id: 'p-backtest', label: 'Backtest', sublabel: 'Performance Analytics', path: '/backtest', type: 'page' },
  { id: 'p-settings', label: 'Settings', sublabel: 'Risk Limits & Config', path: '/settings', type: 'page' },
  { id: 'p-system', label: 'System', sublabel: 'Health & Jobs', path: '/system', type: 'page' },
];

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PaletteItem[]>(PAGES);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [markets, setMarkets] = useState<PaletteItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Fetch markets for search
  useEffect(() => {
    api.listMarkets({ limit: 100, status: 'ACTIVE' })
      .then(res => {
        setMarkets(res.data.map(m => ({
          id: m.id,
          label: m.title,
          sublabel: `${m.platform} | ${m.category}`,
          path: `/markets/${m.id}`,
          type: 'market' as const,
        })));
      })
      .catch(() => {}); // Silently fail — markets just won't appear in palette
  }, []);

  // Filter on query change
  useEffect(() => {
    if (!query.trim()) {
      setItems(PAGES);
    } else {
      const allItems = [...PAGES, ...markets];
      const filtered = allItems.filter(item =>
        fuzzyMatch(query, item.label) || (item.sublabel && fuzzyMatch(query, item.sublabel))
      );
      setItems(filtered);
    }
    setSelectedIdx(0);
  }, [query, markets]);

  const handleSelect = useCallback((item: PaletteItem) => {
    navigate(item.path);
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(i => Math.min(i + 1, items.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter' && items[selectedIdx]) { handleSelect(items[selectedIdx]); return; }
  }, [items, selectedIdx, handleSelect, onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: colors.bgSecondary,
          border: `1px solid ${colors.border}`,
          borderRadius: 12, width: 520, maxHeight: '60vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search markets or navigate..."
            style={{
              width: '100%', backgroundColor: 'transparent', border: 'none',
              color: colors.text, fontSize: 15, fontFamily: fonts.sans,
              outline: 'none',
            }}
          />
        </div>

        {/* Results */}
        <div style={{ overflow: 'auto', maxHeight: '50vh' }}>
          {items.length === 0 ? (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans, textAlign: 'center' }}>
              No results
            </div>
          ) : (
            items.slice(0, 20).map((item, idx) => (
              <div
                key={item.id}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setSelectedIdx(idx)}
                style={{
                  padding: '10px 16px', cursor: 'pointer',
                  backgroundColor: idx === selectedIdx ? colors.bgTertiary : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <div style={{
                    fontSize: 13, color: colors.text, fontFamily: fonts.sans,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380,
                  }}>
                    {item.label}
                  </div>
                  {item.sublabel && (
                    <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 2 }}>
                      {item.sublabel}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono,
                  backgroundColor: colors.bgTertiary, padding: '2px 6px', borderRadius: 3,
                }}>
                  {item.type === 'page' ? 'PAGE' : 'MARKET'}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 16px', borderTop: `1px solid ${colors.border}`,
          display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans,
        }}>
          <span>Arrow keys to navigate</span>
          <span>Enter to select</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}
