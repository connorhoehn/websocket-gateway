// frontend/src/components/doc-editor/TiptapEditor.tsx
//
// Reusable Tiptap editor instance with Yjs collaboration support.

import { useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { Plugin } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import type { XmlFragment } from 'yjs';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import EditorToolbar from './EditorToolbar';

/** Minimal provider shape needed by the Collaboration Cursor extension. */
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
}

const wrapperStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  overflow: 'hidden',
};

const editorAreaStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 14,
  lineHeight: 1.6,
  color: '#1e293b',
};

// ProseMirror needs explicit styling to fill the container and allow multiline editing.
// Injected once globally since inline styles can't target child class selectors.
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
    /* Collaboration cursor — colored caret line */
    .collaboration-cursor__caret {
      border-left: 2.5px solid;
      border-right: none;
      margin-left: -1px;
      margin-right: -1px;
      pointer-events: none;
      position: relative;
      word-break: normal;
      opacity: 0.8;
      display: inline;
    }
    /* Collaboration cursor — floating name badge above caret */
    .collaboration-cursor__label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 2px 6px;
      border-radius: 4px 4px 4px 0;
      position: absolute;
      top: -1.8em;
      left: -2px;
      white-space: nowrap;
      color: #fff;
      pointer-events: none;
      user-select: none;
      opacity: 0.9;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      line-height: 1.3;
      z-index: 20;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Safe wrapper around CollaborationCursor that catches the init-time crash.
 * The crash occurs because createDecorations accesses ySyncPluginKey.getState(state).doc
 * during EditorState.reconfigure, before the ySyncPlugin state is initialized.
 * This wrapper intercepts the ProseMirror plugins and wraps their init methods.
 */
const SafeCollaborationCursor = CollaborationCursor.extend({
  addProseMirrorPlugins() {
    const originalPlugins = this.parent?.() ?? [];
    return originalPlugins.map((plugin: Plugin) => {
      const spec = { ...plugin.spec };
      if (spec.state) {
        const originalInit = spec.state.init;
        spec.state = {
          ...spec.state,
          init(...args: [unknown, unknown]) {
            try {
              return originalInit.apply(this, args);
            } catch {
              return DecorationSet.empty;
            }
          },
        };
      }
      return new Plugin(spec);
    });
  },
});

export default function TiptapEditor({
  fragment,
  ydoc,
  provider,
  user,
  editable = true,
  placeholder: placeholderText = 'Start typing...',
}: TiptapEditorProps) {
  const hasAwareness = !!provider?.awareness;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tiptap v2/v3 extension types don't unify cleanly
  const extensions = useMemo(() => {
    const exts: any[] = [
      StarterKit.configure({ history: false } as any),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholderText }),
      Collaboration.configure({ document: ydoc, fragment }),
    ];
    if (hasAwareness) {
      exts.push(SafeCollaborationCursor.configure({
        provider: provider!,
        user,
        render: (cursorUser: { name: string; color: string }) => {
          const cursor = document.createElement('span');
          cursor.classList.add('collaboration-cursor__caret');
          cursor.style.borderColor = cursorUser.color;

          const label = document.createElement('span');
          label.classList.add('collaboration-cursor__label');
          label.style.backgroundColor = cursorUser.color;
          // Show initials like "GR" for compact display, matching the TextCursorEditor style
          const initials = cursorUser.name
            .split(' ')
            .map((w: string) => w[0] ?? '')
            .join('')
            .toUpperCase()
            .slice(0, 2) || cursorUser.name.slice(0, 2).toUpperCase();
          label.textContent = initials;
          label.title = cursorUser.name;
          cursor.appendChild(label);

          return cursor;
        },
      }));
    }
    return exts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, fragment, hasAwareness]);

  const editor = useEditor({
    extensions,
    editable,
  }, [extensions]);

  return (
    <div style={wrapperStyle}>
      {editable && <EditorToolbar editor={editor} />}
      <div style={editorAreaStyle}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
