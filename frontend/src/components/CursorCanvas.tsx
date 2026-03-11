// frontend/src/components/CursorCanvas.tsx
//
// Freeform cursor overlay — absolute-positioned container with mousemove
// broadcasting and remote cursor circles.
//
// Part of Phase 07 presence/cursors. Renders a bounded area where mouse
// movement is tracked and broadcast, and remote users' cursors are shown
// as colored circles with their initials.

import type { RemoteCursor } from '../hooks/useCursors';
import { identityToColor, identityToInitials } from '../utils/identity';

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
        const color = identityToColor(
          (cursor.metadata.displayName as string | undefined) ?? cursor.clientId
        );
        const initials = identityToInitials(
          (cursor.metadata.displayName as string | undefined) ?? cursor.clientId.slice(0, 2)
        );

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
