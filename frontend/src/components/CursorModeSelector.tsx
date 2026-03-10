// frontend/src/components/CursorModeSelector.tsx
//
// Four-button mode selector for switching between cursor panel views:
// Freeform / Table / Text / Canvas.
//
// Active mode button is highlighted in blue. Switching calls onModeChange,
// which triggers switchMode in useCursors (unsubscribe → clear → resubscribe).
//
// Part of Phase 07, Plan 07-04 (CURS-07).

import type { CursorMode } from '../hooks/useCursors';

export type { CursorMode };

interface CursorModeSelectorProps {
  activeMode: CursorMode;
  onModeChange: (mode: CursorMode) => void;
}

const MODES: { mode: CursorMode; label: string }[] = [
  { mode: 'freeform', label: 'Freeform' },
  { mode: 'table', label: 'Table' },
  { mode: 'text', label: 'Text' },
  { mode: 'canvas', label: 'Canvas' },
];

export function CursorModeSelector({ activeMode, onModeChange }: CursorModeSelectorProps) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {MODES.map(({ mode, label }) => {
        const isActive = mode === activeMode;
        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            style={{
              padding: '8px 16px',
              border: '2px solid',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontFamily: 'monospace',
              background: isActive ? '#007bff' : 'white',
              color: isActive ? 'white' : '#374151',
              borderColor: isActive ? '#007bff' : '#d1d5db',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
