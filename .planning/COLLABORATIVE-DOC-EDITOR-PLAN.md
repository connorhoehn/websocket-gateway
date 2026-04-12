# Collaborative Structured Document Editor — Implementation Plan

> Real-time collaborative editing of AI-generated documents with structured sections, tasks, and acknowledgment workflows.
> Built on existing WebSocket gateway + CRDT infrastructure.
> Updated: 2026-04-11 — incorporates findings from 8 parallel research agents.

## Research Artifacts (in `.planning/research/`)
- `TIPTAP-YJS-RESEARCH.md` — Tiptap v3 + Y.js integration patterns, custom provider
- `CRDT-SCHEMA-RESEARCH.md` — Y.js document schema design, awareness protocol
- `EXPORT-RESEARCH.md` — Markdown/PDF/DOCX/Google Docs export pipeline
- `SYNC-ARCHITECTURE-RESEARCH.md` — Custom sync protocol, read-only mode, persistence
- `TESTING-RESEARCH.md` — Playwright multi-context, convergence testing, demo page
- `phases/48-structured-document-editor/48-RESEARCH.md` — Full phase research

## Critical Refinements from Research

1. **Server needs `y-protocols` sync handshake** — current `crdt-service.js` does `Buffer.concat` accumulation which is wrong. Should maintain a proper `Y.Doc` per channel and use `y-protocols/sync` for differential sync (SyncStep1/SyncStep2/Update). ~30 lines of server code to add.

2. **Need `crdt:awareness` message type** — Y.js awareness protocol (cursors, user presence in editor) requires a new ephemeral message type. No persistence needed, just relay through Redis pub/sub.

3. **Read-only mode = server-side filtering** — Y.js has no built-in read-only. Reject `update` action from read-only clients at the authorization layer. Allow SyncStep1 (so they can receive state).

4. **`Y.Doc({ gc: false })` for version history** — default garbage collection destroys tombstones needed for snapshots. Must disable GC if we want document versioning.

5. **Dual persistence: binary + JSON** — store `Y.encodeStateAsUpdate()` (gzip) for CRDT reconstruction AND a JSON projection via `toJSON()` for DynamoDB queries (count tasks, filter by status) without deserializing Y.js state.

6. **Hocuspocus NOT needed** — existing gateway already provides WebSocket, auth, room routing, and Y.js relay. Hocuspocus would be redundant.

7. **`@tiptap/markdown` is first-party in v3** — replaces community `tiptap-markdown`. No need for remark/markdown-it as separate deps.

8. **Biggest current bug: `applyLocalEdit` sends full state per keystroke** — Tiptap's y-prosemirror binding fixes this automatically (sends only character-level deltas).

---

## The Experience

1. **AI generates** a markdown summary from a transcript (5-page doc with sections, tasks, decisions)
2. **User clicks "Split"** → markdown is parsed into structured chunks (sections with tasks)
3. **3 viewing modes** running simultaneously across browser tabs:
   - **Editor Mode** — WYSIWYG editing with Tiptap, real-time sync via Y.js CRDT
   - **Ack Mode** — Sequential chunk review, check off items one at a time
   - **Reader Mode** — Live-updating read-only view, sees all changes in real-time
4. **Changes sync instantly** between all browsers via existing WebSocket gateway + Redis pub/sub
5. **Export** to clean markdown, PDF, or Google Docs (DOCX upload)
6. **Persist** as JSON in DynamoDB with 7-day TTL snapshots

---

## Tech Stack

### Frontend (New Packages)
```json
{
  "@tiptap/react": "^3.22.3",
  "@tiptap/starter-kit": "^3.22.3",
  "@tiptap/extension-collaboration": "^3.22.3",
  "@tiptap/extension-collaboration-cursor": "^3.22.3",
  "@tiptap/extension-task-list": "^3.22.3",
  "@tiptap/extension-task-item": "^3.22.3",
  "@tiptap/extension-placeholder": "^3.22.3",
  "@tiptap/markdown": "^3.22.3",
  "@tiptap/html": "^3.22.3",
  "@react-pdf/renderer": "^4.4.1",
  "prosemirror-docx": "^0.6.1"
}
```

### Already Have (Reuse As-Is)
```json
{
  "yjs": "^13.6.29",
  "react": "^19.2.0",
  "react-dom": "^19.2.0"
}
```

### Backend (Reuse 100%)
- `src/services/crdt-service.js` — no changes needed (treats Y.js updates as opaque binary)
- `src/core/message-router.js` — existing pub/sub routing
- `lambdas/crdt-snapshot/handler.ts` — existing DynamoDB persistence
- Redis pub/sub for multi-instance sync

---

## Document Schema (Y.js CRDT Structure)

```typescript
// Y.Doc structure for a collaborative structured document
Y.Doc {
  // Metadata (Y.Map)
  "meta": Y.Map {
    id: string,
    title: string,
    sourceType: "transcript" | "meeting" | "notes" | "custom",
    sourceId: string,           // reference to original transcript
    createdBy: string,          // userId
    createdAt: string,          // ISO timestamp
    aiModel: string,            // which AI generated it
    status: "draft" | "review" | "final"
  },

  // Sections array (Y.Array of Y.Map)
  "sections": Y.Array<Y.Map> [
    {
      id: string,               // ULID
      type: "summary" | "tasks" | "decisions" | "notes" | "custom",
      title: string,
      collapsed: boolean,
      
      // Rich text content (Y.XmlFragment — bound to Tiptap editor)
      content: Y.XmlFragment,   // ProseMirror-compatible rich text
      
      // Structured items for task-type sections (Y.Array of Y.Map)
      items: Y.Array<Y.Map> [
        {
          id: string,
          text: string,
          status: "pending" | "acked" | "done" | "rejected",
          assignee: string,     // userId
          ackedBy: string,      // userId who acknowledged
          ackedAt: string,      // ISO timestamp
          priority: "low" | "medium" | "high",
          notes: string         // reviewer notes
        }
      ]
    }
  ],

  // Awareness state (NOT persisted — ephemeral)
  // Handled by Y.js awareness protocol
  // Shows: who's viewing, their cursor position, their mode
}
```

### Why This Schema

- **Y.XmlFragment for rich text** — maps directly to Tiptap/ProseMirror, supports formatting, lists, code blocks
- **Y.Array for sections** — CRDT-preserved ordering, concurrent insertions merge correctly
- **Y.Map for each section/item** — individual field updates don't conflict (two users can edit different fields simultaneously)
- **Separate `items` array** — tasks are structured data, not just rich text checkboxes. Supports ack workflow, assignees, status tracking
- **Metadata in Y.Map** — title changes sync, status transitions are atomic

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER TABS                             │
├──────────────┬──────────────────┬─────────────���─────────────────┤
│  EDITOR MODE │    ACK MODE      │         READER MODE           │
│              │                  ���                               │
│  Tiptap      │  Chunk Navigator │  Rendered Markdown            │
│  WYSIWYG     │  ← Prev / Next →│  (read-only, live-updating)   │
│  + toolbar   │  [Ack] [Reject]  │                               │
│  + cursors   │  [Add Note]      │  Shows who's editing where    │
│              │  Review progress  │  Shows ack progress           │
├──────────────┴──────────────────┴───────────────────────────────┤
│                     GatewayProvider (Custom Y.js Provider)       │
│  Y.Doc ←→ WebSocket messages ←→ Gateway ←→ Redis ←→ Other tabs │
├─��────────────────────────────────────��──────────────────────────┤
│                     useCollaborativeDoc Hook                     │
│  Y.Doc instance, awareness, mode state, section/item mutators   │
└──────────────────────────┬───────────────���──────────────────────┘
                           │ WebSocket (existing gateway)
                           ▼
┌──────���──────────────────────────────��───────────────────��───────┐
│                    WEBSOCKET GATEWAY (existing)                  │
│  crdt-service.js — batch, merge, broadcast via Redis pub/sub    │
│  No changes needed — treats Y.js updates as opaque binary       │
└──────────────────────────┬───────���──────────────────────────────┘
                           │ EventBridge → Lambda
                           ▼
┌──────────────���─────────────────────────────────────────────────��┐
│                    PERSISTENCE (existing)                        │
│  crdt-snapshot Lambda → DynamoDB (gzip, 7-day TTL)              │
│  Triggered every 50 ops or 5 minutes                            │
└────────────��───────────────────────────────��────────────────────┘
```

---

## Component Tree

```
<DocumentEditorPage>
  ├── <DocumentHeader>
  │   ├── Title (editable, synced via Y.Map)
  │   ├── Status badge (draft/review/final)
  ��   ├── Mode selector: [Editor] [Review] [Read]
  │   ├── Participants avatars (from Y.js awareness)
  │   └── Export menu: [Markdown] [PDF] [Google Docs]
  │
  ├── <EditorMode>                    // mode === 'editor'
  │   ├── <SectionList>
  │   │   └── <SectionBlock> (for each section)
  │   │       ├── <SectionHeader> (title, type badge, collapse toggle)
  │   │       ├── <TiptapEditor>    // Y.XmlFragment bound to Tiptap
  │   │       │   ├── Toolbar (bold, italic, lists, headings, code)
  ��   │       │   ├── CollaborationCursor (shows other editors)
  │   │       │   └── Rich text surface
  │   │       └── <TaskList>         // for task-type sections
  │   │           └── <TaskItem>
  │   │               ├── Checkbox (status)
  │   │               ├── Text input (title)
  │   │               ├── Assignee selector
  │   │               └── Priority badge
  │   └── <AddSectionButton>
  │
  ├── <AckMode>                       // mode === 'ack'
  │   ├── <ReviewProgress> (3/12 chunks reviewed)
  │   ├── <ChunkViewer>
  │   │   ├── Section title + type
  │   │   ├── Content (read-only rendered)
  │   │   ├── Items (if task section)
  │   │   │   └── <ReviewableItem>
  │   │   │       ├── Content preview
  │   │   │       ├── [Acknowledge] button
  │   │   │       ├── [Reject] button
  │   │   │       └── Notes textarea
  │   │   └── Navigation: [← Previous] [Next →]
  │   └── <AckSummary> (who acked what, when)
  │
  └── <ReaderMode>                    // mode === 'reader'
      ├── <LiveIndicator> (green dot, "Live")
      ├── <RenderedDocument>
      │   └── Clean markdown rendering (no editor chrome)
      │       ├── Sections with headers
      │       ├── Task items with status badges
      │       └── Ack status indicators
      └── <ActivitySidebar>
          ├── Who's editing (from awareness)
          ├── Recent changes (section highlights)
          └── Ack progress summary
```

---

## Key Hooks

### `useCollaborativeDoc(documentId: string)`
The main hook — manages Y.Doc lifecycle, WebSocket sync, and provides typed API.

```typescript
interface UseCollaborativeDocReturn {
  // Connection state
  connected: boolean;
  synced: boolean;              // initial snapshot loaded
  
  // Document data (reactive)
  meta: DocumentMeta;
  sections: Section[];
  
  // Awareness (who's online, their mode, cursor)
  participants: Participant[];
  
  // Mutations
  updateMeta: (patch: Partial<DocumentMeta>) => void;
  addSection: (section: NewSection) => void;
  updateSection: (sectionId: string, patch: Partial<Section>) => void;
  removeSection: (sectionId: string) => void;
  reorderSections: (fromIndex: number, toIndex: number) => void;
  
  // Task mutations
  addItem: (sectionId: string, item: NewItem) => void;
  updateItem: (sectionId: string, itemId: string, patch: Partial<Item>) => void;
  removeItem: (sectionId: string, itemId: string) => void;
  ackItem: (sectionId: string, itemId: string, notes?: string) => void;
  rejectItem: (sectionId: string, itemId: string, reason: string) => void;
  
  // Section content (for Tiptap binding)
  getSectionFragment: (sectionId: string) => Y.XmlFragment;
  
  // Import/Export
  loadFromMarkdown: (markdown: string) => void;
  exportMarkdown: () => string;
  exportJSON: () => DocumentJSON;
  
  // Y.Doc (for Tiptap Collaboration extension)
  ydoc: Y.Doc;
  provider: GatewayProvider;
}
```

### `GatewayProvider` (Custom Y.js Provider)

```typescript
// Sends only deltas (not full state) over existing WebSocket gateway
class GatewayProvider extends Observable<string> {
  constructor(ydoc: Y.Doc, channel: string, sendMessage: SendFn) {
    // Listen for local changes → send delta via WebSocket
    ydoc.on('update', (update, origin) => {
      if (origin === this) return;  // skip remote applies
      sendMessage({
        service: 'crdt', action: 'update',
        channel, update: toBase64(update)
      });
    });
  }
  
  // Called when receiving remote update from gateway
  applyRemoteUpdate(b64: string) {
    Y.applyUpdate(this.doc, fromBase64(b64), this);
  }
  
  // Called on connect — loads snapshot
  applySnapshot(b64: string) {
    Y.applyUpdate(this.doc, fromBase64(b64), this);
  }
}
```

---

## The "Split" Operation

When user clicks "Split" on an AI-generated markdown document:

```typescript
async function splitMarkdownToStructuredDoc(
  markdown: string,
  aiModel: string,
  sourceId: string
): Promise<void> {
  // 1. Parse markdown into AST using remark
  const ast = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  
  // 2. Walk AST and extract sections by headings
  const sections: NewSection[] = [];
  let currentSection: NewSection | null = null;
  
  for (const node of ast.children) {
    if (node.type === 'heading') {
      // Start new section
      if (currentSection) sections.push(currentSection);
      currentSection = {
        id: ulid(),
        type: inferSectionType(node),  // 'tasks' if contains checkboxes
        title: extractText(node),
        content: '',
        items: [],
      };
    } else if (node.type === 'list' && hasCheckboxes(node)) {
      // Extract task items
      for (const listItem of node.children) {
        currentSection?.items.push({
          id: ulid(),
          text: extractText(listItem),
          status: listItem.checked ? 'done' : 'pending',
          assignee: '',
          priority: 'medium',
        });
      }
    } else {
      // Accumulate content markdown
      currentSection.content += serializeNode(node);
    }
  }
  
  // 3. Load into Y.Doc
  ydoc.transact(() => {
    const meta = ydoc.getMap('meta');
    meta.set('sourceType', 'transcript');
    meta.set('sourceId', sourceId);
    meta.set('aiModel', aiModel);
    meta.set('status', 'draft');
    
    const sectionsArray = ydoc.getArray('sections');
    for (const section of sections) {
      const sectionMap = new Y.Map();
      sectionMap.set('id', section.id);
      sectionMap.set('type', section.type);
      sectionMap.set('title', section.title);
      // ... populate items as Y.Array of Y.Map
      
      // Rich text content as XmlFragment
      // Use Tiptap's markdown parser to convert to ProseMirror nodes
      // Then use prosemirrorToYXmlFragment() to populate
      
      sectionsArray.push([sectionMap]);
    }
  });
  // Y.Doc update automatically broadcasts to all connected clients
}
```

---

## Export Pipeline

### Markdown Export
```typescript
function exportToMarkdown(ydoc: Y.Doc): string {
  const meta = ydoc.getMap('meta');
  const sections = ydoc.getArray('sections');
  let md = `# ${meta.get('title')}\n\n`;
  
  sections.forEach((section: Y.Map) => {
    md += `## ${section.get('title')}\n\n`;
    
    // Rich text content → markdown via Tiptap
    const fragment = section.get('content') as Y.XmlFragment;
    // Use yXmlFragmentToProsemirrorJSON + prosemirror-markdown serializer
    md += fragmentToMarkdown(fragment) + '\n\n';
    
    // Task items → GFM checkboxes
    const items = section.get('items') as Y.Array;
    items.forEach((item: Y.Map) => {
      const check = item.get('status') === 'done' ? 'x' : ' ';
      md += `- [${check}] ${item.get('text')}\n`;
    });
    md += '\n';
  });
  
  return md;
}
```

### PDF Export
```typescript
// Using @react-pdf/renderer
import { Document, Page, Text, View } from '@react-pdf/renderer';

function DocumentPDF({ doc }: { doc: DocumentJSON }) {
  return (
    <Document>
      <Page>
        <Text style={styles.title}>{doc.meta.title}</Text>
        {doc.sections.map(section => (
          <View key={section.id}>
            <Text style={styles.heading}>{section.title}</Text>
            <RichTextRenderer content={section.content} />
            {section.items.map(item => (
              <TaskItemRenderer key={item.id} item={item} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
```

### Google Docs Export
```typescript
// Generate DOCX via prosemirror-docx, upload to Google Drive
import { defaultDocxSerializer } from 'prosemirror-docx';

async function exportToGoogleDocs(doc: DocumentJSON, accessToken: string) {
  // 1. Convert to DOCX buffer
  const docxBuffer = defaultDocxSerializer.serialize(prosemirrorDoc);
  
  // 2. Upload to Google Drive with auto-conversion
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: createMultipartBody(docxBuffer, {
        name: doc.meta.title,
        mimeType: 'application/vnd.google-apps.document', // auto-convert
      }),
    }
  );
  return response.json(); // { id, webViewLink }
}
```

---

## Testing Loop

### 1. Unit Tests (Vitest)
```
- Y.js document schema: create, mutate, observe sections/items
- GatewayProvider: send/receive updates, snapshot loading
- Markdown ↔ structured doc round-trip fidelity
- Export: markdown output, PDF rendering, DOCX generation
- Ack workflow: status transitions, concurrent acks
```

### 2. Component Tests (Vitest + Testing Library)
```
- TiptapEditor renders and accepts input
- AckMode navigates chunks, updates status
- ReaderMode renders live content
- SectionList drag-and-drop reorder
- TaskItem checkbox toggles sync
```

### 3. Integration Tests (Playwright — 3 Browser Contexts)
```typescript
// The 3-tab test harness
test('collaborative editing across 3 modes', async ({ browser }) => {
  // Launch 3 browser contexts (simulates 3 users)
  const editor = await browser.newContext();
  const reviewer = await browser.newContext();
  const reader = await browser.newContext();
  
  const editorPage = await editor.newPage();
  const reviewerPage = await reviewer.newPage();
  const readerPage = await reader.newPage();
  
  // All navigate to same document
  const docUrl = '/doc/test-doc-123';
  await editorPage.goto(docUrl + '?mode=editor');
  await reviewerPage.goto(docUrl + '?mode=ack');
  await readerPage.goto(docUrl + '?mode=reader');
  
  // Editor types in section
  await editorPage.click('[data-section="0"] .tiptap-editor');
  await editorPage.type('Hello from editor');
  
  // Verify reader sees it within 500ms
  await expect(readerPage.locator('[data-section="0"]'))
    .toContainText('Hello from editor', { timeout: 2000 });
  
  // Reviewer acknowledges a task
  await reviewerPage.click('[data-item="0"] [data-action="ack"]');
  
  // Verify editor and reader see ack status update
  await expect(editorPage.locator('[data-item="0"]'))
    .toHaveAttribute('data-status', 'acked', { timeout: 2000 });
  await expect(readerPage.locator('[data-item="0"]'))
    .toHaveAttribute('data-status', 'acked', { timeout: 2000 });
  
  // Editor adds a new task
  await editorPage.click('[data-action="add-task"]');
  await editorPage.type('New task from editor');
  
  // Verify all 3 see the new task
  await expect(reviewerPage.locator('[data-item="1"]'))
    .toContainText('New task from editor', { timeout: 2000 });
  await expect(readerPage.locator('[data-item="1"]'))
    .toContainText('New task from editor', { timeout: 2000 });
});
```

### 4. Manual Testing Script (3-Tab Developer Flow)
```
1. Open http://localhost:5173/doc/demo?mode=editor   (Tab 1)
2. Open http://localhost:5173/doc/demo?mode=ack      (Tab 2)
3. Open http://localhost:5173/doc/demo?mode=reader   (Tab 3)

Test scenarios:
□ Type in editor → appears in reader within 1s
□ Check task in ack mode → status updates in editor + reader
□ Add section in editor → new chunk appears in ack navigator
□ Export markdown → includes all edits + ack statuses
□ Refresh reader tab → reconnects and loads latest state
□ Disconnect editor → ack mode still works independently
□ Both editor tabs type simultaneously → both changes merge
```

### 5. CI Pipeline
```yaml
# .github/workflows/collab-editor.yml
jobs:
  test:
    steps:
      - npm test                     # Unit + component tests
      - npx playwright test          # 3-browser integration tests
      - npm run build                # Verify production build
      - npm run test:export          # Markdown/PDF round-trip
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (2-3 days)
- [ ] Install Tiptap + collaboration packages
- [ ] Build `GatewayProvider` (custom Y.js provider over existing WebSocket)
- [ ] Build `useCollaborativeDoc` hook with Y.Doc schema
- [ ] Markdown → structured doc parser ("Split" operation)
- [ ] Basic Playwright 3-tab test harness

### Phase 2: Editor Mode (2-3 days)
- [ ] `<TiptapEditor>` component with collaboration cursors
- [ ] `<SectionList>` with add/remove/reorder sections
- [ ] `<TaskItem>` with checkbox, title, assignee, priority
- [ ] Section collapse/expand
- [ ] Toolbar: formatting, headings, lists, code blocks

### Phase 3: Ack Mode (1-2 days)
- [ ] `<ChunkViewer>` with prev/next navigation
- [ ] `<ReviewableItem>` with ack/reject/notes
- [ ] Review progress bar
- [ ] Ack summary panel

### Phase 4: Reader Mode (1 day)
- [ ] Read-only rendered view (no editor chrome)
- [ ] Live update indicators (highlights on change)
- [ ] Activity sidebar (who's editing, recent changes)
- [ ] Participant avatars from Y.js awareness

### Phase 5: Export Pipeline (1-2 days)
- [ ] Markdown export (clean, no CRDT artifacts)
- [ ] PDF export via @react-pdf/renderer
- [ ] DOCX export via prosemirror-docx
- [ ] Google Drive upload (OAuth2 + Drive API)

### Phase 6: Polish + Testing (2-3 days)
- [ ] Full Playwright 3-browser test suite
- [ ] Convergence tests (concurrent edits merge correctly)
- [ ] Reconnection tests (snapshot recovery)
- [ ] Export round-trip tests (markdown → edit → export → compare)
- [ ] Performance testing (10+ concurrent editors)
- [ ] Demo page with pre-loaded AI document

---

## Files to Create

```
frontend/src/
  hooks/
    useCollaborativeDoc.ts        # Main hook — Y.Doc + typed API
    useDocumentExport.ts          # Export to markdown/PDF/DOCX
  providers/
    GatewayProvider.ts            # Custom Y.js provider over WebSocket
  components/
    doc-editor/
      DocumentEditorPage.tsx      # Top-level page with mode switching
      DocumentHeader.tsx          # Title, status, participants, export
      EditorMode.tsx              # WYSIWYG editing view
      AckMode.tsx                 # Sequential review view
      ReaderMode.tsx              # Live read-only view
      SectionList.tsx             # Ordered sections container
      SectionBlock.tsx            # Individual section with Tiptap
      TiptapEditor.tsx            # Tiptap instance with collaboration
      TaskList.tsx                # Structured task items
      TaskItem.tsx                # Single task with ack controls
      ChunkViewer.tsx             # Ack mode chunk navigator
      ReviewableItem.tsx          # Item with ack/reject buttons
      ExportMenu.tsx              # Export format selector
      ParticipantAvatars.tsx      # Who's online (awareness)
      DocumentPDF.tsx             # @react-pdf/renderer template

frontend/src/__tests__/
  useCollaborativeDoc.test.ts     # Hook unit tests
  GatewayProvider.test.ts         # Provider sync tests
  markdown-roundtrip.test.ts      # Markdown ↔ doc fidelity

e2e/
  collaborative-editing.spec.ts   # Playwright 3-browser tests
```

### Backend (No New Files Needed)
The existing `crdt-service.js` handles everything. The Y.js document structure is transparent to the backend — it just relays binary updates.
