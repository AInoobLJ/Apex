import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const PAGE_SHORTCUTS: Record<string, string> = {
  '1': '/',
  '2': '/edges',
  '3': '/execution',
  '4': '/portfolio',
  '5': '/crypto',
  '6': '/backtest',
  '7': '/settings',
  '8': '/system',
};

const SHORTCUT_LABELS: Record<string, string> = {
  '1': 'Markets',
  '2': 'Edges',
  '3': 'Execution',
  '4': 'Portfolio',
  '5': 'Crypto',
  '6': 'Backtest',
  '7': 'Settings',
  '8': 'System',
  '/': 'Search / Command Palette',
  '?': 'Show shortcuts',
};

export function useKeyboardShortcuts(onOpenPalette?: () => void) {
  const navigate = useNavigate();
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture when typing in inputs/textareas
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Don't capture when modifier keys are held (allow browser shortcuts)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key;

    // Page navigation: 1-8
    if (PAGE_SHORTCUTS[key]) {
      e.preventDefault();
      navigate(PAGE_SHORTCUTS[key]);
      return;
    }

    // / opens command palette
    if (key === '/' && onOpenPalette) {
      e.preventDefault();
      onOpenPalette();
      return;
    }

    // ? toggles help overlay
    if (key === '?') {
      e.preventDefault();
      setShowHelp(prev => !prev);
      return;
    }

    // Escape closes help
    if (key === 'Escape' && showHelp) {
      setShowHelp(false);
    }
  }, [navigate, onOpenPalette, showHelp]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return { showHelp, setShowHelp, SHORTCUT_LABELS };
}
