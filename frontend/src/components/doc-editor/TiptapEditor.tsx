// frontend/src/components/doc-editor/TiptapEditor.tsx
//
// Reusable Tiptap editor with Y.js collaboration and custom cursor overlay.
// Uses awareness protocol for cursor positions, rendered as a React overlay
// instead of the broken yCursorPlugin/CollaborationCursor extension.

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
// Must import from @tiptap/y-tiptap (not y-prosemirror) because Tiptap's
// Collaboration extension uses its own PluginKey instance from this package.
// Using y-prosemirror's key would never match the actual sync plugin state.
import { ySyncPluginKey, absolutePositionToRelativePosition, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap';
import EditorToolbar from './EditorToolbar';

/** Minimal provider shape needed by awareness. */
export interface CollaborationProvider {
  awareness: Awareness;
}

export interface TiptapEditorProps {
  fragment: XmlFragment;
  ydoc: Y.Doc;
  provider: CollaborationProvider | null;
  user: { name: string; color: string };
  editable?: boolean;
  placeholder?: string;
  /** Section ID — used to filter cursor overlay to only show cursors in this section */
  sectionId?: string;
}

// ---------------------------------------------------------------------------
// Remote cursor data from awareness
// ---------------------------------------------------------------------------

interface RemoteCursorInfo {
  clientId: number;
  name: string;
  color: string;
  // Absolute positions in the ProseMirror doc
  anchor: number | null;
  head: number | null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const wrapperStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  overflow: 'hidden',
  position: 'relative',
};

const editorAreaStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 14,
  lineHeight: 1.6,
  color: '#1e293b',
  position: 'relative',
};

// Inject global ProseMirror styles once
const PROSEMIRROR_STYLE_ID = 'tiptap-prosemirror-style';
if (typeof document !== 'undefined' && !document.getElementById(PROSEMIRROR_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = PROSEMIRROR_STYLE_ID;
  style.textContent = `
    .ProseMirror {
      min-height: 80px;
      outline: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .ProseMirror p { margin: 0 0 0.5em; }
    .ProseMirror:focus { outline: none; }
    .ProseMirror .is-empty::before {
      content: attr(data-placeholder);
      color: #94a3b8;
      pointer-events: none;
      float: left;
      height: 0;
    }
    @keyframes cursorBlink {
      0%, 100% { opacity: 0.7; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Helper: get pixel coordinates for a ProseMirror position
// ---------------------------------------------------------------------------

function getCoords(view: any, pos: number): { top: number; left: number; height: number } | null {
  try {
    if (pos < 0 || pos > view.state.doc.content.size) return null;
    const coords = view.coordsAtPos(pos);
    const editorRect = view.dom.getBoundingClientRect();
    return {
      top: coords.top - editorRect.top,
      left: coords.left - editorRect.left,
      height: coords.bottom - coords.top,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cursor Overlay Component
// ---------------------------------------------------------------------------

function CursorOverlay({ cursors, editorView }: {
  cursors: RemoteCursorInfo[];
  editorView: any;
}) {
  if (!editorView) return null;

  return (
    <>
      {cursors.map((c) => {
        if (c.head == null) return null;
        const coords = getCoords(editorView, c.head);
        if (!coords) return null;

        const initials = c.name
          .split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2)
          || c.name.slice(0, 2).toUpperCase();

        // Selection highlight
        let selectionEl = null;
        if (c.anchor != null && c.anchor !== c.head) {
          const startPos = Math.min(c.anchor, c.head);
          const endPos = Math.max(c.anchor, c.head);
          const startCoords = getCoords(editorView, startPos);
          const endCoords = getCoords(editorView, endPos);
          if (startCoords && endCoords) {
            selectionEl = (
              <div
                style={{
                  position: 'absolute',
                  top: startCoords.top,
                  left: startCoords.left,
                  width: Math.max(endCoords.left - startCoords.left, 4),
                  height: startCoords.height || 18,
                  background: c.color,
                  opacity: 0.15,
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            );
          }
        }

        return (
          <div key={c.clientId} style={{ pointerEvents: 'none' }}>
            {selectionEl}
            {/* Cursor caret */}
            <div
              style={{
                position: 'absolute',
                top: coords.top,
                left: coords.left - 1,
                width: 2,
                height: coords.height || 18,
                background: c.color,
                opacity: 0.7,
                borderRadius: 1,
                pointerEvents: 'none',
                zIndex: 10,
                animation: 'cursorBlink 1.2s ease-in-out infinite',
              }}
            />
            {/* Ghost glow */}
            <div
              style={{
                position: 'absolute',
                top: coords.top,
                left: coords.left - 4,
                width: 8,
                height: coords.height || 18,
                background: c.color,
                opacity: 0.1,
                borderRadius: 4,
                pointerEvents: 'none',
                zIndex: 9,
              }}
            />
            {/* Name badge */}
            <div
              style={{
                position: 'absolute',
                top: coords.top - 18,
                left: coords.left - 2,
                background: c.color,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '4px 4px 4px 0',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 11,
                opacity: 0.85,
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
              }}
              title={c.name}
            >
              {initials}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function TiptapEditor({
  fragment,
  ydoc,
  provider,
  user,
  editable = true,
  placeholder: placeholderText = 'Start typing...',
  sectionId,
}: TiptapEditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extensions = useMemo(() => [
    StarterKit.configure({ history: false } as any),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: placeholderText }),
    Collaboration.configure({ document: ydoc, fragment }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [ydoc, fragment]);

  const editor = useEditor({
    extensions,
    editable,
  }, [extensions]);

  // ---- Custom cursor overlay using awareness directly ----
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursorInfo[]>([]);
  const editorAreaRef = useRef<HTMLDivElement>(null);

  // Set local awareness user info
  useEffect(() => {
    if (!provider?.awareness) return;
    provider.awareness.setLocalStateField('user', user);
  }, [provider, user]);

  // Listen for awareness changes and extract cursor positions
  const updateCursors = useCallback(() => {
    if (!provider?.awareness || !editor?.view) return;

    const states = provider.awareness.getStates();
    const localClientId = provider.awareness.clientID;
    const cursors: RemoteCursorInfo[] = [];

    states.forEach((state: any, clientId: number) => {
      if (clientId === localClientId) return;
      const u = state.user;
      if (!u || !state.cursor) return;
      // Only show cursors in this section's editor
      if (sectionId && state.cursor.sectionId !== sectionId) return;

      try {
        const ystate = ySyncPluginKey.getState(editor.view.state);
        if (!ystate?.type || !ystate?.binding?.mapping) return;

        const anchor = relativePositionToAbsolutePosition(
          ystate.doc, ystate.type,
          Y.createRelativePositionFromJSON(state.cursor.anchor),
          ystate.binding.mapping
        );
        const head = relativePositionToAbsolutePosition(
          ystate.doc, ystate.type,
          Y.createRelativePositionFromJSON(state.cursor.head),
          ystate.binding.mapping
        );

        cursors.push({
          clientId,
          name: u.name || `User ${clientId}`,
          color: u.color || '#3b82f6',
          anchor,
          head,
        });
      } catch {
        // ySyncPlugin not ready yet
      }
    });

    setRemoteCursors(cursors);
  }, [provider, editor]);

  // Update local cursor position in awareness when selection changes
  useEffect(() => {
    if (!editor?.view || !provider?.awareness) return;

    const handleTransaction = () => {
      try {
        const ystate = ySyncPluginKey.getState(editor.view.state);
        if (!ystate?.type || !ystate?.binding?.mapping) return;

        const { anchor, head } = editor.view.state.selection;
        const yAnchor = absolutePositionToRelativePosition(anchor, ystate.type, ystate.binding.mapping);
        const yHead = absolutePositionToRelativePosition(head, ystate.type, ystate.binding.mapping);

        provider.awareness.setLocalStateField('cursor', { anchor: yAnchor, head: yHead, sectionId });
      } catch {
        // ySyncPlugin not ready
      }
    };

    // Only listen to selectionUpdate — NOT 'update' which fires for remote
    // changes too and creates a feedback loop (remote update → cursor send →
    // server broadcast → all editors react → repeat).
    editor.on('selectionUpdate', handleTransaction);
    // Send initial position
    handleTransaction();

    return () => {
      editor.off('selectionUpdate', handleTransaction);
    };
  }, [editor, provider, sectionId]);

  // Listen for remote awareness changes — only on awareness 'change', NOT editor 'update'
  useEffect(() => {
    if (!provider?.awareness) return;
    const handler = () => updateCursors();
    provider.awareness.on('change', handler);
    return () => {
      provider.awareness.off('change', handler);
    };
  }, [provider, updateCursors]);

  return (
    <div style={wrapperStyle}>
      {editable && <EditorToolbar editor={editor} />}
      <div ref={editorAreaRef} style={editorAreaStyle}>
        <EditorContent editor={editor} />
        {/* Custom cursor overlay — rendered as React elements, not ProseMirror decorations */}
        <CursorOverlay cursors={remoteCursors} editorView={editor?.view} />
      </div>
    </div>
  );
}
