// frontend/src/components/pipelines/canvas/QuickInsertPopover.tsx
//
// Quick-insert palette per PIPELINES_PLAN.md §18.4.3 / §18.11 — appears when
// the user double-clicks blank canvas. Presents a small searchable list of
// node types; Enter inserts the top (highlighted) match at the captured flow
// position, Escape / outside-click closes without inserting.
//
// The shape matches the app's existing popovers (`DocumentHeader.tsx`'s
// overflow menu, `IconPicker.tsx`'s emoji popover): white surface, 1px border,
// 8px radius, soft shadow, 260px wide. The node metadata (icon + description)
// mirrors `NodePalette.tsx` so both entry points stay visually consistent.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type { NodeType } from '../../../types/pipeline';
import { colors } from '../../../constants/styles';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface QuickInsertPopoverProps {
  /** Screen coordinates where the popover anchors. */
  anchor: { x: number; y: number } | null;
  /** Flow-space position where the new node will be placed. */
  flowPosition: { x: number; y: number } | null;
  /** Types to hide (e.g. ['trigger'] if one is already placed). */
  disabledTypes?: NodeType[];
  onClose: () => void;
  onInsert: (type: NodeType, position: { x: number; y: number }) => void;
}

// ---------------------------------------------------------------------------
// Node catalog — kept in the same order / with the same copy as NodePalette
// so both entry points (drag-from-palette + quick-insert) feel unified.
// ---------------------------------------------------------------------------

interface QuickInsertItem {
  type: NodeType;
  icon: string;
  name: string;
  description: string;
}

const ITEMS: QuickInsertItem[] = [
  { type: 'trigger',   icon: '⚡', name: 'Trigger',   description: 'Starts the pipeline' },
  { type: 'llm',       icon: '🧠', name: 'LLM',       description: 'Call an LLM model' },
  { type: 'transform', icon: '🔧', name: 'Transform', description: 'Reshape the context' },
  { type: 'condition', icon: '🔀', name: 'Condition', description: 'Branch on an expression' },
  { type: 'fork',      icon: '🍴', name: 'Fork',      description: 'Split into parallel branches' },
  { type: 'join',      icon: '🔗', name: 'Join',      description: 'Combine parallel branches' },
  { type: 'action',    icon: '🎯', name: 'Action',    description: 'Produce a side effect' },
  { type: 'approval',  icon: '✅', name: 'Approval',  description: 'Wait for a human decision' },
];

function matches(item: QuickInsertItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.type.toLowerCase().includes(q) ||
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Styles — aligned with DocumentHeader's overflow dropdown / IconPicker popover
// ---------------------------------------------------------------------------

const POPOVER_WIDTH = 260;

function popoverStyle(anchor: { x: number; y: number }): CSSProperties {
  return {
    position: 'fixed',
    top: anchor.y,
    left: anchor.x,
    width: POPOVER_WIDTH,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    boxShadow: '0 12px 28px rgba(15,23,42,0.14)',
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
  };
}

const searchWrapStyle: CSSProperties = {
  padding: 8,
  borderBottom: `1px solid ${colors.border}`,
};

const searchStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${colors.borderField}`,
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
  background: '#f9fafb',
  color: colors.textPrimary,
  outline: 'none',
};

const listStyle: CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
  padding: '4px 0',
};

function rowStyle(highlighted: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    cursor: 'pointer',
    background: highlighted ? colors.surfaceHover : 'transparent',
    fontFamily: 'inherit',
  };
}

const iconStyle: CSSProperties = {
  fontSize: 18,
  lineHeight: 1,
  width: 22,
  textAlign: 'center',
  flexShrink: 0,
};

const nameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: colors.textPrimary,
};

const descStyle: CSSProperties = {
  fontSize: 11,
  color: colors.textSecondary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const emptyStyle: CSSProperties = {
  padding: '14px 12px',
  fontSize: 12,
  color: colors.textTertiary,
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QuickInsertPopover({
  anchor,
  flowPosition,
  disabledTypes = [],
  onClose,
  onInsert,
}: QuickInsertPopoverProps) {
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const disabledSet = useMemo(() => new Set(disabledTypes), [disabledTypes]);

  const filtered = useMemo(
    () => ITEMS.filter((item) => !disabledSet.has(item.type) && matches(item, query)),
    [disabledSet, query],
  );

  // Reset highlight whenever the filter result set changes so the top row is
  // always the Enter target; clamp if the previous index is now out of range.
  useEffect(() => {
    setHighlightIdx((idx) => (idx >= filtered.length ? 0 : idx));
  }, [filtered.length]);

  // Auto-focus the search input when the popover opens.
  useEffect(() => {
    if (anchor) {
      // Defer focus to the next tick to avoid fighting React Flow's own
      // focus handling on the dblclick gesture.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [anchor]);

  // Close on outside mousedown.
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node | null;
      if (popoverRef.current && node && popoverRef.current.contains(node)) {
        return;
      }
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [anchor, onClose]);

  if (!anchor) return null;

  const commit = (idx: number) => {
    const item = filtered[idx];
    if (!item || !flowPosition) return;
    onInsert(item.type, flowPosition);
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlightIdx((idx) => (idx + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlightIdx((idx) => (idx - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(highlightIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={popoverRef}
      style={popoverStyle(anchor)}
      role="dialog"
      aria-label="Quick insert node"
      data-testid="quick-insert-popover"
    >
      <div style={searchWrapStyle}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search nodes…"
          style={searchStyle}
          aria-label="Search node types"
          data-testid="quick-insert-search"
        />
      </div>
      <div style={listStyle} role="listbox">
        {filtered.length === 0 ? (
          <div style={emptyStyle}>No nodes match "{query}"</div>
        ) : (
          filtered.map((item, idx) => {
            const highlighted = idx === highlightIdx;
            return (
              <div
                key={item.type}
                role="option"
                aria-selected={highlighted}
                onMouseEnter={() => setHighlightIdx(idx)}
                onMouseDown={(e) => {
                  // Use mousedown (not click) so the outside-mousedown handler
                  // does not fire before the row's click handler — committing
                  // synchronously on mousedown avoids that race.
                  e.preventDefault();
                  commit(idx);
                }}
                style={rowStyle(highlighted)}
                data-node-type={item.type}
                data-testid={`quick-insert-row-${item.type}`}
              >
                <span style={iconStyle} aria-hidden>
                  {item.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={nameStyle}>{item.name}</div>
                  <div style={descStyle}>{item.description}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
