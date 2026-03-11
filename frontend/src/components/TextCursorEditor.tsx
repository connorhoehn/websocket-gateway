// frontend/src/components/TextCursorEditor.tsx
//
// Contenteditable shared document.
// Broadcasts character offset (and selection range) on click/keyup via the
// cursor service (mode: 'text').
// Renders colored line cursors and semi-transparent selection highlights for
// remote cursors that have metadata.mode === 'text'.

import { useRef } from 'react';
import type { RemoteCursor, TextSelectionData } from '../hooks/useCursors';
import { identityToColor, identityToInitials } from '../utils/identity';

// ---------------------------------------------------------------------------
// Character offset helpers (TreeWalker-based)
// ---------------------------------------------------------------------------

/**
 * Returns the character offset of the selection anchor from the container's
 * start by measuring the text in a Range from the container start to the
 * anchor node/offset.
 */
function getCharOffset(container: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  try {
    const range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(sel.anchorNode!, sel.anchorOffset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

/**
 * Returns selection start/end offsets and selected text, or null if the
 * selection is collapsed (no text selected).
 */
function getSelectionData(container: HTMLElement): TextSelectionData | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  try {
    const range = sel.getRangeAt(0);
    const preStart = document.createRange();
    preStart.setStart(container, 0);
    preStart.setEnd(range.startContainer, range.startOffset);
    const start = preStart.toString().length;
    return {
      start,
      end: start + range.toString().length,
      text: range.toString(),
    };
  } catch {
    return null;
  }
}

/**
 * Given a character offset into the container's text content, returns the
 * {top, left, height} of a caret at that position relative to the container.
 * Falls back to {top:0, left:0, height:18} if the DOM walk fails.
 */
function getTextCoordinates(
  container: HTMLElement,
  charOffset: number
): { top: number; left: number; height: number } {
  const FALLBACK = { top: 0, left: 0, height: 18 };
  try {
    const containerRect = container.getBoundingClientRect();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let remaining = charOffset;
    let node: Node | null;

    while ((node = walker.nextNode()) !== null) {
      const textNode = node as Text;
      const len = textNode.length;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(textNode, remaining);
        range.setEnd(textNode, remaining);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return FALLBACK;
        return {
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left,
          height: rect.height || 18,
        };
      }
      remaining -= len;
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TextCursorEditorProps {
  cursors: Map<string, RemoteCursor>;
  onPositionChange: (
    position: number,
    selectionData: TextSelectionData | null,
    hasSelection: boolean
  ) => void;
}

// ---------------------------------------------------------------------------
// Initial placeholder text
// ---------------------------------------------------------------------------

const INITIAL_TEXT =
  'This is a shared document. Click here to set your cursor position. Select text to broadcast a selection range.';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TextCursorEditor({ cursors, onPositionChange }: TextCursorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);

  function handleInteraction() {
    const editable = editableRef.current;
    if (!editable) return;
    const offset = getCharOffset(editable);
    const selection = getSelectionData(editable);
    onPositionChange(offset, selection, !!selection);
  }

  // Collect text-mode cursors.
  const textCursors: Array<{ cursor: RemoteCursor; position: number; color: string; initials: string }> = [];
  const selectionCursors: Array<{ cursor: RemoteCursor; start: number; end: number; color: string }> = [];

  cursors.forEach((cursor) => {
    if ((cursor.metadata as Record<string, unknown>).mode !== 'text') return;
    const color = identityToColor(
      (cursor.metadata.displayName as string | undefined) ?? cursor.clientId
    );
    const initials = identityToInitials(
      (cursor.metadata.displayName as string | undefined) ?? cursor.clientId.slice(0, 2)
    );
    const pos = cursor.position as { position?: number };
    if (pos.position != null) {
      textCursors.push({ cursor, position: pos.position, color, initials });
    }
    const meta = cursor.metadata as { hasSelection?: boolean; selection?: TextSelectionData | null };
    if (meta.hasSelection && meta.selection) {
      selectionCursors.push({
        cursor,
        start: meta.selection.start,
        end: meta.selection.end,
        color,
      });
    }
  });

  // Render cursor lines and selections relative to the editable div.
  // We compute coordinates only when the editable ref is available.
  const editable = editableRef.current;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        border: '1px solid #e5e7eb',
        borderRadius: 4,
        minHeight: 120,
        padding: 12,
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      {/* Contenteditable document */}
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        onClick={handleInteraction}
        onKeyUp={handleInteraction}
        style={{
          outline: 'none',
          minHeight: 80,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {INITIAL_TEXT}
      </div>

      {/* Remote cursor line overlays */}
      {editable &&
        textCursors.map(({ cursor, position, color, initials }) => {
          const coords = getTextCoordinates(editable, position);
          return (
            <div key={cursor.clientId} style={{ pointerEvents: 'none' }}>
              {/* Blinking caret line */}
              <div
                style={{
                  position: 'absolute',
                  top: coords.top + 12, // offset for container padding
                  left: coords.left + 12,
                  width: 2,
                  height: coords.height,
                  background: color,
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              />
              {/* Initials label above cursor */}
              <div
                style={{
                  position: 'absolute',
                  top: coords.top + 12 - 14,
                  left: coords.left + 12,
                  fontSize: 10,
                  background: color,
                  color: 'white',
                  padding: '1px 3px',
                  borderRadius: 2,
                  zIndex: 11,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {initials}
              </div>
            </div>
          );
        })}

      {/* Remote selection highlights */}
      {editable &&
        selectionCursors.map(({ cursor, start, end, color }) => {
          const startCoords = getTextCoordinates(editable, start);
          const endCoords = getTextCoordinates(editable, end);
          // Render a simple highlight box spanning from start to end.
          // For multi-line selections this is approximate (single bounding box).
          const top = Math.min(startCoords.top, endCoords.top) + 12;
          const left = startCoords.left + 12;
          const right = endCoords.left + 12;
          const width = Math.max(right - left, 4);
          const height = Math.max(startCoords.height, endCoords.height);
          return (
            <div
              key={`sel-${cursor.clientId}`}
              style={{
                position: 'absolute',
                top,
                left,
                width,
                height,
                background: `${color}40`,
                zIndex: 5,
                pointerEvents: 'none',
              }}
            />
          );
        })}
    </div>
  );
}
