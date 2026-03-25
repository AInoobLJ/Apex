import { colors } from '../theme';

interface StatusBadgeProps {
  status: 'up' | 'down' | 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | string;
  label?: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  up: { bg: colors.greenDim, text: colors.green },
  healthy: { bg: colors.greenDim, text: colors.green },
  down: { bg: colors.redDim, text: colors.red },
  unhealthy: { bg: colors.redDim, text: colors.red },
  degraded: { bg: colors.yellowDim, text: colors.yellow },
  unknown: { bg: colors.bgTertiary, text: colors.textMuted },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const { bg, text } = STATUS_COLORS[status] || STATUS_COLORS.unknown;

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '3px 10px',
      borderRadius: '4px',
      backgroundColor: bg,
      color: text,
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: text,
      }} />
      {label || status}
    </span>
  );
}
