# Multi-Document Workspace Plan

## Current State
- Single document hardcoded as `documentId="demo-q2-sprint"` in AppLayout.tsx:666
- Backend (CRDT service, DynamoDB, Redis) already supports N concurrent documents
- Each document is a Y.js channel (`doc:{documentId}`) with independent state
- Activity bus is global (not scoped to document)

## Target State
A document workspace where users can create, browse, and collaborate on multiple documents of various types, with per-document presence showing who's working where.

---

## Document Types

| Type | Icon | Use Case | Default Sections |
|------|------|----------|-----------------|
| **Meeting Notes** | 📝 | Post-meeting action items | Summary, Action Items, Decisions, Notes |
| **Sprint Planning** | 🚀 | Sprint/iteration planning | Summary, Backlog, Tasks, Decisions |
| **Design Review** | 🎨 | Design decisions & feedback | Summary, Design Decisions, Open Questions, Notes |
| **Project Brief** | 📋 | Requirements & scope | Executive Summary, Requirements, Success Criteria, Timeline |
| **Decision Log** | ⚖️ | Track organizational decisions | Decisions (tasks type), Context, Notes |
| **Retrospective** | 🔄 | Team retrospectives | What Went Well, What Didn't, Action Items |
| **Custom** | 📄 | Blank document | (empty, user adds sections) |

---

## Architecture

### Data Model

```
DynamoDB Table: doc-metadata
PK: documentId (String, UUID)

Attributes:
  title: String
  type: String (meeting|sprint|design|project|decision|retro|custom)
  status: String (draft|review|final|archived)
  createdBy: String (userId)
  createdAt: String (ISO8601)
  updatedAt: String (ISO8601)
  icon: String (emoji)
  description: String (optional, short summary)
  tags: List<String>
```

For local dev: store document metadata in Redis (no DynamoDB table needed):
```
Key: doc:meta:{documentId}
Value: JSON string of metadata
```

For listing: maintain a sorted set:
```
Key: doc:list
Score: updatedAt timestamp
Member: documentId
```

### Server API (new actions on CRDT service)

```javascript
// List documents
{ service: 'crdt', action: 'listDocuments' }
→ { type: 'crdt', action: 'documentList', documents: [...] }

// Create document  
{ service: 'crdt', action: 'createDocument', meta: { title, type, ... } }
→ { type: 'crdt', action: 'documentCreated', document: {...} }

// Delete document
{ service: 'crdt', action: 'deleteDocument', documentId: '...' }
→ { type: 'crdt', action: 'documentDeleted', documentId: '...' }

// Update document metadata
{ service: 'crdt', action: 'updateDocumentMeta', documentId: '...', meta: {...} }
→ { type: 'crdt', action: 'documentMetaUpdated', document: {...} }
```

### Presence per Document

The existing awareness system already tracks per-channel. For the document list view, we need to aggregate presence across all document channels:

```javascript
// New server action
{ service: 'crdt', action: 'getDocumentPresence' }
→ { type: 'crdt', action: 'documentPresence', presence: {
    'doc:abc': [{ userId, displayName, color, mode }],
    'doc:xyz': [{ userId, displayName, color, mode }],
  }}
```

Server implementation: iterate `channelStates` Map, extract awareness states per channel.

---

## Frontend Components

### 1. DocumentListPage (new)

The main view showing all documents as cards.

```
┌──────────────────────────────────────────────────────┐
│  Documents                              + New Doc    │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🚀 Q2 Sprint Planning          draft          │  │
│  │    3 sections · 7 tasks · 2 comments          │  │
│  │    Updated 2m ago                  🟢AC 🟢DW  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 📝 Weekly Standup Notes         review         │  │
│  │    4 sections · 12 tasks · 5 comments         │  │
│  │    Updated 1h ago                     🟢BM    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🎨 Homepage Redesign Review     final          │  │
│  │    2 sections · 3 decisions                    │  │
│  │    Updated 3d ago                              │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Each card shows:
- Type icon + title + status badge
- Stats: sections, tasks, comments count
- Last updated (relative time)
- Presence avatars (who's currently in the doc) — rightmost column
- Click card → opens document editor
- Click avatar → opens doc + jumps to user's position

### 2. NewDocumentModal (new)

Modal for creating a new document:
- Type selector (grid of cards with icons + descriptions)
- Title input
- Optional description
- Create button → creates metadata + navigates to editor

### 3. DocumentHeader Enhancement

Add breadcrumb: `Documents > Q2 Sprint Planning`
- Click "Documents" → back to list view
- Show document type icon next to title

### 4. AppLayout Changes

Replace hardcoded doc editor with navigation state:

```typescript
// Current
const [activeView, setActiveView] = useState<'panels' | 'dashboard' | 'doc-editor'>('panels');

// New
const [activeView, setActiveView] = useState<'panels' | 'dashboard' | 'documents'>('panels');
const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);

// Render:
// activeView === 'documents' && !activeDocumentId → DocumentListPage
// activeView === 'documents' && activeDocumentId → DocumentEditorPage
```

Tab label: "Document Editor" → "Documents"

---

## Activity Bus Scoping

Add `documentId` to activity events:
```typescript
activityPublish('doc.ack', { 
  itemText: item?.text, 
  sectionId,
  documentId,        // NEW
  documentTitle,     // NEW — human-readable
});
```

Activity feed can then filter/group by document.

---

## Implementation Phases

### Phase 1: Document List + Create (core)
**Files:** 5 new, 3 modified
1. `frontend/src/components/doc-editor/DocumentListPage.tsx` — list view
2. `frontend/src/components/doc-editor/NewDocumentModal.tsx` — create dialog
3. `frontend/src/hooks/useDocuments.ts` — list/create/delete via WebSocket
4. `frontend/src/data/documentTemplates.ts` — type definitions + default sections
5. `src/services/crdt-service.js` — add listDocuments, createDocument, deleteDocument actions
6. `frontend/src/components/AppLayout.tsx` — navigation state, replace hardcoded docId
7. `frontend/src/components/doc-editor/DocumentHeader.tsx` — breadcrumb back to list
8. `frontend/src/components/doc-editor/DocumentEditorPage.tsx` — accept onBack callback

### Phase 2: Per-document presence on list view
**Files:** 2 modified
1. `src/services/crdt-service.js` — getDocumentPresence action
2. `frontend/src/components/doc-editor/DocumentListPage.tsx` — presence avatars on cards

### Phase 3: Activity scoping
**Files:** 2 modified
1. `frontend/src/components/doc-editor/DocumentEditorPage.tsx` — add documentId to events
2. `frontend/src/components/doc-editor/ActivityFeed.tsx` — filter by document

---

## Server Storage (Local Dev)

For local dev without a separate DynamoDB table, store document metadata in Redis:

```javascript
// Create
await redis.set(`doc:meta:${documentId}`, JSON.stringify(meta));
await redis.zadd('doc:list', Date.now(), documentId);

// List
const docIds = await redis.zrevrange('doc:list', 0, -1);
const docs = await Promise.all(docIds.map(id => redis.get(`doc:meta:${id}`)));

// Delete
await redis.del(`doc:meta:${documentId}`);
await redis.zrem('doc:list', documentId);
```

For production: DynamoDB table with GSI on status + updatedAt.

---

## Effort Estimate

| Phase | Agents | Files | Complexity |
|-------|--------|-------|-----------|
| Phase 1 | 3 | 8 | Medium — list view, modal, server CRUD |
| Phase 2 | 1 | 2 | Low — presence aggregation |
| Phase 3 | 1 | 2 | Low — add documentId field |
| **Total** | **5** | **12** | **~1 session** |
