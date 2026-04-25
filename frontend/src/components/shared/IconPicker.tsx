// frontend/src/components/shared/IconPicker.tsx
//
// Small emoji picker used for choosing an icon on pipelines (and usable by
// other callers that want a lightweight curated-emoji chooser). Renders a
// trigger button showing the currently-selected emoji; clicking it opens a
// popover with an 8×6 grid of curated emojis and a custom-entry input.
//
// The popover closes on:
//   • selection from the grid
//   • pressing Enter in the custom input
//   • mousedown anywhere outside the popover / trigger

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { colors } from '../../constants/styles';

// ---------------------------------------------------------------------------
// Curated default set — 48 emojis covering flow, tools, comms, docs, data,
// nature, and fun. Laid out 8 per row × 6 rows in the grid.
// ---------------------------------------------------------------------------

export const DEFAULT_PIPELINE_ICONS: string[] = [
  '🔀', '🔁', '🔄', '⚙️', '🛠', '🧰', '🔧', '⚡',
  '🧠', '💡', '📊', '📈', '📉', '📋', '📝', '📄',
  '✉️', '💬', '📨', '📤', '📥', '🔔', '📢', '📡',
  '🚀', '🎯', '🎨', '🧪', '🔬', '🔭', '🧭', '🗺',
  '🗂', '📁', '🗃', '🗄', '💾', '🔒', '🔑', '🛡',
  '🌐', '🔗', '🔀', '⏩', '⏱', '🔍', '📌', '🏷',
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  curated?: string[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const triggerBtnStyle = (hovered: boolean): CSSProperties => ({
  width: 34,
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: 22,
  lineHeight: 1,
  background: hovered ? colors.surfaceHover : 'transparent',
  border: `1px solid ${hovered ? colors.borderEmphasis : colors.border}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  flexShrink: 0,
});

const popoverStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 6,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
  padding: 10,
  zIndex: 30,
  minWidth: 272,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(8, 28px)',
  gap: 4,
};

const cellStyle = (active: boolean, hovered: boolean): CSSProperties => ({
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: 16,
  lineHeight: 1,
  background: hovered ? colors.surfaceHover : 'transparent',
  border: `1px solid ${active ? colors.primary : 'transparent'}`,
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
});

const customRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 10,
  paddingTop: 10,
  borderTop: `1px solid ${colors.border}`,
};

const customInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: `1px solid ${colors.borderField}`,
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
  background: '#f9fafb',
  color: colors.textPrimary,
  outline: 'none',
};

// ---------------------------------------------------------------------------
// Grid cell (needs hover state per-cell)
// ---------------------------------------------------------------------------

function IconCell({
  emoji,
  active,
  onPick,
}: {
  emoji: string;
  active: boolean;
  onPick: (e: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onPick(emoji)}
      style={cellStyle(active, hovered)}
      aria-label={`Select ${emoji}`}
      aria-pressed={active}
    >
      {emoji}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IconPicker({
  value,
  onChange,
  curated,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [triggerHovered, setTriggerHovered] = useState(false);
  const [customDraft, setCustomDraft] = useState('');

  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const icons = curated ?? DEFAULT_PIPELINE_ICONS;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && rootRef.current.contains(t)) return;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const handlePick = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };

  const handleCustomCommit = () => {
    const next = customDraft.trim();
    if (next.length === 0) return;
    onChange(next);
    setCustomDraft('');
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        onMouseEnter={() => setTriggerHovered(true)}
        onMouseLeave={() => setTriggerHovered(false)}
        style={triggerBtnStyle(triggerHovered)}
        aria-label="Choose icon"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="icon-picker-trigger"
      >
        <span aria-hidden>{value}</span>
      </button>

      {open ? (
        <div ref={popoverRef} style={popoverStyle} data-testid="icon-picker-popover">
          <div style={gridStyle}>
            {icons.map((emoji, idx) => (
              <IconCell
                key={`${emoji}-${idx}`}
                emoji={emoji}
                active={emoji === value}
                onPick={handlePick}
              />
            ))}
          </div>
          <div style={customRowStyle}>
            <input
              type="text"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCustomCommit();
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder="Paste any emoji…"
              style={customInputStyle}
              data-testid="icon-picker-custom-input"
              aria-label="Custom emoji"
            />
            <button
              type="button"
              onClick={handleCustomCommit}
              disabled={customDraft.trim().length === 0}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                background: colors.primary,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor:
                  customDraft.trim().length === 0 ? 'not-allowed' : 'pointer',
                opacity: customDraft.trim().length === 0 ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              Set
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
