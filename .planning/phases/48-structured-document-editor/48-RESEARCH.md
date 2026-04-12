# Phase 48: Structured Document Editor - Research

**Researched:** 2026-04-11
**Domain:** Real-time collaborative structured document editing with CRDTs (Y.js + Tiptap)
**Confidence:** HIGH

## Summary

Building a collaborative structured document editor on top of the existing Y.js + WebSocket gateway infrastructure requires replacing the current `contentEditable` + `document.execCommand` editor with Tiptap (ProseMirror-based), wiring it to Y.js via `@tiptap/extension-collaboration`, and modeling the document as a hierarchy of custom Tiptap nodes (sections, decisions, tasks) backed by `Y.XmlFragment`.

The existing `useCRDT.ts` hook manages a single `Y.Text` with binary update relay through the gateway. For structured documents, the Y.js binding changes from `Y.Text` to `Y.XmlFragment` (which Tiptap/ProseMirror requires), and the update relay protocol stays identical -- binary Y.js updates encoded as base64 over WebSocket. The gateway `crdt-service.js` does not need to understand document structure; it relays opaque binary updates.

**Primary recommendation:** Use Tiptap 3.x with `@tiptap/extension-collaboration` + `@tiptap/y-tiptap` binding, custom node extensions for structured blocks (Section, Decision, Task), and a custom Y.js provider that bridges to the existing WebSocket gateway. Persist as both Y.js binary snapshots (for CRDT state) and Tiptap JSON (for queryable content in DynamoDB).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | 13.6.30 | CRDT engine | Already installed; de facto standard for browser CRDTs |
| @tiptap/react | 3.22.3 | React editor wrapper | Leading ProseMirror wrapper; headless, extensible, React-native |
| @tiptap/starter-kit | 3.22.3 | Base node/mark set | Paragraphs, headings, lists, code blocks, bold, italic, etc. |
| @tiptap/extension-collaboration | 3.22.3 | Y.js binding for Tiptap | Official bridge: maps Y.XmlFragment to ProseMirror doc |
| @tiptap/y-tiptap | 3.0.3 | Tiptap-specific y-prosemirror fork | ySyncPlugin, yCursorPlugin, yUndoPlugin tuned for Tiptap |
| @tiptap/extension-collaboration-cursor | 2.26.2 | Multi-user cursors | Shows other users' carets with names/colors |
| @tiptap/extension-task-list | 3.22.3 | Task list nodes | Built-in checkbox lists that integrate with collaboration |
| @tiptap/extension-task-item | 3.22.3 | Task item nodes | Individual checkable items within task lists |
| @tiptap/markdown | 3.22.3 | Markdown import/export | Parse markdown to Tiptap JSON and serialize back |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tiptap/extension-list | 3.22.3 | Enhanced list rendering | Already includes TaskList; unified list handling |
| puppeteer | 24.40.0 | PDF export | Server-side HTML-to-PDF via headless Chrome |
| googleapis | latest | Google Docs export | Drive API upload with HTML mimetype conversion |
| lib0 | (yjs dep) | Observable base class | Custom provider extends `lib0/observable.Observable` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tiptap | Raw ProseMirror + y-prosemirror | More control but 5x more boilerplate; Tiptap wraps ProseMirror cleanly |
| Tiptap | Lexical (Meta) | Lexical Y.js bindings are less mature; Tiptap ecosystem is deeper |
| Puppeteer for PDF | @react-pdf/renderer | React-PDF generates from scratch; Puppeteer renders existing HTML faithfully |
| tiptap-markdown (community) | @tiptap/markdown (official) | Official package is now available in Tiptap 3.x; use official |

**Installation:**
```bash
cd frontend
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-collaboration \
  @tiptap/y-tiptap @tiptap/extension-collaboration-cursor \
  @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/markdown \
  @tiptap/extension-list
```

**Version verification:** All versions confirmed via `npm view` on 2026-04-11.

## Architecture Patterns

### Recommended Project Structure
```
frontend/src/
├── components/
│   └── document-editor/
│       ├── DocumentEditor.tsx          # Main editor wrapper
│       ├── StructuredDocToolbar.tsx     # Toolbar with section/task/decision controls
│       ├── nodes/
│       │   ├── SectionNode.tsx         # Custom React node view for sections
│       │   ├── DecisionNode.tsx        # Custom React node view for decisions
│       │   ├── TaskBlockNode.tsx       # Custom React node view for task blocks
│       │   └── AcknowledgeButton.tsx   # Check-off/acknowledge UI
│       └── extensions/
│           ├── section-extension.ts    # Tiptap Node.create for Section
│           ├── decision-extension.ts   # Tiptap Node.create for Decision
│           ├── task-block-extension.ts # Tiptap Node.create for TaskBlock
│           └── acknowledge-extension.ts# Mark or node for acknowledgments
├── hooks/
│   ├── useCRDT.ts                     # EXISTING — keep for plain text channels
│   ├── useStructuredDoc.ts            # NEW — Y.Doc + Tiptap editor lifecycle
│   └── useGatewayProvider.ts          # NEW — custom Y.js provider bridging gateway WS
├── lib/
│   ├── GatewayYjsProvider.ts          # Custom Y.js provider class
│   ├── markdown-to-tiptap.ts          # AI markdown → structured Tiptap JSON
│   └── tiptap-to-exports.ts           # Export to markdown, HTML, PDF, GDocs
└── types/
    └── structured-doc.ts              # TypeScript interfaces for doc schema
```

### Pattern 1: Y.XmlFragment as Document Root

**What:** Tiptap's collaboration extension binds a `Y.XmlFragment` (not `Y.Text`) to the ProseMirror document state. The XML fragment mirrors ProseMirror's tree structure: nodes with attributes and nested content.

**When to use:** Always, when using Tiptap + Y.js collaboration.

**Example:**
```typescript
// Source: Tiptap Collaboration docs
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';

const ydoc = new Y.Doc();

const editor = useEditor({
  extensions: [
    StarterKit.configure({ history: false }), // CRITICAL: disable built-in history
    Collaboration.configure({
      document: ydoc,
      field: 'body', // maps to ydoc.getXmlFragment('body')
    }),
    CollaborationCursor.configure({
      provider: gatewayProvider, // custom provider (see Pattern 3)
      user: { name: 'Alice', color: '#f783ac' },
    }),
  ],
});
```

### Pattern 2: Custom Node Extensions for Structured Blocks

**What:** Define custom Tiptap nodes for Section, Decision, TaskBlock with React node views. Each node type has typed attributes (title, status, assignee, checked) that are CRDT-synced automatically.

**When to use:** For any block that has metadata beyond rich text (status, assignees, timestamps).

**Example:**
```typescript
// Source: Tiptap Node API docs + React Node Views docs
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import SectionNodeView from '../nodes/SectionNode';

export const SectionExtension = Node.create({
  name: 'section',
  group: 'block',
  content: 'heading block+', // must start with heading, then any blocks
  defining: true,

  addAttributes() {
    return {
      id: { default: null },
      status: { default: 'draft' }, // draft | reviewed | approved
      order: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="section"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'section' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SectionNodeView);
  },
});
```

```tsx
// SectionNode.tsx — React node view
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';

export default function SectionNodeView({ node, updateAttributes }) {
  return (
    <NodeViewWrapper data-type="section" style={{ borderLeft: '3px solid #3b82f6', paddingLeft: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
          Section #{node.attrs.order}
        </span>
        <select
          value={node.attrs.status}
          onChange={(e) => updateAttributes({ status: e.target.value })}
          style={{ fontSize: '0.7rem' }}
        >
          <option value="draft">Draft</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
        </select>
      </div>
      <NodeViewContent /> {/* editable rich text content */}
    </NodeViewWrapper>
  );
}
```

### Pattern 3: Custom Y.js Provider Bridging Gateway WebSocket

**What:** Instead of using y-websocket (which needs its own server), create a `GatewayYjsProvider` that sends Y.js binary updates through the existing WebSocket gateway `crdt-service.js` relay. The gateway already handles `crdt:update` and `crdt:snapshot` message types.

**When to use:** Always in this project — the gateway already relays Y.js binary updates.

**Example:**
```typescript
// Source: Yjs custom provider docs + existing useCRDT.ts patterns
import * as Y from 'yjs';
import { Observable } from 'lib0/observable';
import { Awareness } from 'y-protocols/awareness';

export class GatewayYjsProvider extends Observable<string> {
  doc: Y.Doc;
  awareness: Awareness;
  private channel: string;
  private sendMessage: (msg: Record<string, unknown>) => void;
  private unregisterHandler: (() => void) | null = null;

  constructor(
    doc: Y.Doc,
    channel: string,
    sendMessage: (msg: Record<string, unknown>) => void,
    onMessage: (handler: (msg: any) => void) => () => void,
  ) {
    super();
    this.doc = doc;
    this.channel = channel;
    this.sendMessage = sendMessage;
    this.awareness = new Awareness(doc);

    // Listen for local Y.Doc updates → relay to gateway
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // skip updates we applied from remote
      const b64 = Buffer.from(update).toString('base64');
      this.sendMessage({
        service: 'crdt',
        action: 'update',
        channel: this.channel,
        update: b64,
      });
    });

    // Listen for incoming gateway messages
    this.unregisterHandler = onMessage((msg: any) => {
      if (msg.type === 'crdt:snapshot' && msg.channel === this.channel) {
        const bytes = Buffer.from(msg.snapshot, 'base64');
        Y.applyUpdate(this.doc, bytes, this); // origin=this to avoid echo
      }
      if (msg.type === 'crdt:update' && msg.channel === this.channel) {
        const bytes = Buffer.from(msg.update, 'base64');
        Y.applyUpdate(this.doc, bytes, this); // origin=this to avoid echo
      }
    });

    // Subscribe to channel
    this.sendMessage({ service: 'crdt', action: 'subscribe', channel });
  }

  destroy() {
    this.unregisterHandler?.();
    this.awareness.destroy();
    this.doc.off('update', this._updateHandler);
    super.destroy();
  }
}
```

### Pattern 4: Dual Persistence (Binary Snapshot + JSON)

**What:** Store Y.js state as binary snapshot (for CRDT merge/restore) AND as Tiptap JSON (for querying/indexing in DynamoDB). The binary snapshot is the source of truth for collaboration; JSON is a read-optimized projection.

**When to use:** When you need to query document content (search tasks, filter by status) without loading the Y.js document.

**Example:**
```typescript
// On each checkpoint write (gateway-side or Lambda):
const binarySnapshot = Y.encodeStateAsUpdate(ydoc); // for CRDT restore
const tiptapJson = editor.getJSON();                 // for querying

// DynamoDB item:
{
  PK: `DOC#${documentId}`,
  SK: `SNAPSHOT#${timestamp}`,
  snapshot: binarySnapshot,   // Binary attribute
  content: JSON.stringify(tiptapJson), // S attribute for queries
  timestamp: Date.now(),
}
```

### Pattern 5: Markdown Import Pipeline

**What:** AI generates markdown → parse to Tiptap JSON → load into Y.Doc → users collaborate.

**When to use:** Initial document creation from AI-generated summaries.

**Example:**
```typescript
import { Markdown } from '@tiptap/markdown';

// Step 1: AI produces markdown string
const aiMarkdown = `# Meeting Summary\n\n## Decisions\n- [ ] Approve budget\n...`;

// Step 2: Parse markdown into Tiptap JSON using the Markdown extension
const editor = new Editor({
  extensions: [StarterKit, Markdown, SectionExtension, TaskBlockExtension],
  content: aiMarkdown,
  contentType: 'markdown',
});
const tiptapJson = editor.getJSON();

// Step 3: Load JSON into collaborative editor
collaborativeEditor.commands.setContent(tiptapJson);
// Y.js syncs the change to all connected clients automatically

// Step 4: Optionally, post-process to wrap sections in custom nodes
// This is where you'd run a transform to identify headings + their content
// and wrap them in SectionExtension nodes with metadata
```

### Pattern 6: Subdocuments for Section-Level Splitting

**What:** Y.js subdocuments allow each section to be a separate `Y.Doc` that loads lazily. The root doc contains a `Y.Map` of section metadata pointing to subdocument GUIDs. Each subdocument syncs independently.

**When to use:** Large documents (50+ sections) where you want to lazy-load sections and allow independent editing per section.

**Tradeoff:** Significantly more complex provider logic. Each subdocument needs its own sync channel. For documents under ~20 sections, a single Y.Doc with Tiptap nodes is simpler and performant.

**Recommendation:** Start with a SINGLE Y.Doc per document. Use Tiptap's node hierarchy (section nodes containing content) for logical splitting. Only introduce subdocuments if performance becomes an issue.

```typescript
// IF subdocuments become necessary:
const rootDoc = new Y.Doc();
const sections = rootDoc.getMap('sections');

// Add a section as subdocument
const sectionDoc = new Y.Doc();
sectionDoc.getText('title').insert(0, 'Budget Review');
sections.set('section-001', sectionDoc);

// Lazy load on another client
rootDoc.on('subdocs', ({ loaded }) => {
  loaded.forEach(subdoc => {
    // Create a provider for this subdoc's GUID
    new GatewayYjsProvider(subdoc, `doc:${docId}:section:${subdoc.guid}`, sendMessage, onMessage);
  });
});
```

### Anti-Patterns to Avoid
- **Using Y.Text for rich text editing:** Y.Text stores plain strings. Tiptap requires Y.XmlFragment for its ProseMirror binding. The existing `useCRDT.ts` approach of `ydoc.getText('content')` does NOT work with Tiptap.
- **Replacing entire document content on each edit:** The current `applyLocalEdit` deletes all text and re-inserts. This defeats CRDT conflict resolution. Tiptap + y-prosemirror handles granular operations automatically.
- **Using `document.execCommand`:** Deprecated API. Tiptap handles all formatting through its command system with proper CRDT integration.
- **Storing only Y.js binary snapshots:** Binary blobs cannot be queried. Always store a JSON projection alongside for search/filter operations.
- **Using Hocuspocus when you already have a WebSocket gateway:** The existing gateway + `crdt-service.js` already handles Y.js update relay. Adding Hocuspocus would duplicate WebSocket infrastructure.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rich text CRDT editing | Custom contentEditable + Y.Text | Tiptap + @tiptap/extension-collaboration | ProseMirror's transform system handles all edge cases (cursor, selection, schema validation) |
| Markdown parsing | Custom regex parser | @tiptap/markdown | Handles GFM, code blocks, nested lists, frontmatter correctly |
| Collaborative cursors | Custom cursor overlay | @tiptap/extension-collaboration-cursor | Handles selection ranges, cursor decorations, user colors |
| Undo/redo in collab | Custom undo stack | yUndoPlugin (included in @tiptap/y-tiptap) | Scoped to local client; won't undo another user's changes |
| Y.js binary sync protocol | Custom diff/patch | Y.encodeStateAsUpdate / Y.applyUpdate | Proven CRDT merge algorithm; handles offline, reorder, duplicates |
| PDF export from rich HTML | Custom PDF layout engine | Puppeteer page.pdf() | Handles CSS, images, page breaks faithfully |
| Google Docs creation | Manual Docs API batch requests | Drive API upload with HTML mimetype | Single API call converts HTML to Google Doc |

**Key insight:** The entire point of Tiptap + Y.js is that you never touch the CRDT operations directly. You define a schema (nodes, marks), Tiptap maps user interactions to ProseMirror transactions, and y-prosemirror maps those transactions to Y.js operations. Your code only defines the schema and UI.

## Common Pitfalls

### Pitfall 1: Not Disabling Built-in History
**What goes wrong:** Tiptap's default undo/redo conflicts with Y.js's undo manager, causing duplicate or lost operations.
**Why it happens:** StarterKit includes `history` extension by default.
**How to avoid:** `StarterKit.configure({ history: false })` -- always, when using Collaboration extension.
**Warning signs:** Ctrl+Z undoes other users' changes; undo stack behaves erratically.

### Pitfall 2: Y.Text vs Y.XmlFragment Confusion
**What goes wrong:** Using `ydoc.getText()` with Tiptap produces empty or broken editors.
**Why it happens:** The existing `useCRDT.ts` uses `Y.Text`. Tiptap requires `Y.XmlFragment` for its ProseMirror document binding.
**How to avoid:** Use `Collaboration.configure({ document: ydoc, field: 'body' })` which internally calls `ydoc.getXmlFragment('body')`. OR pass fragment directly: `Collaboration.configure({ fragment: ydoc.getXmlFragment('body') })`.
**Warning signs:** Editor renders but content doesn't sync; console errors about incompatible types.

### Pitfall 3: applyLocalEdit Pattern Defeats CRDT
**What goes wrong:** The current pattern of delete-all + insert-all on every keystroke causes all remote cursors to jump to position 0 and generates massive Y.js updates.
**Why it happens:** The current `useCRDT.ts` treats the Y.Doc as a dumb string store.
**How to avoid:** Let Tiptap + y-prosemirror handle granular character-level operations. Never call `ytext.delete(0, ytext.length)` followed by `ytext.insert(0, newText)` for collaborative editing.
**Warning signs:** Collaborators' text jumps around; large binary updates on every keystroke.

### Pitfall 4: Provider Echo Loop
**What goes wrong:** Provider applies a remote update, which triggers the `doc.on('update')` handler, which sends it back to the server, creating an infinite loop.
**Why it happens:** Not filtering by `origin` parameter.
**How to avoid:** When applying remote updates, pass the provider as origin: `Y.applyUpdate(doc, bytes, this)`. In the update handler, skip if `origin === this`.
**Warning signs:** Exponentially growing message traffic; browser freezes.

### Pitfall 5: Large Document Performance
**What goes wrong:** Documents with 100+ sections become slow to load and sync.
**Why it happens:** Y.js encodes the full document history; large documents produce large snapshots.
**How to avoid:** Use `Y.encodeStateAsUpdate(doc)` for snapshots (not the full history). Periodically compact via `Y.applyUpdate(newDoc, Y.encodeStateAsUpdate(oldDoc))`. Consider subdocuments for truly large docs.
**Warning signs:** Snapshot size exceeding 1MB; load time exceeding 2 seconds.

### Pitfall 6: Awareness Provider Mismatch
**What goes wrong:** CollaborationCursor extension requires an `Awareness` instance from the provider, but custom providers often forget to expose it.
**Why it happens:** The `provider` option in CollaborationCursor expects an object with `.awareness` property.
**How to avoid:** The custom GatewayYjsProvider must create and expose `this.awareness = new Awareness(doc)`. Wire awareness updates through the gateway (or a separate channel).
**Warning signs:** Cursors don't appear for other users; `provider.awareness is undefined` errors.

## Code Examples

### Complete Editor Setup with Custom Provider
```typescript
// Source: Tiptap Collaboration docs + Yjs custom provider patterns
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Markdown } from '@tiptap/markdown';
import * as Y from 'yjs';
import { GatewayYjsProvider } from '../lib/GatewayYjsProvider';
import { SectionExtension } from './extensions/section-extension';
import { DecisionExtension } from './extensions/decision-extension';

interface Props {
  documentId: string;
  sendMessage: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: any) => void) => () => void;
  user: { name: string; color: string };
}

export function DocumentEditor({ documentId, sendMessage, onMessage, user }: Props) {
  const [ydoc] = useState(() => new Y.Doc());
  const [provider] = useState(
    () => new GatewayYjsProvider(ydoc, `doc:${documentId}`, sendMessage, onMessage)
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: ydoc, field: 'body' }),
      CollaborationCursor.configure({ provider, user }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      SectionExtension,
      DecisionExtension,
    ],
  });

  // Cleanup
  useEffect(() => () => { provider.destroy(); ydoc.destroy(); }, []);

  return <EditorContent editor={editor} />;
}
```

### Markdown Import to Structured Document
```typescript
// Parse AI markdown into structured Tiptap JSON with section wrappers
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

export function markdownToStructuredJson(markdown: string) {
  // Step 1: Parse raw markdown to flat Tiptap JSON
  const tempEditor = new Editor({
    extensions: [StarterKit, Markdown],
    content: markdown,
    contentType: 'markdown',
  });
  const flatJson = tempEditor.getJSON();
  tempEditor.destroy();

  // Step 2: Post-process to wrap heading + following content into section nodes
  const structuredContent = [];
  let currentSection = null;

  for (const node of flatJson.content || []) {
    if (node.type === 'heading' && node.attrs?.level <= 2) {
      if (currentSection) structuredContent.push(currentSection);
      currentSection = {
        type: 'section',
        attrs: { id: crypto.randomUUID(), status: 'draft', order: structuredContent.length },
        content: [node],
      };
    } else if (currentSection) {
      currentSection.content.push(node);
    } else {
      structuredContent.push(node); // content before first heading
    }
  }
  if (currentSection) structuredContent.push(currentSection);

  return { type: 'doc', content: structuredContent };
}
```

### Export Pipeline
```typescript
// Export from Tiptap editor to various formats
export function exportToMarkdown(editor: Editor): string {
  return editor.markdown.serialize(editor.getJSON());
}

export function exportToHtml(editor: Editor): string {
  return editor.getHTML();
}

// PDF export (server-side Lambda or API endpoint)
export async function exportToPdf(html: string): Promise<Buffer> {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`
    <html><head><style>
      body { font-family: system-ui; max-width: 800px; margin: 40px auto; }
      [data-type="section"] { border-left: 3px solid #3b82f6; padding-left: 12px; margin-bottom: 16px; }
    </style></head><body>${html}</body></html>
  `, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdf;
}

// Google Docs export (server-side)
export async function exportToGoogleDocs(html: string, title: string): Promise<string> {
  const { google } = require('googleapis');
  const { Readable } = require('stream');
  const drive = google.drive({ version: 'v3', auth: await getAuthClient() });
  const res = await drive.files.create({
    requestBody: { name: title, mimeType: 'application/vnd.google-apps.document' },
    media: { mimeType: 'text/html', body: Readable.from(html) },
  });
  return `https://docs.google.com/document/d/${res.data.id}/edit`;
}
```

### DynamoDB Dual Persistence
```typescript
// Store both binary CRDT state and queryable JSON
import * as Y from 'yjs';

export function serializeForStorage(ydoc: Y.Doc, editor: Editor) {
  const binarySnapshot = Y.encodeStateAsUpdate(ydoc);
  const tiptapJson = editor.getJSON();

  // Extract structured metadata for DynamoDB GSI queries
  const sections = [];
  const tasks = [];
  for (const node of tiptapJson.content || []) {
    if (node.type === 'section') {
      sections.push({ id: node.attrs.id, status: node.attrs.status });
    }
    if (node.type === 'taskItem') {
      tasks.push({ checked: node.attrs.checked });
    }
  }

  return {
    PK: { S: `DOC#${documentId}` },
    SK: { S: `SNAPSHOT#${Date.now()}` },
    snapshot: { B: binarySnapshot },
    content: { S: JSON.stringify(tiptapJson) },
    sectionCount: { N: String(sections.length) },
    taskCount: { N: String(tasks.length) },
    completedTasks: { N: String(tasks.filter(t => t.checked).length) },
    timestamp: { N: String(Date.now()) },
  };
}

// Restore from storage
export function restoreFromSnapshot(ydoc: Y.Doc, snapshotBytes: Uint8Array) {
  Y.applyUpdate(ydoc, snapshotBytes);
  // Tiptap auto-syncs because it observes the Y.XmlFragment
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| contentEditable + execCommand | Tiptap/ProseMirror with schema | 2020+ | execCommand is deprecated; ProseMirror is the standard |
| y-prosemirror (community) | @tiptap/y-tiptap (official fork) | 2024 | Tiptap-specific fixes for undo, cursor, schema |
| Hocuspocus required | Any Y.js provider works | Always | Custom providers with existing WS infrastructure are first-class |
| tiptap-markdown (community) | @tiptap/markdown (official) | 2025 | Official package with Lexer API, better GFM support |
| Single binary blob persistence | Dual binary + JSON persistence | Best practice | Enables querying without Y.js deserialization |

**Deprecated/outdated:**
- `document.execCommand()`: Removed from standards; does not integrate with CRDT sync
- `y-prosemirror` direct usage with Tiptap: Use `@tiptap/y-tiptap` instead (Tiptap fork with fixes)
- Tiptap v1.x/v2.x collaboration: v3.x has significant collaboration improvements

## Open Questions

1. **Awareness relay through gateway**
   - What we know: Tiptap's CollaborationCursor needs an Awareness instance. Awareness uses its own CRDT protocol for cursor positions.
   - What's unclear: The existing gateway `crdt-service.js` only relays `crdt:update` messages. Awareness messages need a separate channel or message type (e.g., `crdt:awareness`).
   - Recommendation: Add an `awareness` action to `crdt-service.js` that broadcasts awareness state the same way updates are broadcast. Low effort -- same relay pattern.

2. **Document channel naming for structured docs**
   - What we know: Current CRDT channels are plain strings (e.g., channel name). Structured docs need a document-specific channel.
   - What's unclear: Channel naming convention for document editing vs. freeform text channels.
   - Recommendation: Use `doc:{documentId}` as the channel name for structured document sessions.

3. **Checkpoint frequency for large structured docs**
   - What we know: Current `crdt-service.js` writes periodic snapshots every 5 minutes.
   - What's unclear: Whether structured documents with many sections need more frequent checkpoints or per-section checkpoints.
   - Recommendation: Keep 5-minute global checkpoint. Add checkpoint-on-status-change (when a section is marked "approved").

4. **AI markdown structure variability**
   - What we know: The markdown-to-structured-JSON pipeline assumes H1/H2 headings delimit sections.
   - What's unclear: How consistent AI-generated markdown formatting will be across different AI models/prompts.
   - Recommendation: Define a strict markdown template for AI output. Post-processing should be forgiving (fallback: treat entire content as one section).

## Sources

### Primary (HIGH confidence)
- [Tiptap Collaboration Extension docs](https://tiptap.dev/docs/editor/extensions/functionality/collaboration) - setup, configuration, Y.js binding
- [Tiptap React Node Views docs](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react) - ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent
- [Tiptap Markdown docs](https://tiptap.dev/docs/editor/markdown/getting-started/installation) - @tiptap/markdown parse/serialize
- [Tiptap TaskList/TaskItem docs](https://tiptap.dev/docs/editor/extensions/nodes/task-list) - built-in checkbox lists
- [Tiptap Export/Conversion docs](https://tiptap.dev/docs/conversion/getting-started/overview) - PDF, DOCX, Markdown export
- [Y.js GitHub / Docs](https://github.com/yjs/yjs) - shared types, subdocuments, serialization
- [Y.XmlFragment docs](https://docs.yjs.dev/api/shared-types/y.xmlfragment) - tree-structured shared type
- [Y.js Subdocuments docs](https://docs.yjs.dev/api/subdocuments) - lazy loading, GUIDs, events
- [Yjs custom provider discussion](https://discuss.yjs.dev/t/how-to-implement-a-custom-yjs-provider/2152) - Observable pattern, update handlers

### Secondary (MEDIUM confidence)
- [Google Drive API HTML upload](https://medium.com/@rovinabi/the-easy-mode-for-generating-google-docs-using-the-drive-api-and-html-01eb7976df29) - HTML-to-Google-Doc conversion pattern
- [Puppeteer HTML to PDF](https://blog.risingstack.com/pdf-from-html-node-js-puppeteer/) - server-side PDF generation patterns
- [Yjs persistence discussion](https://discuss.yjs.dev/t/how-to-implement-data-persistence-on-the-server-side/259) - snapshot + update persistence strategies

### Tertiary (LOW confidence)
- [y-dynamodb npm package](https://www.npmjs.com/package/y-dynamodb) - DynamoDB persistence adapter (community, may not fit custom gateway model)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all packages verified via npm, official Tiptap docs confirm integration patterns
- Architecture: HIGH - patterns derived from official docs + existing project infrastructure analysis
- Pitfalls: HIGH - documented in official docs and community forums; several match existing project issues (Y.Text vs Y.XmlFragment)
- Export pipeline: MEDIUM - Puppeteer and Drive API patterns well-documented but Google Docs integration needs auth setup

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (Tiptap 3.x is stable; Y.js 13.x is stable)
