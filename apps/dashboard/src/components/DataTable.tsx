import React from 'react';
import { colors, fonts } from '../theme';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
  width?: string;
  minWidth?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  rowAccent?: (row: T) => string | undefined;
}

export function DataTable<T extends Record<string, unknown>>({
  columns, data, onRowClick, sortKey, sortDir, onSort, emptyMessage, rowAccent,
}: DataTableProps<T>) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
        fontFamily: fonts.mono,
        fontSize: '13px',
      }}>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                onClick={() => col.sortable && onSort?.(col.key)}
                style={{
                  padding: '10px 12px',
                  textAlign: (col.align || 'left') as 'left' | 'right' | 'center',
                  borderBottom: `1px solid ${colors.border}`,
                  color: colors.textSecondary,
                  fontWeight: 500,
                  fontSize: '11px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  cursor: col.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  width: col.width,
                  minWidth: col.minWidth,
                  whiteSpace: 'nowrap',
                  position: 'sticky',
                  top: 0,
                  backgroundColor: colors.bg,
                  zIndex: 1,
                }}
              >
                {col.label}
                {col.sortable && sortKey === col.key && (
                  <span style={{ marginLeft: '4px', color: colors.accent }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{
                padding: '60px 40px',
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: '14px',
              }}>
                <div style={{ fontSize: '28px', marginBottom: '8px', opacity: 0.4 }}>
                  {'\u2014'}
                </div>
                {emptyMessage || 'No data'}
              </td>
            </tr>
          ) : (
            data.map((row, i) => {
              const accent = rowAccent?.(row);
              return (
                <tr
                  key={i}
                  onClick={() => onRowClick?.(row)}
                  style={{
                    cursor: onRowClick ? 'pointer' : 'default',
                    borderBottom: `1px solid ${colors.border}40`,
                    borderLeft: accent ? `3px solid ${accent}` : '3px solid transparent',
                    transition: 'background-color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = colors.bgTertiary;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                  }}
                >
                  {columns.map(col => (
                    <td key={col.key} style={{
                      padding: '10px 12px',
                      textAlign: (col.align || 'left') as 'left' | 'right' | 'center',
                      color: colors.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: col.width,
                      minWidth: col.minWidth,
                    }}>
                      {col.render
                        ? col.render(row[col.key], row)
                        : String(row[col.key] ?? '\u2014')}
                    </td>

                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
