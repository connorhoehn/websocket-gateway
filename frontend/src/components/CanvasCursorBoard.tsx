// frontend/src/components/CanvasCursorBoard.tsx
//
// Canvas cursor board — a bounded drawing area that broadcasts mouse position
// with tool/color/size metadata. Remote cursors appear as colored circles
// with tool labels. Ephemeral trail particles are added on every mousemove
// event (both local and remote) and auto-removed after 1000ms.
//
// Part of Phase 07, Plan 07-04 (CURS-06).

import { useRef, useState, useCallback, useEffect } from 'react';
import type { RemoteCursor, CanvasTool } from '../hooks/useCursors';
import { identityToColor, identityToInitials } from '../utils/identity';

// ---------------------------------------------------------------------------
// Trail helper
// ---------------------------------------------------------------------------

function addTrail(
  boardRef: React.RefObject<HTMLDivElement | null>,
  x: number,
  y: number,
  tool: CanvasTool | string,
  color: string,
  size: number
) {
  const board = boardRef.current;
  if (!board) return;

  const dot = document.createElement('div');
  dot.style.position = 'absolute';
  dot.style.borderRadius = '50%';
  dot.style.pointerEvents = 'none';
  dot.style.zIndex = '5';

  const t = tool as CanvasTool;

  switch (t) {
    case 'pen':
      dot.style.width = '2px';
      dot.style.height = '2px';
      dot.style.backgroundColor = color;
      dot.style.opacity = '0.8';
      break;
    case 'brush':
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.backgroundColor = color;
      dot.style.opacity = '0.6';
      break;
    case 'eraser':
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.backgroundColor = 'rgba(255,255,255,0.8)';
      dot.style.border = '1px solid #ccc';
      dot.style.opacity = '0.7';
      break;
    case 'select':
    default:
      dot.style.width = '1px';
      dot.style.height = '1px';
      dot.style.backgroundColor = color;
      dot.style.opacity = '0.5';
      break;
  }

  // Position centered at cursor point.
  const dotSize = parseFloat(dot.style.width) || 2;
  dot.style.left = `${x - dotSize / 2}px`;
  dot.style.top = `${y - dotSize / 2}px`;

  board.appendChild(dot);

  setTimeout(() => {
    if (board.contains(dot)) {
      board.removeChild(dot);
    }
  }, 1000);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CanvasCursorBoardProps {
  cursors: Map<string, RemoteCursor>;
  localCursor?: RemoteCursor | null;
  onMouseMove: (x: number, y: number, tool: CanvasTool, color: string, size: number) => void;
  width?: number;
  height?: number;
}

export function CanvasCursorBoard({
  cursors,
  localCursor,
  onMouseMove,
  width = 600,
  height = 300,
}: CanvasCursorBoardProps) {
  const [tool, setTool] = useState<CanvasTool>('brush');
  const [color, setColor] = useState('#007bff');
  const [size, setSize] = useState(5);

  // Ref to the board div — trail particles are appended here imperatively
  // to avoid React re-renders on every mousemove.
  const boardRef = useRef<HTMLDivElement>(null);

  // Throttle timer for 50ms leading-edge mousemove rate-limiting.
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Add local trail on every event (not throttled — visual feedback).
      addTrail(boardRef, x, y, tool, color, size);

      // Throttle broadcast: leading-edge 50ms.
      if (throttleTimerRef.current !== null) return;
      onMouseMove(x, y, tool, color, size);
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
      }, 50);
    },
    [tool, color, size, onMouseMove]
  );

  const tools: CanvasTool[] = ['brush', 'pen', 'eraser', 'select'];
  const toolLabels: Record<CanvasTool, string> = {
    brush: 'Brush',
    pen: 'Pen',
    eraser: 'Eraser',
    select: 'Select',
  };

  // Render remote canvas cursors filtered by mode.
  const canvasCursors = Array.from(cursors.values()).filter(
    (c) => (c.metadata.mode as string) === 'canvas'
  );

  return (
    <div>
      {/* Tool controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Tool:</span>
          {tools.map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                border: '1px solid',
                borderRadius: 4,
                cursor: 'pointer',
                background: tool === t ? '#007bff' : 'white',
                color: tool === t ? 'white' : '#374151',
                borderColor: tool === t ? '#007bff' : '#ddd',
              }}
            >
              {toolLabels[t]}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Color:</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 32, height: 24, cursor: 'pointer', border: 'none', padding: 0 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#6b7280' }}>Size: {size}</span>
          <input
            type="range"
            min={1}
            max={50}
            value={size}
            onChange={(e) => setSize(parseInt(e.target.value, 10))}
            style={{ width: 80, cursor: 'pointer' }}
          />
        </div>
      </div>

      {/* Board area */}
      <div
        ref={boardRef}
        onMouseMove={handleMouseMove}
        style={{
          position: 'relative',
          width,
          height,
          border: '2px solid #e5e7eb',
          borderRadius: 4,
          overflow: 'hidden',
          cursor: 'crosshair',
          backgroundImage:
            'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
      >
        {/* Board label */}
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
          Move your mouse here (canvas mode)
        </span>

        {/* Local canvas cursor */}
        {localCursor && (localCursor.metadata.mode as string) === 'canvas' && (() => {
          const lx = localCursor.position.x as number;
          const ly = localCursor.position.y as number;
          const localTool = (localCursor.metadata.tool as CanvasTool | undefined) ?? 'brush';
          return (
            <div
              style={{
                position: 'absolute',
                left: lx,
                top: ly,
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 11,
                pointerEvents: 'none',
                userSelect: 'none',
                opacity: 0.7,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: '#3b82f6',
                  border: '2px dashed white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: 9,
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}
              >
                You
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 2,
                  color: 'white',
                  background: '#3b82f6',
                  opacity: 0.85,
                  borderRadius: 3,
                  padding: '1px 4px',
                  whiteSpace: 'nowrap',
                }}
              >
                You ({localTool})
              </div>
            </div>
          );
        })()}

        {/* Remote canvas cursors */}
        {canvasCursors.map((cursor) => {
          const cx = cursor.position.x as number;
          const cy = cursor.position.y as number;
          const cursorColor = identityToColor(
            (cursor.metadata.displayName as string | undefined) ?? cursor.clientId
          );
          const initials = identityToInitials(
            (cursor.metadata.displayName as string | undefined) ?? cursor.clientId.slice(0, 2)
          );
          const remoteTool = (cursor.metadata.tool as CanvasTool | undefined) ?? 'brush';
          const remoteSize = (cursor.metadata.size as number | undefined) ?? 5;

          // Add trail for each remote cursor update imperatively.
          // We use a key-based approach: add the trail particle via a ref
          // callback since React doesn't re-invoke effect on same data.
          // Actually we append the trail directly in the cursor div's ref.

          return (
            <RemoteCursorWithTrail
              key={cursor.clientId}
              x={cx}
              y={cy}
              color={cursorColor}
              initials={initials}
              tool={remoteTool}
              size={remoteSize}
              boardRef={boardRef}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RemoteCursorWithTrail — sub-component that adds a trail whenever it renders
// with new position data.
// ---------------------------------------------------------------------------

interface RemoteCursorWithTrailProps {
  x: number;
  y: number;
  color: string;
  initials: string;
  tool: CanvasTool;
  size: number;
  boardRef: React.RefObject<HTMLDivElement | null>;
}

function RemoteCursorWithTrail({
  x,
  y,
  color,
  initials,
  tool,
  size,
  boardRef,
}: RemoteCursorWithTrailProps) {
  // Add a trail particle every time position changes.
  useEffect(() => {
    addTrail(boardRef, x, y, tool, color, size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 10,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Cursor circle with initials */}
      <div
        style={{
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
        }}
      >
        {initials}
      </div>

      {/* Tool label below cursor */}
      <div
        style={{
          fontSize: 11,
          marginTop: 2,
          color: 'white',
          background: color,
          opacity: 0.85,
          borderRadius: 3,
          padding: '1px 4px',
          whiteSpace: 'nowrap',
        }}
      >
        {initials} ({tool})
      </div>
    </div>
  );
}
