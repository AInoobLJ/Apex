export function formatVolume(value: number | null | undefined): string {
  if (value == null || value === 0) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function formatCents(price: number | null | undefined): string {
  if (price == null) return '\u2014'; // em dash
  return `${(price * 100).toFixed(0)}\u00A2`; // cents symbol
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '\u2014';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  // Future dates
  if (diffMs < 0) {
    const absDiff = Math.abs(diffMs);
    const hours = Math.floor(absDiff / 3_600_000);
    if (hours < 1) return 'in <1h';
    if (hours < 24) return `in ${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `in ${days}d`;
    if (days < 365) {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Past dates
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatUSD(value: number | null | undefined, decimals = 2): string {
  if (value == null) return '\u2014';
  return `$${value.toFixed(decimals)}`;
}
