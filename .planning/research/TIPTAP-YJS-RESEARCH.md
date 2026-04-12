# Tiptap + Y.js Collaborative Editor Research

**Researched:** 2026-04-11
**Domain:** Rich text collaborative editing (Tiptap, Y.js, ProseMirror)
**Confidence:** HIGH (verified against npm registry, official docs, and Y.js protocol spec)

---

## Summary

Tiptap is a headless rich-text editor framework built on ProseMirror. It has first-class Y.js integration via `@tiptap/extension-collaboration` (document sync) and `@tiptap/extension-collaboration-caret` (remote cursors). The current project already uses Y.js (`yjs@^13.6.29`) with a custom WebSocket gateway that relays binary Y.js updates encoded as base64 JSON messages. The existing `useCRDT` hook and `SharedTextEditor` component use a raw `contentEditable` div -- replacing this with Tiptap gives us structured document editing, real-time cursors, and a rich extension ecosystem for free.

The key architectural challenge is bridging Tiptap's expectation of a Y.js "provider" (like `y-websocket` or `HocuspocusProvider`) with this project's existing WebSocket gateway. Rather than adopting Hocuspocus or y-websocket's server, we need a **custom Y.js provider** that speaks the gateway's JSON protocol (`crdt:update`, `crdt:snapshot` messages) while exposing the standard provider interface that Tiptap's collaboration extensions expect.

**Primary recommendation:** Install `@tiptap/react` + `@tiptap/starter-kit` + `@tiptap/extension-collaboration` + `@tiptap/extension-collaboration-caret`. Build a thin `GatewayYjsProvider` class (~100 lines) that wraps the existing `useCRDT` message protocol and exposes `awareness` + Y.Doc sync. Keep Hocuspocus out -- the existing gateway already handles room routing and persistence.

---

## Standard Stack

### Core Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@tiptap/react` | 3.22.3 | React bindings for Tiptap editor |
| `@tiptap/pm` | 3.22.3 | ProseMirror dependency bundle |
| `@tiptap/starter-kit` | 3.22.3 | Bundle: Document, Paragraph, Text, Bold, Italic, Strike, Code, Heading, BulletList, OrderedList, Blockquote, CodeBlock, HardBreak, HorizontalRule, History (disable history when using collab) |
| `@tiptap/extension-collaboration` | 3.22.3 | Y.js document binding (wraps y-prosemirror) |
| `@tiptap/extension-collaboration-caret` | 3.22.3 | Remote cursor/selection display via Y.js Awareness |
| `@tiptap/extension-task-list` | 3.22.3 | Task list container node |
| `@tiptap/extension-task-item` | 3.22.3 | Checkbox list items |
| `@tiptap/extension-placeholder` | 3.22.3 | Placeholder text when editor is empty |
| `@tiptap/markdown` | 3.22.3 | Bidirectional Markdown parse/serialize |
| `@tiptap/suggestion` | 3.22.3 | Foundation for slash commands |
| `yjs` | 13.6.30 | CRDT library (already installed as ^13.6.29) |
| `y-prosemirror` | 1.3.7 | ProseMirror Y.js binding (peer dep of collaboration ext) |
| `y-protocols` | 1.0.7 | Sync + Awareness protocol encoding/decoding |

### Optional / Future

| Package | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tiptap/extension-link` | 3.22.3 | Autolink + paste link support | When adding link editing |
| `@tiptap/extension-image` | 3.22.3 | Image nodes | When adding image upload |
| `@tiptap/extension-code-block-lowlight` | 3.22.3 | Syntax-highlighted code blocks | When adding code editing |
| `@blocknote/react` | 0.47.3 | Notion-style block editor (built on Tiptap) | Only if pivoting to full block-based UI |
| `@hocuspocus/server` | 3.4.4 | Managed Y.js WebSocket backend | Only if replacing the custom gateway |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Tiptap | BlockNote (0.47.3) | Higher-level Notion-like blocks out of the box, but less control over extensions and harder to integrate with existing gateway |
| Custom provider | HocuspocusProvider | Would require running a separate Hocuspocus server or migrating the gateway -- unnecessary since we already have Y.js relay |
| Custom provider | y-websocket WebSocketProvider | Expects y-websocket's binary protocol on a dedicated WS endpoint -- incompatible with existing JSON-based gateway messages |
| @tiptap/markdown | tiptap-markdown (0.9.0) | Community package, works but @tiptap/markdown is now the official solution at v3 |

### Installation

```bash
cd frontend
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit \
  @tiptap/extension-collaboration @tiptap/extension-collaboration-caret \
  @tiptap/extension-task-list @tiptap/extension-task-item \
  @tiptap/extension-placeholder @tiptap/markdown @tiptap/suggestion \
  y-prosemirror y-protocols
```

Note: `yjs` is already installed. All `@tiptap/*` packages are pinned to 3.22.3 -- keep them in sync to avoid peer dependency conflicts.

---

## Architecture Patterns

### Recommended Project Structure

```
frontend/src/
├── components/
│   ├── editor/
│   │   ├── CollaborativeEditor.tsx    # Main Tiptap editor component
│   │   ├── EditorToolbar.tsx          # Toolbar buttons (bold, italic, etc.)
│   │   ├── SlashCommandMenu.tsx       # Slash command dropdown
│   │   └── CursorStyles.css           # Remote cursor styling
│   └── SharedTextEditor.tsx           # (existing -- will be replaced)
├── hooks/
│   ├── useCRDT.ts                     # (existing -- will be adapted)
│   └── useCollaborativeEditor.ts      # New: Tiptap + provider wiring
├── providers/
│   └── GatewayYjsProvider.ts          # Custom Y.js provider for gateway
└── types/
    └── gateway.ts                     # (existing)
```

### Pattern 1: Custom Y.js Provider for Existing Gateway

**What:** A class that bridges the Y.js provider interface with the project's existing WebSocket gateway JSON protocol.

**Why needed:** Tiptap's `@tiptap/extension-collaboration` expects a Y.js provider with an `awareness` property. The existing gateway uses JSON messages (`crdt:update`, `crdt:snapshot`) with base64-encoded Y.js updates, not the raw binary protocol that y-websocket expects.

**Implementation:**

```typescript
// frontend/src/providers/GatewayYjsProvider.ts
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import * as awarenessProtocol from 'y-protocols/awareness';

export interface GatewayProviderOptions {
  sendMessage: (msg: Record<string, unknown>) => void;
  channel: string;
}

/**
 * Custom Y.js provider that bridges Tiptap's collaboration extension
 * with the existing WebSocket gateway's JSON-based CRDT protocol.
 *
 * Unlike y-websocket's WebSocketProvider, this does NOT open its own
 * WebSocket connection. Instead it hooks into the gateway's message bus.
 */
export class GatewayYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private sendMessage: (msg: Record<string, unknown>) => void;
  private channel: string;
  private _synced = false;

  constructor(doc: Y.Doc, options: GatewayProviderOptions) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    this.sendMessage = options.sendMessage;
    this.channel = options.channel;

    // Listen for local Y.Doc updates and relay to gateway
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      // Only broadcast updates that originated locally (not from gateway)
      if (origin === this) return;
      const b64 = Buffer.from(update).toString('base64');
      this.sendMessage({
        service: 'crdt',
        action: 'update',
        channel: this.channel,
        update: b64,
      });
    });

    // Broadcast awareness changes to gateway
    this.awareness.on('update', ({ added, updated, removed }: {
      added: number[]; updated: number[]; removed: number[];
    }) => {
      const changedClients = added.concat(updated, removed);
      const encoded = awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        changedClients,
      );
      this.sendMessage({
        service: 'crdt',
        action: 'awareness',
        channel: this.channel,
        update: Buffer.from(encoded).toString('base64'),
      });
    });
  }

  /** Called when gateway delivers a crdt:update message */
  receiveUpdate(updateB64: string): void {
    const bytes = new Uint8Array(Buffer.from(updateB64, 'base64'));
    // Pass `this` as origin so the update handler above skips re-broadcasting
    Y.applyUpdate(this.doc, bytes, this);
  }

  /** Called when gateway delivers a crdt:snapshot message */
  receiveSnapshot(snapshotB64: string): void {
    const bytes = new Uint8Array(Buffer.from(snapshotB64, 'base64'));
    Y.applyUpdate(this.doc, bytes, this);
    this._synced = true;
  }

  /** Called when gateway delivers a crdt:awareness message */
  receiveAwareness(updateB64: string): void {
    const bytes = new Uint8Array(Buffer.from(updateB64, 'base64'));
    awarenessProtocol.applyAwarenessUpdate(this.awareness, bytes, this);
  }

  get synced(): boolean {
    return this._synced;
  }

  destroy(): void {
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      null,
    );
    this.awareness.destroy();
    this.doc.destroy();
  }
}
```

### Pattern 2: Tiptap Editor with Collaboration

**What:** Wiring the Tiptap editor to the custom provider.

```typescript
// frontend/src/components/editor/CollaborativeEditor.tsx
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import type { GatewayYjsProvider } from '../../providers/GatewayYjsProvider';

interface CollaborativeEditorProps {
  provider: GatewayYjsProvider;
  userName: string;
  userColor: string;
}

export function CollaborativeEditor({
  provider,
  userName,
  userColor,
}: CollaborativeEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Collaboration has its own history (undo/redo) management
        history: false,
      }),
      Collaboration.configure({
        document: provider.doc,
      }),
      CollaborationCaret.configure({
        provider: provider,
        user: {
          name: userName,
          color: userColor,
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder: 'Start typing or use / for commands...',
      }),
    ],
    // Don't set initial content -- collaboration extension loads from Y.Doc
  });

  return <EditorContent editor={editor} />;
}
```

### Pattern 3: JSON Serialization

**What:** Getting/setting editor content as JSON for storage or API calls.

```typescript
// Get JSON from editor
const json = editor.getJSON();
// Returns: { type: 'doc', content: [{ type: 'paragraph', content: [...] }] }

// Set content from JSON
editor.commands.setContent(json);

// Get HTML
const html = editor.getHTML();

// Get plain text
const text = editor.getText();
```

### Pattern 4: Markdown Conversion

**What:** Bidirectional Markdown support using @tiptap/markdown.

```typescript
import { Markdown } from '@tiptap/markdown';

// Add to extensions array:
Markdown.configure({
  html: true,           // Allow HTML in markdown
  tightLists: true,     // Compact list rendering
  bulletListMarker: '-', // Use - for bullets
})

// Then use:
// Parse markdown string to editor JSON
const json = editor.markdown.parse('# Hello **world**');

// Serialize current editor content to markdown
const md = editor.markdown.serialize(editor.state.doc.toJSON());

// Or via storage (if extension is registered):
const md = editor.storage.markdown.getMarkdown();
```

### Pattern 5: Slash Commands

**What:** A "/" menu for inserting blocks. Since the official extension is experimental/unpublished, build a custom one using `@tiptap/suggestion`.

```typescript
// frontend/src/components/editor/slash-commands.ts
import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

export interface SlashCommandItem {
  title: string;
  description: string;
  command: (props: { editor: any; range: any }) => void;
}

const items: SlashCommandItem[] = [
  {
    title: 'Heading 1',
    description: 'Large heading',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with checkboxes',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .toggleTaskList().run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Simple bullet list',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .toggleBulletList().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Code snippet',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .toggleCodeBlock().run();
    },
  },
  {
    title: 'Blockquote',
    description: 'Quote block',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .toggleBlockquote().run();
    },
  },
];

export const SlashCommands = Extension.create({
  name: 'slashCommands',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        items: ({ query }: { query: string }) =>
          items.filter((item) =>
            item.title.toLowerCase().includes(query.toLowerCase()),
          ),
        command: ({ editor, range, props }: any) => {
          props.command({ editor, range });
        },
        // render() must return a React component for the dropdown
        // -- see SlashCommandMenu.tsx
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
```

### Pattern 6: Remote Cursor CSS

```css
/* frontend/src/components/editor/CursorStyles.css */

/* Remote user caret line */
.collaboration-cursor__caret {
  border-left: 1px solid #0d0d0d;
  border-right: 1px solid #0d0d0d;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

/* Remote user name label */
.collaboration-cursor__label {
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  left: -1px;
  padding: 0.1rem 0.3rem;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}

/* Remote user selection highlight */
.ProseMirror .selection {
  display: inline;
}
```

### Anti-Patterns to Avoid

- **Using `contentEditable` with Y.js manually:** The current `SharedTextEditor.tsx` replaces innerHTML on every update. This destroys cursor position, breaks rich-text formatting, and does not leverage Y.js's structural CRDT. Tiptap + y-prosemirror handle the DOM binding correctly.

- **Replacing full Y.Text content on every keystroke:** The current `applyLocalEdit` does `ytext.delete(0, len); ytext.insert(0, newText)` -- this destroys collaboration because it tells Y.js "delete everything, insert everything" rather than "insert character at position X." Tiptap's `y-prosemirror` binding produces surgical per-character operations automatically.

- **Running Hocuspocus alongside the existing gateway:** The project already has a working WebSocket gateway with room routing, auth, and CRDT message relay. Adding Hocuspocus would mean running two WebSocket servers, duplicating connection management. Build a thin provider instead.

- **Disabling `history` in StarterKit but forgetting to:** Without `history: false` in StarterKit config, you get two competing undo/redo stacks (browser history vs. Y.js collaboration history). This causes ghost undos and data loss.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rich text + Y.js DOM binding | Manual contentEditable sync | `@tiptap/extension-collaboration` + `y-prosemirror` | Handles ProseMirror transactions, cursor preservation, and incremental Y.js operations |
| Remote cursor rendering | Custom cursor overlay divs | `@tiptap/extension-collaboration-caret` | Handles awareness protocol, caret positioning, name labels, color, selection highlighting |
| Markdown shortcuts in editor | Custom keydown handlers | Tiptap input rules (built into StarterKit) | `# ` becomes H1, `- ` becomes bullet, `1. ` becomes ordered list, etc. -- all built in |
| Slash command dropdown | Custom keydown + popup | `@tiptap/suggestion` | Handles positioning, filtering, keyboard navigation, and ProseMirror integration |
| Markdown serialization | Custom AST walker | `@tiptap/markdown` | Bidirectional parse/serialize with proper handling of all Tiptap node types |
| Undo/redo in collaboration | Browser undo or custom stack | Y.js UndoManager (built into collaboration extension) | Tracks per-user undo stacks across the collaborative document |

---

## Y.js Sync Protocol Reference

Understanding this is critical for the custom provider. The protocol uses two layers:

### Message Envelope

```
byte 0: message type
  0 = Sync protocol message
  1 = Awareness protocol message
```

### Sync Protocol (message type 0)

| Sub-type | Value | Payload | Direction |
|----------|-------|---------|-----------|
| SyncStep1 | 0 | `varByteArray(stateVector)` | Initiator -> Responder |
| SyncStep2 | 1 | `varByteArray(documentUpdate)` | Responder -> Initiator |
| Update | 2 | `varByteArray(update)` | Bidirectional |

**Initial sync handshake:**
1. Client sends SyncStep1 with its state vector
2. Server responds with SyncStep2 containing missing updates
3. Client sends SyncStep1 back (now server gets client's unique edits)
4. Ongoing: both sides send Update messages

**For our gateway:** The existing `crdt:snapshot` message is equivalent to SyncStep2 (full document state). The existing `crdt:update` message is equivalent to the Update message type. The gateway already handles the "dumb relay" pattern -- it just forwards updates between clients and persists snapshots to DynamoDB.

### Awareness Protocol (message type 1)

```
varUint(numberOfClients)
  for each client:
    varUint(clientId)
    varUint(clock)         // monotonically increasing
    json(state)            // { cursor, user, ... }
```

**For our gateway:** Currently there is no awareness relay. Adding `crdt:awareness` message type to the gateway is needed for remote cursors. The awareness state is ephemeral (no persistence needed) -- the gateway just broadcasts to all other clients in the same channel.

### Key y-protocols Functions

```typescript
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// Encoding a SyncStep1 message:
const encoder = encoding.createEncoder();
syncProtocol.writeSyncStep1(encoder, doc);
const message = encoding.toUint8Array(encoder);

// Applying a sync message:
const decoder = decoding.createDecoder(message);
const messageType = decoding.readVarUint(decoder);
syncProtocol.readSyncMessage(decoder, encoder, doc, 'gateway');

// Encoding awareness update:
const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);

// Applying awareness update:
awarenessProtocol.applyAwarenessUpdate(awareness, update, 'gateway');
```

---

## Hocuspocus: When You Need It vs. When You Don't

### What Hocuspocus Does

Hocuspocus (`@hocuspocus/server` v3.4.4) is a Y.js WebSocket backend that provides:
- WebSocket server with room management
- Document persistence (via extensions for SQLite, Redis, Postgres, S3, etc.)
- Authentication hooks (`onAuthenticate`)
- Document load/store hooks (`onLoadDocument`, `onStoreDocument`)
- Awareness relay
- Horizontal scaling via Redis adapter
- Rate limiting, throttling

### Why We Don't Need It

This project's gateway already provides:
- WebSocket connections with Cognito auth
- Room/channel routing (`crdt:subscribe` / `crdt:unsubscribe`)
- Y.js update relay between clients
- Snapshot persistence to DynamoDB (via `crdt-snapshot` Lambda)

**What's missing:** Awareness message relay (needed for cursors). This is a small addition to the gateway (~20 lines of Lambda code to broadcast `crdt:awareness` messages).

### When to Reconsider

If you later need:
- Server-side document validation/transformation hooks
- Complex multi-document merging
- Redis-based horizontal scaling across multiple gateway instances
- Webhook integrations on document change

Then Hocuspocus becomes worth the complexity. For now, the thin custom provider approach is correct.

---

## Block-Based Editing (Notion-style)

### Options

1. **Tiptap Notion-like Template** -- Official template with slash commands, drag-and-drop blocks, real-time collaboration. Requires a paid Tiptap plan (Start tier or higher). Not open source.

2. **BlockNote** (`@blocknote/react` v0.47.3) -- Open-source block editor built on ProseMirror + Tiptap. Has first-class Y.js support. Provides Notion-like block handles, drag-and-drop, slash menu, and a clean default UI out of the box.

3. **Custom blocks with Tiptap Node Views** -- Build custom block-like nodes using Tiptap's `ReactNodeViewRenderer`. Full control but significant effort.

### Recommendation

For this project, start with standard Tiptap (Pattern 2 above) with task lists, headings, and slash commands. This provides 80% of the Notion-like experience. If block-level drag-and-drop becomes a requirement later, evaluate BlockNote as a drop-in replacement (it uses the same Y.js infrastructure).

---

## PDF Export

### Approach 1: Client-side (html2pdf.js or jsPDF)

```bash
npm install html2pdf.js
```

```typescript
import html2pdf from 'html2pdf.js';

function exportToPDF(editor: Editor) {
  const html = editor.getHTML();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  wrapper.style.padding = '40px';
  wrapper.style.fontFamily = 'serif';

  html2pdf().from(wrapper).set({
    margin: 10,
    filename: 'document.pdf',
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'mm', format: 'a4' },
  }).save();
}
```

**Pros:** No server needed, works offline.
**Cons:** Limited CSS support, no headers/footers, quality varies.

### Approach 2: Server-side (Puppeteer)

```typescript
// Lambda or server endpoint
import puppeteer from 'puppeteer';

async function htmlToPDF(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`
    <html><head>
      <style>body { font-family: serif; padding: 40px; }</style>
    </head><body>${html}</body></html>
  `);
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdf;
}
```

**Pros:** Pixel-perfect, supports full CSS, headers/footers, pagination.
**Cons:** Requires Puppeteer (large dependency), server-side only.

### Approach 3: Tiptap Conversion API (Paid)

Tiptap offers a REST API at `/v2/convert/export/pdf` that accepts Tiptap JSON and returns PDF. Requires a paid subscription.

### Recommendation

Start with **Approach 1** (client-side html2pdf.js) for MVP. Move to Puppeteer on a Lambda if quality becomes a requirement.

---

## Performance and Scalability

### Tiptap Performance

- Tiptap can handle documents the size of a book (official claim from docs).
- **Primary bottleneck in React:** Unnecessary re-renders. Use `useEditorState` with selectors to subscribe to specific editor state, not all transactions.
- **Node views:** React-based node views are expensive with many instances. Prefer HTML-based node views for performance-critical items.
- Set `immediatelyRender: true` (default) for SSR-safe rendering.
- Set `shouldRerenderOnTransaction: false` to avoid re-renders on every keystroke if not needed.

### Y.js Scalability

- **WebSocket (server relay):** Can handle thousands of concurrent connections per document. The bottleneck is usually the WebSocket server, not Y.js.
- **WebRTC (P2P):** Degrades above ~100 concurrent clients per document (mesh networking overhead).
- **Memory:** Y.js keeps full edit history in memory. For very long-lived documents (months of edits), document state can grow. Mitigate with periodic snapshots and state compaction (`Y.encodeStateAsUpdate` discards tombstones).
- **CPU:** Y.js operations are O(1) amortized for insert/delete. Merging a large remote update is proportional to the update size.

### Practical Limits for This Project

Given the existing API Gateway WebSocket with Lambda handlers:
- **Concurrent editors per document:** 50+ easily (limited by API Gateway connection limits and Lambda concurrency, not Y.js)
- **Document size:** Megabytes of rich text before performance degrades
- **Latency:** Y.js updates are tiny (typically <1KB for a keystroke). Over WebSocket with base64 encoding, expect sub-100ms round trips.

---

## Common Pitfalls

### Pitfall 1: Forgetting `history: false` in StarterKit

**What goes wrong:** Two undo stacks compete. Ctrl+Z sometimes undoes nothing, sometimes undoes two steps.
**How to avoid:**
```typescript
StarterKit.configure({ history: false })
```

### Pitfall 2: Full-Document Replace Instead of Incremental Edits

**What goes wrong:** The current `useCRDT.applyLocalEdit` replaces the entire Y.Text content on every keystroke. This means every other user sees their cursor jump to position 0 and the entire document "flicker." Two users typing simultaneously will fight.
**How to avoid:** Let Tiptap's y-prosemirror binding handle this. It maps ProseMirror transactions to surgical Y.js operations.

### Pitfall 3: Setting Initial Content AND Using Collaboration

**What goes wrong:** If you pass `content` to `useEditor` while also using the Collaboration extension, the initial content and the Y.Doc content conflict. You get duplicate text.
**How to avoid:** Never set `content` when using Collaboration. The document state comes exclusively from the Y.Doc (loaded via provider).

### Pitfall 4: Provider Lifecycle Mismatch

**What goes wrong:** Creating a new provider on every React render, or destroying the provider while the editor still references it.
**How to avoid:** Create the provider in a `useMemo` or `useRef`, tied to the channel lifecycle. Destroy only on unmount or channel change.

### Pitfall 5: Missing Awareness Relay in Gateway

**What goes wrong:** Remote cursors never appear because the gateway doesn't forward awareness messages.
**How to avoid:** Add a `crdt:awareness` action to the gateway Lambda that broadcasts awareness updates to all other connections in the channel (same pattern as `crdt:update` but without persistence -- awareness is ephemeral).

### Pitfall 6: Base64 Encoding Overhead

**What goes wrong:** Y.js updates are binary (Uint8Array). The gateway encodes them as base64 in JSON, adding ~33% size overhead.
**Acceptable for now:** Typical keystroke updates are <100 bytes. Even at 133 bytes with base64, this is negligible. Only becomes a concern if sending large paste operations (>100KB).

### Pitfall 7: Missing `Buffer` Polyfill in Browser

**What goes wrong:** `Buffer.from()` is a Node.js API. In Vite, it's not available by default.
**How to avoid:** Use browser-native APIs instead:
```typescript
// Encode Uint8Array to base64
const b64 = btoa(String.fromCharCode(...update));

// Decode base64 to Uint8Array
const bytes = new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));

// Or install the 'buffer' polyfill and configure Vite
```

---

## Gateway Changes Required

To support Tiptap collaboration with cursors, the gateway needs one addition:

### New Message Type: `crdt:awareness`

**Client -> Gateway:**
```json
{
  "service": "crdt",
  "action": "awareness",
  "channel": "general",
  "update": "<base64-encoded awareness update>"
}
```

**Gateway -> Clients (broadcast to same channel, excluding sender):**
```json
{
  "type": "crdt:awareness",
  "channel": "general",
  "update": "<base64-encoded awareness update>"
}
```

**No persistence needed.** Awareness state is ephemeral (cursor positions, online status). When a user disconnects, the 30-second timeout in the awareness protocol automatically removes them.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `contentEditable` + `document.execCommand` | ProseMirror/Tiptap with structured schema | 2020+ | execCommand is deprecated in browsers; Tiptap provides a stable alternative |
| `tiptap-markdown` (community) | `@tiptap/markdown` (official) | Tiptap v3 (2024) | Official package with better maintenance and v3 compatibility |
| `@tiptap/extension-collaboration-cursor` | `@tiptap/extension-collaboration-caret` | Tiptap v3 (2024) | Renamed package; old name still on npm at v2.26.2 but use the new one for v3 |
| Hocuspocus v2 | Hocuspocus v3.4.4 | 2024 | Major rewrite, different API |
| y-websocket standalone server | y-redis or Hocuspocus | 2023+ | y-websocket server is a demo, not production-ready |

---

## Sources

### Primary (HIGH confidence)
- [Tiptap Collaboration Extension Docs](https://tiptap.dev/docs/editor/extensions/functionality/collaboration) -- setup, configuration options
- [Tiptap CollaborationCaret Docs](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret) -- cursor extension setup, CSS
- [Tiptap Performance Guide](https://tiptap.dev/docs/guides/performance) -- React optimization patterns
- [Tiptap Markdown Docs](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage) -- parse/serialize API
- [Tiptap JSON/HTML Export](https://tiptap.dev/docs/guides/output-json-html) -- getJSON, getHTML, setContent
- [Tiptap Slash Commands Example](https://tiptap.dev/docs/examples/experiments/slash-commands) -- experimental, build your own
- [Yjs Sync Protocol Spec](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md) -- message types, encoding format
- [Yjs Awareness Docs](https://docs.yjs.dev/api/about-awareness) -- CRDT for presence data
- [Hocuspocus GitHub](https://github.com/ueberdosis/hocuspocus) -- server architecture, handleConnection API
- [Hocuspocus Scalability Docs](https://tiptap.dev/docs/hocuspocus/guides/scalability) -- Redis, multiple instances
- npm registry -- all version numbers verified 2026-04-11

### Secondary (MEDIUM confidence)
- [Yjs Custom Provider Discussion](https://discuss.yjs.dev/t/how-to-implement-a-custom-yjs-provider/2152) -- community patterns for custom providers
- [Dovetail Engineering: Yjs Fundamentals Part 2](https://medium.com/dovetail-engineering/yjs-fundamentals-part-2-sync-awareness-73b8fabc2233) -- sync protocol walkthrough
- [BlockNote GitHub](https://github.com/TypeCellOS/BlockNote) -- Notion-style alternative built on Tiptap

### Tertiary (LOW confidence)
- Tiptap Notion-like template pricing/availability -- could not verify exact plan requirements
- Concurrent editor limits -- no official benchmarks found; "thousands" is from Hocuspocus marketing
