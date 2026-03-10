// frontend/src/components/CursorCanvas.tsx
//
// Freeform cursor overlay — absolute-positioned container with mousemove
// broadcasting and remote cursor circles.
//
// Part of Phase 07 presence/cursors. Renders a bounded area where mouse
// movement is tracked and broadcast, and remote users' cursors are shown
// as colored circles with their initials.

import type { RemoteCursor } from '../hooks/useCursors';

// ---------------------------------------------------------------------------
// Color / initials helpers (deterministic from clientId)
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
  '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
  '#1DD1A1', '#F368E0', '#3742FA', '#2F3542', '#FF3838',
];

export function clientIdToColor(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

export function clientIdToInitials(clientId: string): string {
  return clientId.substring(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CursorCanvasProps {
  cursors: Map<string, RemoteCursor>;
  onMouseMove: (x: number, y: number) => void;
  width?: number;
  height?: number;
}

export function CursorCanvas({
  cursors,
  onMouseMove,
  width = 600,
  height = 300,
}: CursorCanvasProps) {
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    onMouseMove(x, y);
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      style={{
        position: 'relative',
        width,
        height,
        border: '2px solid #e5e7eb',
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'none',
        backgroundImage:
          'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }}
    >
      {/* Label */}
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          color: '#9ca3af',
          fontSize: 12,
          padding: 4,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        Move your mouse here
      </span>

      {/* Remote cursor circles */}
      {Array.from(cursors.values()).map((cursor) => {
        const x = cursor.position.x as number;
        const y = cursor.position.y as number;
        const color =
          (cursor.metadata.userColor as string | undefined) ??
          clientIdToColor(cursor.clientId);
        const initials =
          (cursor.metadata.userInitials as string | undefined) ??
          clientIdToInitials(cursor.clientId);

        return (
          <div
            key={cursor.clientId}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 10,
              fontWeight: 'bold',
              boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
              zIndex: 10,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {initials}
          </div>
        );
      })}
    </div>
  );
}
