// frontend/src/components/TableCursorGrid.tsx
//
// 10-row x 6-column spreadsheet grid.
// Broadcasts cell-click positions via the cursor service (mode: 'table').
// Renders colored cell-border indicators with initials badges for remote cursors
// that have metadata.mode === 'table'.

import type { RemoteCursor } from '../hooks/useCursors';
import { identityToColor, identityToInitials } from '../utils/identity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableCursorGridProps {
  cursors: Map<string, RemoteCursor>;
  localCursor?: RemoteCursor | null;
  onCellClick: (row: number, col: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COL_HEADERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const ROW_COUNT = 10;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TableCursorGrid({ cursors, localCursor, onCellClick }: TableCursorGridProps) {
  // Determine local cursor cell position.
  let localCursorKey: string | null = null;
  if (localCursor && (localCursor.metadata as Record<string, unknown>).mode === 'table') {
    const pos = localCursor.position as { row?: number; col?: number };
    if (pos.row != null && pos.col != null) {
      localCursorKey = `${pos.row},${pos.col}`;
    }
  }

  // Build a lookup: "row,col" -> RemoteCursor[] for efficient cell lookup.
  const cellCursors = new Map<string, RemoteCursor[]>();
  cursors.forEach((cursor) => {
    if ((cursor.metadata as Record<string, unknown>).mode !== 'table') return;
    const pos = cursor.position as { row?: number; col?: number };
    if (pos.row == null || pos.col == null) return;
    const key = `${pos.row},${pos.col}`;
    const existing = cellCursors.get(key) ?? [];
    existing.push(cursor);
    cellCursors.set(key, existing);
  });

  return (
    <div
      style={{
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 4,
      }}
    >
      <table
        style={{
          borderCollapse: 'collapse',
          width: '100%',
        }}
      >
        <thead>
          <tr>
            {/* empty corner cell */}
            <th
              style={{
                fontWeight: 'bold',
                background: '#f9fafb',
                padding: '6px',
                minWidth: 40,
                textAlign: 'center',
                border: '1px solid #e5e7eb',
              }}
            />
            {COL_HEADERS.map((header) => (
              <th
                key={header}
                style={{
                  fontWeight: 'bold',
                  background: '#f9fafb',
                  padding: '6px',
                  minWidth: 80,
                  textAlign: 'center',
                  border: '1px solid #e5e7eb',
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: ROW_COUNT }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {/* Row header */}
              <th
                style={{
                  fontWeight: 'bold',
                  background: '#f9fafb',
                  padding: '6px',
                  minWidth: 40,
                  textAlign: 'center',
                  border: '1px solid #e5e7eb',
                }}
              >
                {rowIndex + 1}
              </th>

              {/* Data cells */}
              {COL_HEADERS.map((_, colIndex) => {
                const key = `${rowIndex},${colIndex}`;
                const remoteCursorsOnCell = cellCursors.get(key) ?? [];

                return (
                  <td
                    key={colIndex}
                    onClick={() => onCellClick(rowIndex, colIndex)}
                    style={{
                      position: 'relative',
                      padding: 8,
                      minWidth: 80,
                      height: 30,
                      border: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      background: 'white',
                    }}
                  >
                    {/* Local cursor cell highlight */}
                    {localCursorKey === key && (
                      <div>
                        <div
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            border: '2px dashed #3b82f6',
                            borderRadius: 4,
                            pointerEvents: 'none',
                            zIndex: 9,
                          }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            top: -10,
                            right: 0,
                            fontSize: 10,
                            background: '#3b82f6',
                            color: 'white',
                            padding: '1px 4px',
                            borderRadius: 3,
                            pointerEvents: 'none',
                            zIndex: 19,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          You
                        </div>
                      </div>
                    )}

                    {/* Render a colored border overlay for each remote cursor on this cell */}
                    {remoteCursorsOnCell.map((cursor, i) => {
                      const color = identityToColor(
                        (cursor.metadata.displayName as string | undefined) ?? cursor.clientId
                      );
                      const initials = identityToInitials(
                        (cursor.metadata.displayName as string | undefined) ?? cursor.clientId.slice(0, 2)
                      );
                      const borderWidth = 3 - Math.min(i, 1); // slight visual stacking
                      return (
                        <div key={cursor.clientId}>
                          {/* Cell-border indicator */}
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              border: `${borderWidth}px solid ${color}`,
                              borderRadius: 4,
                              boxShadow: `0 0 0 1px ${color}`,
                              pointerEvents: 'none',
                              zIndex: 10 + i,
                              opacity: 1 - i * 0.15,
                            }}
                          />
                          {/* Initials badge */}
                          <div
                            style={{
                              position: 'absolute',
                              top: -10,
                              left: i * 22,
                              fontSize: 10,
                              background: color,
                              color: 'white',
                              padding: '1px 4px',
                              borderRadius: 3,
                              pointerEvents: 'none',
                              zIndex: 20 + i,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {initials}
                          </div>
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
