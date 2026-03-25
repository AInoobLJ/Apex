import React from 'react';
import { colors } from '../theme';

const shimmerKeyframes = `
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.textContent = shimmerKeyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

export function Skeleton({ width = '100%', height = '16px', borderRadius = '4px' }: {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}) {
  injectStyle();
  return (
    <div style={{
      width: typeof width === 'number' ? `${width}px` : width,
      height: typeof height === 'number' ? `${height}px` : height,
      borderRadius,
      background: `linear-gradient(90deg, ${colors.bgTertiary} 25%, ${colors.bgSecondary} 50%, ${colors.bgTertiary} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.5s infinite ease-in-out',
    }} />
  );
}

export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  injectStyle();
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', gap: '12px', padding: '10px 12px', marginBottom: '8px' }}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width={i === 1 ? '200px' : '80px'} height="12px" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{
          display: 'flex',
          gap: '12px',
          padding: '12px',
          borderBottom: `1px solid ${colors.border}20`,
        }}>
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} width={c === 1 ? '200px' : '80px'} height="14px" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ height = '80px' }: { height?: string }) {
  return (
    <div style={{
      backgroundColor: colors.bgSecondary,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      padding: '16px',
      height,
    }}>
      <Skeleton width="60%" height="12px" />
      <div style={{ marginTop: '12px' }}>
        <Skeleton width="40%" height="24px" />
      </div>
    </div>
  );
}
