# CRDT Document Schema Research - Y.js Structured Collaborative Documents

**Researched:** 2026-04-11
**Domain:** Y.js CRDT schema design for structured collaborative documents
**Confidence:** HIGH (Y.js official docs + community patterns verified)

## Summary

This research covers how to design a JSON schema for AI-generated collaborative documents (summaries, tasks, decisions) backed by Y.js CRDTs. The document model needs to support structured sections with rich text content, task items with acknowledgment state, multi-mode participation (editor/reviewer/reader), and persistence to DynamoDB.

The key insight is that Y.js shared types (Y.Map, Y.Array, Y.Text) must be used at every level where concurrent edits are expected. Plain JSON objects stored inside Y.Map are opaque blobs -- updating a nested field requires replacing the entire object. The recommended pattern is **Y.Array of Y.Map** for ordered collections of structured items, with Y.Text for any text content that needs character-level collaborative editing.

**Primary recommendation:** Use a single Y.Doc per document with top-level Y.Map for metadata, Y.Array<Y.Map> for sections, and nested Y.Array<Y.Map> for task items within sections. Use Y.Text (not Y.XmlFragment) for section content -- the AI-generated content is primarily plain text with optional formatting, not a full rich-text editor scenario. Use the Y.js Awareness protocol for participant presence/mode tracking.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yjs | 13.6.30 | CRDT shared data types | Already in project (^13.6.29), de facto standard |
| y-protocols | 1.0.7 | Awareness protocol, sync protocol | Official companion to yjs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lib0 | (bundled with yjs) | Binary encoding/decoding utilities | Used internally by yjs, available for custom encoding |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Y.Text for content | Y.XmlFragment | XmlFragment needed only if using a ProseMirror/BlockNote rich-text editor binding. Y.Text with formatting attributes is simpler for AI-generated summaries. |
| Custom awareness | Liveblocks/PartyKit | External service adds latency and cost. Y.js awareness over existing WebSocket gateway is zero-cost and already in the architecture. |
| BlockNote editor | Plain textarea + Y.Text | BlockNote adds Notion-like block editing but is heavy (~200KB). For AI-generated read-mostly documents, a simpler approach is better. Upgrade path exists if needed. |

## Architecture Patterns

### Y.Doc Schema Design

The document schema maps to Y.js shared types as follows:

```
Y.Doc
  |-- "meta" : Y.Map
  |     |-- "id" : string
  |     |-- "title" : string
  |     |-- "sourceType" : string (transcript|meeting|chat|custom)
  |     |-- "createdBy" : string (Cognito sub)
  |     |-- "createdAt" : string (ISO 8601)
  |     |-- "aiModel" : string
  |     |-- "sourceTranscriptId" : string
  |     |-- "version" : number (incrementing)
  |
  |-- "sections" : Y.Array<Y.Map>
  |     |-- [0] Y.Map (section)
  |     |     |-- "id" : string (ULID)
  |     |     |-- "type" : string (summary|tasks|decisions|notes|custom)
  |     |     |-- "title" : string
  |     |     |-- "content" : Y.Text (rich text with formatting attributes)
  |     |     |-- "items" : Y.Array<Y.Map> (for task/checklist sections)
  |     |     |     |-- [0] Y.Map (item)
  |     |     |     |     |-- "id" : string (ULID)
  |     |     |     |     |-- "text" : string
  |     |     |     |     |-- "status" : string (pending|ack|done)
  |     |     |     |     |-- "assignee" : string (Cognito sub or null)
  |     |     |     |     |-- "ackBy" : string (Cognito sub or null)
  |     |     |     |     |-- "ackAt" : string (ISO 8601 or null)
  |     |     |     |-- [1] Y.Map (item) ...
  |     |     |-- "collapsed" : boolean
  |     |     |-- "order" : number (for reordering)
  |     |-- [1] Y.Map (section) ...
  |
  |-- "participants" : Y.Map<Y.Map>  (keyed by Cognito sub)
        |-- "user-abc-123" : Y.Map
        |     |-- "userId" : string
        |     |-- "displayName" : string
        |     |-- "role" : string (owner|editor|reviewer|reader)
        |     |-- "joinedAt" : string (ISO 8601)
```

### Why This Structure

1. **Y.Map for metadata** -- Concurrent updates to different metadata fields (e.g., one user changes title while another changes sourceType) merge cleanly.

2. **Y.Array<Y.Map> for sections** -- Y.Array provides stable ordering. Y.Map items allow individual field updates without replacing the whole section. Concurrent section reorders resolve automatically via CRDT.

3. **Y.Text for section content** -- Character-level collaborative editing. AI can insert text, humans can edit individual words. Formatting attributes (bold, italic, headers) are supported natively via Y.Text attributes.

4. **Y.Array<Y.Map> for task items** -- Same pattern as sections. Each task item is independently editable. Two users can acknowledge different tasks simultaneously without conflict.

5. **Y.Map<Y.Map> for participants** -- Keyed by userId prevents duplicate entries. Role changes are atomic per-user.

### Pattern 1: Initializing the Document from AI Output

```typescript
import * as Y from 'yjs';

interface AISection {
  type: 'summary' | 'tasks' | 'decisions' | 'notes' | 'custom';
  title: string;
  content: string;
  items?: Array<{ text: string; assignee?: string }>;
}

function initializeDocumentFromAI(
  ydoc: Y.Doc,
  title: string,
  sourceType: string,
  sections: AISection[],
  createdBy: string,
  aiModel: string,
  sourceTranscriptId: string
): void {
  ydoc.transact(() => {
    // Set metadata
    const meta = ydoc.getMap('meta');
    meta.set('id', generateULID());
    meta.set('title', title);
    meta.set('sourceType', sourceType);
    meta.set('createdBy', createdBy);
    meta.set('createdAt', new Date().toISOString());
    meta.set('aiModel', aiModel);
    meta.set('sourceTranscriptId', sourceTranscriptId);
    meta.set('version', 1);

    // Build sections
    const ySections = ydoc.getArray('sections');
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const ySection = new Y.Map();
      ySection.set('id', generateULID());
      ySection.set('type', section.type);
      ySection.set('title', section.title);
      ySection.set('collapsed', false);
      ySection.set('order', i);

      // Rich text content
      const yContent = new Y.Text();
      yContent.insert(0, section.content);
      ySection.set('content', yContent);

      // Task items (if applicable)
      if (section.items && section.items.length > 0) {
        const yItems = new Y.Array();
        for (const item of section.items) {
          const yItem = new Y.Map();
          yItem.set('id', generateULID());
          yItem.set('text', item.text);
          yItem.set('status', 'pending');
          yItem.set('assignee', item.assignee || null);
          yItem.set('ackBy', null);
          yItem.set('ackAt', null);
          yItems.push([yItem]);
        }
        ySection.set('items', yItems);
      }

      ySections.push([ySection]);
    }

    // Initialize participants map
    const participants = ydoc.getMap('participants');
    const creator = new Y.Map();
    creator.set('userId', createdBy);
    creator.set('displayName', ''); // filled by awareness
    creator.set('role', 'owner');
    creator.set('joinedAt', new Date().toISOString());
    participants.set(createdBy, creator);
  });
}
```

### Pattern 2: Acknowledging a Task Item

```typescript
function acknowledgeTask(
  ydoc: Y.Doc,
  sectionId: string,
  taskId: string,
  userId: string
): boolean {
  const sections = ydoc.getArray('sections');
  let found = false;

  ydoc.transact(() => {
    for (let i = 0; i < sections.length; i++) {
      const section = sections.get(i) as Y.Map<any>;
      if (section.get('id') !== sectionId) continue;

      const items = section.get('items') as Y.Array<Y.Map<any>> | undefined;
      if (!items) continue;

      for (let j = 0; j < items.length; j++) {
        const item = items.get(j) as Y.Map<any>;
        if (item.get('id') !== taskId) continue;

        item.set('status', 'ack');
        item.set('ackBy', userId);
        item.set('ackAt', new Date().toISOString());
        found = true;
        break;
      }
      break;
    }
  });

  return found;
}
```

### Pattern 3: Awareness for Participant Modes

```typescript
import { Awareness } from 'y-protocols/awareness';

interface DocumentAwarenessState {
  user: {
    userId: string;
    displayName: string;
    color: string;
  };
  mode: 'viewing' | 'editing' | 'reviewing';
  currentSection: string | null; // section ID being focused
  cursor?: { index: number; length: number }; // for Y.Text cursor
}

// Set local user's awareness state
function setUserMode(
  awareness: Awareness,
  userId: string,
  displayName: string,
  mode: 'viewing' | 'editing' | 'reviewing',
  sectionId: string | null
): void {
  awareness.setLocalStateField('user', {
    userId,
    displayName,
    color: identityToColor(userId),
  });
  awareness.setLocalStateField('mode', mode);
  awareness.setLocalStateField('currentSection', sectionId);
}

// Get all participants and what they're doing
function getActiveParticipants(awareness: Awareness): DocumentAwarenessState[] {
  const states: DocumentAwarenessState[] = [];
  awareness.getStates().forEach((state) => {
    if (state.user) {
      states.push(state as DocumentAwarenessState);
    }
  });
  return states;
}

// Listen for changes
awareness.on('change', () => {
  const participants = getActiveParticipants(awareness);
  // Update UI: show who's viewing/editing/reviewing each section
  // Show avatars next to section headers
  // Highlight sections being edited by others
});
```

### Pattern 4: Converting Y.Doc to JSON for DynamoDB Persistence

```typescript
// Extract document as plain JSON for DynamoDB storage
function ydocToJSON(ydoc: Y.Doc): Record<string, any> {
  const meta = ydoc.getMap('meta').toJSON();
  const sections = ydoc.getArray('sections').toJSON();
  const participants = ydoc.getMap('participants').toJSON();

  return { meta, sections, participants };
}

// DynamoDB storage strategy: store BOTH binary update + JSON snapshot
interface DynamoDBDocumentRecord {
  documentId: string;        // PK
  timestamp: number;         // SK (epoch ms)
  binaryUpdate: Buffer;      // Binary: Y.encodeStateAsUpdate(ydoc) - gzip compressed
  jsonSnapshot: string;      // JSON: ydocToJSON(ydoc) - for queries without loading Y.Doc
  stateVector: Buffer;       // Binary: Y.encodeStateVector(ydoc) - for diff sync
  ttl?: number;              // Optional TTL for old versions
}
```

### Pattern 5: Merging AI-Generated Content Into Existing Document

```typescript
// When AI regenerates a section, create update on server-side Y.Doc
function mergeAIContentIntoSection(
  ydoc: Y.Doc,
  sectionId: string,
  newContent: string,
  newItems?: Array<{ text: string; assignee?: string }>
): void {
  const sections = ydoc.getArray('sections');

  ydoc.transact(() => {
    for (let i = 0; i < sections.length; i++) {
      const section = sections.get(i) as Y.Map<any>;
      if (section.get('id') !== sectionId) continue;

      // Replace content using Y.Text operations (not delete+set)
      const yContent = section.get('content') as Y.Text;
      yContent.delete(0, yContent.length);
      yContent.insert(0, newContent);

      // If items provided, merge without destroying existing ack state
      if (newItems) {
        const yItems = section.get('items') as Y.Array<Y.Map<any>>;
        if (yItems) {
          // Append new items, don't remove existing acknowledged ones
          for (const item of newItems) {
            const yItem = new Y.Map();
            yItem.set('id', generateULID());
            yItem.set('text', item.text);
            yItem.set('status', 'pending');
            yItem.set('assignee', item.assignee || null);
            yItem.set('ackBy', null);
            yItem.set('ackAt', null);
            yItems.push([yItem]);
          }
        }
      }

      // Bump version
      const meta = ydoc.getMap('meta');
      meta.set('version', (meta.get('version') as number || 0) + 1);
      break;
    }
  }, 'ai-regeneration'); // origin tag for UndoManager filtering
}
```

### Pattern 6: Document Versioning with Snapshots

```typescript
import * as Y from 'yjs';

// CRITICAL: Documents that need versioning must disable GC
const ydoc = new Y.Doc({ gc: false });

// Take a named snapshot
function takeSnapshot(ydoc: Y.Doc): Uint8Array {
  const snapshot = Y.snapshot(ydoc);
  return Y.encodeSnapshotV2(snapshot);
}

// Restore to a previous version (read-only view)
function viewVersion(
  originDoc: Y.Doc,
  snapshotBytes: Uint8Array
): Y.Doc {
  const snapshot = Y.decodeSnapshotV2(snapshotBytes);
  const historicalDoc = Y.createDocFromSnapshot(originDoc, snapshot);
  return historicalDoc; // Read-only view of historical state
}

// Store snapshots in DynamoDB alongside binary updates
interface VersionRecord {
  documentId: string;     // PK
  versionId: string;      // SK (ULID for ordering)
  snapshot: Buffer;       // Y.encodeSnapshotV2 output
  label: string;          // "AI generated v1", "After review", etc.
  createdBy: string;      // Cognito sub
  createdAt: string;      // ISO 8601
}
```

### Pattern 7: Splitting Flat Markdown into Sections

```typescript
// Parse AI markdown output into structured sections
interface ParsedSection {
  type: 'summary' | 'tasks' | 'decisions' | 'notes' | 'custom';
  title: string;
  content: string;
  items: Array<{ text: string; assignee?: string }>;
}

function parseMarkdownToSections(markdown: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const lines = markdown.split('\n');
  let current: ParsedSection | null = null;

  for (const line of lines) {
    // Detect section headers (## Summary, ## Action Items, etc.)
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      if (current) sections.push(current);
      const title = headerMatch[1].trim();
      current = {
        type: inferSectionType(title),
        title,
        content: '',
        items: [],
      };
      continue;
    }

    if (!current) {
      // Content before first header goes into a "summary" section
      current = { type: 'summary', title: 'Summary', content: '', items: [] };
    }

    // Detect task items: "- [ ] Do something @assignee"
    const taskMatch = line.match(/^[-*]\s+\[[ x]\]\s+(.+?)(?:\s+@(\w+))?$/);
    if (taskMatch && (current.type === 'tasks' || current.type === 'decisions')) {
      current.items.push({
        text: taskMatch[1].trim(),
        assignee: taskMatch[2] || undefined,
      });
      continue;
    }

    // Regular content
    current.content += line + '\n';
  }

  if (current) sections.push(current);
  return sections;
}

function inferSectionType(title: string): ParsedSection['type'] {
  const lower = title.toLowerCase();
  if (lower.includes('summary') || lower.includes('overview')) return 'summary';
  if (lower.includes('task') || lower.includes('action')) return 'tasks';
  if (lower.includes('decision')) return 'decisions';
  if (lower.includes('note')) return 'notes';
  return 'custom';
}
```

### Anti-Patterns to Avoid

- **Storing plain JSON objects in Y.Map for mutable data:** If you `ymap.set('section', { title: 'foo', content: 'bar' })`, you cannot update `title` independently. The entire object must be replaced, generating a full-object update (777 bytes) instead of a field-level update (27 bytes). Always use nested Y.Map for structured data that will be edited.

- **Sharing a single Y.Text for the entire document:** This forces all sections into one text blob, losing section-level granularity for awareness, ack state, and permissions. Each section should have its own Y.Text.

- **Using Y.Array indices as stable IDs:** Y.Array indices shift when items are inserted/deleted. Always give each item a stable ULID `id` field and look up by ID, not index.

- **Enabling GC on documents that need versioning:** `Y.Doc({ gc: true })` (the default) deletes tombstones, making `Y.createDocFromSnapshot` impossible. Use `gc: false` for documents requiring version history.

- **Modifying retrieved JSON objects directly:** `ymap.toJSON()` returns a reference to internal data. Mutating it corrupts the Y.Doc without generating sync updates. Always use `ymap.set()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conflict resolution | Custom OT or merge logic | Y.js CRDT (automatic) | Y.js guarantees convergence across all peers without custom merge |
| Presence/awareness | Custom Redis-based tracking | y-protocols Awareness | Handles timeout (30s), propagation, and state cleanup automatically |
| Document diff/sync | Custom binary diff protocol | Y.encodeStateAsUpdate + Y.encodeStateVector | Yjs computes minimal diffs from state vectors without loading full history |
| Undo/redo | Custom operation stack | Y.UndoManager | Tracks scoped operations, merges rapid edits (500ms), supports origin filtering |
| Binary encoding | Custom serialization | Y.encodeStateAsUpdate (V2 for 40% better compression) | Battle-tested encoding that handles all Y.js internal structures |
| Section reordering | Manual index management | Y.Array insert/delete | CRDT handles concurrent reorders without index corruption |

## Common Pitfalls

### Pitfall 1: Shared Type Location Constraint
**What goes wrong:** Attempting to insert the same Y.Map instance into two different locations in the document throws an error.
**Why it happens:** A Y.js shared type can only exist at one position in the document tree. Once "integrated" (inserted), it cannot be moved.
**How to avoid:** Always create new Y.Map/Y.Array/Y.Text instances for each insertion point. To "move" a section, delete from old position and create a new Y.Map at the new position, copying properties over.
**Warning signs:** Runtime error "This type is already integrated."

### Pitfall 2: Browser Crashes with Large History
**What goes wrong:** Documents with thousands of operations and `gc: false` can crash the browser.
**Why it happens:** Y.js accumulates all operation history when GC is disabled, growing memory unboundedly.
**How to avoid:** Use `gc: false` only for documents that genuinely need versioning. For long-lived documents, periodically "compact" by creating a fresh Y.Doc from the current state and discarding old history. Consider per-document memory budgets.
**Warning signs:** Reported crashes at ~10,000 items with accumulated history.

### Pitfall 3: Observer Scope
**What goes wrong:** Observing a parent Y.Map doesn't fire when a nested Y.Map child is modified.
**Why it happens:** Y.Map.observe() only fires for direct property changes, not nested changes.
**How to avoid:** Use `observeDeep()` on the parent to catch all descendant changes, or register separate observers on each nested type.
**Warning signs:** UI doesn't update when nested data changes.

### Pitfall 4: Async Deletion Race Condition
**What goes wrong:** Client A adds a field to a nested Y.Map while Client B deletes that Y.Map. The addition has no effect.
**Why it happens:** Y.js resolves delete-vs-update conflicts by letting the delete win at the container level.
**How to avoid:** Use soft deletes (status: 'deleted') instead of physically removing Y.Map items. Or accept that deletions are authoritative and re-creation is the recovery path.
**Warning signs:** Data silently disappears after concurrent edits.

### Pitfall 5: Encoding Format Mismatch
**What goes wrong:** Storing `Y.encodeStateAsUpdate()` result as JSON (converted to `{"0":1,"1":1,...}`) fails on read-back.
**Why it happens:** Uint8Array serialized to JSON loses its typed array nature. Parsing it back produces a plain object, not a Uint8Array.
**How to avoid:** Always use base64 encoding for transport/storage: `Buffer.from(update).toString('base64')`. For DynamoDB, use Binary (B) attribute type directly, or base64 string.
**Warning signs:** "Cannot read property of undefined" when applying stored updates.

### Pitfall 6: Full-Document Replace Instead of Incremental Edit
**What goes wrong:** The current `useCRDT.ts` does `ytext.delete(0, length); ytext.insert(0, newText)` which replaces the entire document on every keystroke, losing Y.js's character-level merge benefits.
**Why it happens:** Treating Y.Text like a React state setter instead of a collaborative text buffer.
**How to avoid:** For structured documents with per-section Y.Text, compute minimal diffs or use editor bindings (TipTap/ProseMirror + y-prosemirror) that generate proper insert/delete operations.
**Warning signs:** Every edit generates an update proportional to the entire document size, not the change size.

## DynamoDB Persistence Strategy

### Dual Storage: Binary + JSON

Store both formats to serve different access patterns:

```
Table: collaborative-documents
PK: documentId (string)
SK: "LATEST" | "v#<timestamp>" (for versions)

Attributes:
  binaryState    (B)    -- Y.encodeStateAsUpdate(ydoc), gzip compressed
  stateVector    (B)    -- Y.encodeStateVector(ydoc), for diff sync
  jsonSnapshot   (S)    -- JSON.stringify(ydocToJSON(ydoc)), for API reads
  title          (S)    -- Denormalized for listing queries
  sourceType     (S)    -- Denormalized for filtering
  createdBy      (S)    -- Cognito sub
  updatedAt      (S)    -- ISO 8601
  version        (N)    -- Incrementing version number
  ttl            (N)    -- Optional, for old versions

GSI: createdBy-updatedAt-index
  PK: createdBy
  SK: updatedAt
  Projects: documentId, title, sourceType, version
```

**Why dual storage:**
- **Binary (binaryState):** Required for Y.js document reconstruction. Apply update to empty Y.Doc to restore full CRDT state including history. Essential for collaborative editing sessions.
- **JSON (jsonSnapshot):** Queryable without loading Y.js. Use for API endpoints that list documents, show previews, or search content. DynamoDB-native format.
- **State vector:** Enables efficient diff sync. Client sends its state vector, server computes minimal update using `Y.diffUpdate(serverUpdate, clientStateVector)`.

### Persistence Flow

```
1. Client edits -> Y.Doc updated locally
2. Y.Doc.on('update') fires -> send update via WebSocket
3. Server batches updates (10ms window, existing pattern)
4. Server merges updates with mergeUpdates()
5. Server broadcasts to other clients
6. Every N operations or T minutes:
   a. Y.encodeStateAsUpdate(serverDoc) -> gzip -> DynamoDB binary
   b. serverDoc.toJSON() -> DynamoDB JSON snapshot
   c. Y.encodeStateVector(serverDoc) -> DynamoDB state vector
```

## Proposed JSON Schema (for DynamoDB jsonSnapshot field)

This is what `ydocToJSON()` produces and what the REST API returns:

```json
{
  "meta": {
    "id": "01HXYZ...",
    "title": "Q2 Planning Meeting Summary",
    "sourceType": "meeting",
    "createdBy": "cognito-sub-abc123",
    "createdAt": "2026-04-11T10:00:00Z",
    "aiModel": "claude-opus-4-6",
    "sourceTranscriptId": "transcript-01HXYZ...",
    "version": 3
  },
  "sections": [
    {
      "id": "01HXYZ-sec1",
      "type": "summary",
      "title": "Meeting Summary",
      "content": "The team discussed Q2 priorities including...",
      "items": [],
      "collapsed": false,
      "order": 0
    },
    {
      "id": "01HXYZ-sec2",
      "type": "tasks",
      "title": "Action Items",
      "content": "",
      "items": [
        {
          "id": "01HXYZ-task1",
          "text": "Finalize budget proposal",
          "status": "ack",
          "assignee": "cognito-sub-def456",
          "ackBy": "cognito-sub-def456",
          "ackAt": "2026-04-11T10:15:00Z"
        },
        {
          "id": "01HXYZ-task2",
          "text": "Schedule design review",
          "status": "pending",
          "assignee": "cognito-sub-ghi789",
          "ackBy": null,
          "ackAt": null
        }
      ],
      "collapsed": false,
      "order": 1
    },
    {
      "id": "01HXYZ-sec3",
      "type": "decisions",
      "title": "Key Decisions",
      "content": "1. Ship MVP by May 1st\n2. Use React for frontend\n3. Defer mobile to Q3",
      "items": [
        {
          "id": "01HXYZ-dec1",
          "text": "Ship MVP by May 1st",
          "status": "ack",
          "assignee": null,
          "ackBy": "cognito-sub-abc123",
          "ackAt": "2026-04-11T10:20:00Z"
        }
      ],
      "collapsed": false,
      "order": 2
    },
    {
      "id": "01HXYZ-sec4",
      "type": "notes",
      "title": "Discussion Notes",
      "content": "Connor raised concerns about timeline...\n\nThe team agreed to...",
      "items": [],
      "collapsed": true,
      "order": 3
    }
  ],
  "participants": {
    "cognito-sub-abc123": {
      "userId": "cognito-sub-abc123",
      "displayName": "Connor",
      "role": "owner",
      "joinedAt": "2026-04-11T10:00:00Z"
    },
    "cognito-sub-def456": {
      "userId": "cognito-sub-def456",
      "displayName": "Alex",
      "role": "reviewer",
      "joinedAt": "2026-04-11T10:02:00Z"
    }
  }
}
```

## Mode Handling: Read vs Edit vs Ack

### UI Mode Architecture

```
Mode        | Can Edit Content | Can Ack Tasks | Can See Cursors | Awareness State
------------|-----------------|---------------|-----------------|----------------
viewer      | No              | No            | Yes (others)    | mode: 'viewing'
editor      | Yes             | Yes           | Yes (all)       | mode: 'editing', currentSection
reviewer    | No              | Yes           | Yes (all)       | mode: 'reviewing', currentSection
```

### Implementation Pattern

```typescript
type DocumentMode = 'viewing' | 'editing' | 'reviewing';

// Mode is determined by participant role + user choice
function getEffectiveMode(
  role: 'owner' | 'editor' | 'reviewer' | 'reader',
  userSelectedMode?: DocumentMode
): DocumentMode {
  if (role === 'reader') return 'viewing';
  if (role === 'reviewer') return 'reviewing';
  // owners and editors can switch between editing and viewing
  return userSelectedMode || 'editing';
}

// Gate operations based on mode
function canEditSection(mode: DocumentMode): boolean {
  return mode === 'editing';
}

function canAcknowledgeTask(mode: DocumentMode): boolean {
  return mode === 'editing' || mode === 'reviewing';
}
```

## Integration with Existing Architecture

### WebSocket Gateway Extension

The existing `crdt-service.js` handles channel-level Y.Doc sync. For structured documents:

1. **One Y.Doc per document** (not per channel). The channel name maps to the document ID: `crdt:doc-{documentId}`.

2. **Server maintains Y.Doc in memory** during active sessions (existing `channelStates` pattern), with the full nested structure.

3. **Snapshot persistence** uses the existing EventBridge -> Lambda -> DynamoDB pipeline, extended to store the dual binary+JSON format.

4. **Awareness** rides the existing WebSocket connection. The gateway would need a new service action (`awareness:update`) or extend the crdt service to relay awareness state changes.

### Migration Path from Current useCRDT

Current `useCRDT.ts` uses a single Y.Text per channel. The structured document pattern requires:

1. A new hook (e.g., `useCollaborativeDocument`) that manages the full Y.Doc schema
2. Keep existing `useCRDT` for simple collaborative text editing
3. New hook handles section-level observation, task acknowledgment, and mode-aware editing
4. Awareness state piggybacked on the same WebSocket connection

## Undo/Redo Strategy

```typescript
import { UndoManager } from 'yjs';

// Track only user edits, not AI insertions
const undoManager = new UndoManager(
  [ydoc.getArray('sections')], // scope: all sections
  {
    trackedOrigins: new Set([null]), // only track local (null origin) changes
    // AI insertions use origin 'ai-regeneration' -- excluded from undo
    captureTimeout: 500, // merge edits within 500ms
  }
);

// Undo last user edit
undoManager.undo();

// Redo
undoManager.redo();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Y.js V1 encoding | V2 encoding available | yjs 13.5+ | ~40% better compression for stored updates |
| Single Y.Text documents | Block-based Y.XmlFragment (BlockNote, Tiptap) | 2024-2025 | Rich editors use XML structure internally |
| Custom sync protocol | y-protocols sync + awareness | Stable since 2023 | Standardized protocol for all Y.js providers |
| Store full Y.Doc copies for versions | Y.snapshot + Y.createDocFromSnapshot | Available since yjs 13.x | Lightweight version references instead of full copies |

## Open Questions

1. **Server-side Y.Doc memory management:**
   - What we know: Each active document needs a Y.Doc in server memory. The existing `channelStates` Map handles this.
   - What's unclear: Memory budget per document with nested structures. A document with 20 sections and 100 tasks is small, but 1000 concurrent documents could add up.
   - Recommendation: Profile memory usage of a typical document Y.Doc. Set a max-concurrent-documents limit with LRU eviction.

2. **Offline editing support:**
   - What we know: Y.js supports offline edits natively -- updates queue locally and merge when reconnected.
   - What's unclear: Whether the current WebSocket-only transport handles offline gracefully or if IndexedDB persistence is needed client-side.
   - Recommendation: For MVP, rely on WebSocket reconnection (existing session recovery). Add y-indexeddb later for true offline support.

3. **Document size limits for DynamoDB:**
   - What we know: DynamoDB max item size is 400KB. A gzip-compressed Y.Doc binary for a moderate document (10 sections, 50 tasks, ~5000 words of content) should be well under this.
   - What's unclear: At what document complexity the 400KB limit becomes a concern.
   - Recommendation: Monitor compressed size. If approaching 300KB, split storage (binary update in S3, reference in DynamoDB).

## Sources

### Primary (HIGH confidence)
- [Y.Map API - Yjs Docs](https://docs.yjs.dev/api/shared-types/y.map)
- [Y.Array API - Yjs Docs](https://docs.yjs.dev/api/shared-types/y.array)
- [Working with Shared Types - Yjs Docs](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Awareness API - Yjs Docs](https://docs.yjs.dev/api/about-awareness)
- [Document Updates API - Yjs Docs](https://docs.yjs.dev/api/document-updates)
- [Y.UndoManager - Yjs Docs](https://docs.yjs.dev/api/undo-manager)
- [Yjs Snapshots - DeepWiki](https://deepwiki.com/yjs/yjs/6.3-snapshots)

### Secondary (MEDIUM confidence)
- [Common Concepts & Best Practices - Yjs Community](https://discuss.yjs.dev/t/common-concepts-best-practices/2436) - Community forum with maintainer participation
- [Best way to store deep JSON objects - Yjs Community](https://discuss.yjs.dev/t/best-way-to-store-deep-json-objects-js-object-or-y-map/2223) - Verified nested Y.Map performance tradeoffs
- [Y.Array vs Y.Map for syncing list data - Yjs Community](https://discuss.yjs.dev/t/y-array-vs-y-map-for-syncing-list-data-that-changes/651) - Pattern for ordered structured collections
- [BlockNote Document Structure](https://www.blocknotejs.org/docs/editor-basics/document-structure) - Block model reference
- [y-dynamodb - npm](https://www.npmjs.com/package/y-dynamodb) - DynamoDB persistence patterns

### Tertiary (LOW confidence)
- [Merging two different Y.js documents - Yjs Community](https://discuss.yjs.dev/t/merging-two-different-y-js-documents/2538) - AI content merge patterns (community discussion, not official)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - yjs 13.6.30 already in project, APIs verified against official docs
- Architecture patterns: HIGH - Y.Map/Y.Array nesting verified in official docs and community best practices
- Schema design: HIGH - Follows established block-based document patterns (BlockNote reference)
- Persistence strategy: MEDIUM - Dual binary+JSON pattern is common but y-dynamodb specifics not deeply verified
- Pitfalls: HIGH - Sourced from official docs warnings and community issue reports

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (Y.js is stable, slow-moving)
