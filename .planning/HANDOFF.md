# Session Handoff — 2026-04-13

## What Was Built This Session

**69 files changed, 7,464 lines added, 1,006 removed** across 29 commits.

### v3.1.2 — Protocol Fixes
- Chat/reaction frontend-backend protocol mismatches fixed (action names, field names, response type matching)
- DynamoDB GSIs added to Tiltfile (social-relationships, social-room-members, social-posts)
- Single-node broadcastToAll fixed (was skipping local clients)
- Awareness infinite render loop fixed (origin check + participant dedup)

### v3.2.0 — UI Overhaul
- CollapsibleSidebar: Channels/Activity/Documents with collapse/expand, mention pulse animation
- ReviewMode: per-section approve/reviewed/changes_requested with progress bar, Y.js sectionReviews map
- Action items on all section types (+ Add Item button universal)
- MentionDropdown: portal-based rendering (fixes overflow clipping)

### v3.2.1 — Polish
- Priority/status as interactive `<select>` dropdowns
- Assignee user picker with search/keyboard nav
- Version history endpoint fix (SnapshotManager argument mismatches)
- Document cross-client visibility fix (Redis availability check)
- Social tab redesign (profile card + Channels/Groups/DMs/Activity split)

### v3.3.0 — DynamoDB Persistence
- Shared DynamoDB client factory (`src/utils/dynamo-client.js`)
- Chat messages persisted to `chat-messages` table (90-day TTL, LRU→DynamoDB fallback)
- Activity events persisted to `user-activity` table
- DocumentMetadataService DynamoDB fallback on update

### v3.3.1 — Version History + Finalize
- Version history: compare shows text content diffs (extracts from Y.XmlFragment)
- Version compare fix: skip version-preview snapshots in live doc handler (prevents CRDT merge corruption)
- Restore removed then re-added with pre-restore checkpoint + warning
- Document finalize/unlock (status: 'final' = read-only)

### v4.0.0 — Decoupled Architecture (10-agent build)
**Data Layer:**
- 5 new DynamoDB tables: document-comments, section-reviews, section-items, document-sections, approval-workflows
- 5 repositories: DocumentCommentRepository, SectionReviewRepository, SectionItemRepository, DocumentSectionRepository, ApprovalWorkflowRepository
- WorkflowEngine: sequential/parallel/any-of approval flows with RBAC

**REST API (social-api):**
- POST/GET/PATCH/DELETE /api/documents/:id/comments
- POST/GET /api/documents/:id/sections/:sid/reviews + /reviews/mine
- POST/GET/PATCH/DELETE /api/documents/:id/sections/:sid/items + /items/mine
- POST/GET /api/documents/:id/workflows + /advance + /workflows/pending
- GET/POST /api/documents/:id/export + /import (JSON canonical model + markdown)

**Integration:**
- document-events WebSocket service (real-time broadcasts for comments/reviews/items/workflows)
- Frontend hooks: useDocumentComments, useDocumentReviews, useDocumentItems (REST + WebSocket)
- MCP server with 14 tools for AI agents (`social-api/src/mcp/`)

### Post-v4.0.0 — Bug Fixes
- CRDT subscribe retry (content wasn't syncing — sendMessage dropped messages before WS open)
- Review approvals sync via observeDeep + initial read
- Activity events for review actions
- Restore version button re-added with confirmation dialog

---

## Current State — What Works

| Feature | Status | Notes |
|---------|--------|-------|
| WebSocket gateway + auth | Working | Cognito JWT, dev tokens |
| Chat (cross-tab) | Working | join/leave/send protocol, DynamoDB persistence |
| Reactions | Working | Ephemeral with auto-removal |
| Presence | Working | Redis pub/sub, awareness dedup |
| Collapsible sidebar | Working | Channels/Activity/Documents |
| Document editor (3 modes) | Working | Editor/Review/Read |
| CRDT sync (Y.js) | Working | Subscribe retry at 500ms/1500ms |
| Comments (Y.js) | Working | Threaded, resolve/unresolve, @mentions |
| Review mode | Working | Per-section approve, progress bar, observeDeep sync |
| Version history | Working | Save, compare diffs (text content), restore with checkpoint |
| Finalize/Unlock | Working | Read-only enforcement |
| Comment sidebar | Working | Inline, aligned with section, 420px |
| Action items everywhere | Working | + Add Item on all section types |
| Priority/Status dropdowns | Working | Keyboard-navigable selects |
| Assignee picker | Working | User directory search |
| Social tab | Working | Profile + Channels/Groups/DMs + Activity |
| DynamoDB persistence | Working | Chat, activity, documents, snapshots |
| REST API (comments) | Working | Full CRUD + broadcast |
| REST API (reviews) | Working | Submit/query + cross-doc |
| REST API (items) | Working | Full CRUD + assignee query |
| REST API (workflows) | Working | RBAC engine, sequential/parallel/any |
| Import/Export | Working | JSON canonical model + markdown |
| MCP server | Working | 14 tools for AI agents |
| CI/CD | Working | lint-and-typecheck + docker-build |

---

## Known Issues & Limitations

### 1. CRDT Restore — Additive Merge Problem
**Status:** Partially working
Y.js merge is additive — restoring an old snapshot merges it rather than replacing. The server correctly destroys and replaces its Y.Doc, but connected clients still have their merged state. New clients connecting after restore get the correct state.

**Fix needed:** A `crdt:doc-replaced` signal protocol where:
1. Server sends `type: 'crdt:doc-replaced'` instead of `crdt:snapshot`
2. Client destroys its Y.Doc + Awareness, creates fresh ones
3. Client re-registers all observers
4. This is architecturally complex — see the deep analysis in memory

### 2. Frontend Not Yet Wired to REST API Hooks
**Status:** Hooks created, not wired
The `useDocumentComments`, `useDocumentReviews`, `useDocumentItems` hooks exist but DocumentEditorPage.tsx still uses the Y.js-based versions. Wiring them requires:
- Replace `comments` from `useCollaborativeDoc` with `useDocumentComments`
- Replace `sectionReviews` from `useCollaborativeDoc` with `useDocumentReviews`
- This is the final cutover step of the v4.0 architecture

### 3. No Toast Notifications for Item Assignments
When a user is tagged as assignee on an action item, no notification appears on other users' UIs. The notification system exists (AppLayout NotificationBanner) but only handles mentions in comments, not item assignments.

### 4. Auto-save Frequency
Snapshots auto-save frequently (every 5 seconds debounce, 50 ops threshold). This creates many version history entries. Consider increasing the interval or only showing manual saves by default.

### 5. `crdt-snapshots` Table Key Name
The Tiltfile creates the table with `documentId` as hash key, but the table may have been created earlier with `channelId`. If version history shows "Loading..." forever, delete and recreate the table: `aws dynamodb delete-table --table-name crdt-snapshots --endpoint-url http://localhost:8000 --region us-east-1 && tilt trigger dynamodb-setup`

---

## Architecture After v4.0

```
┌──────────────────────────────────────────┐
│  MCP Server (14 tools)                   │  social-api/src/mcp/
├──────────────────────────────────────────┤
│  Document REST API                       │  social-api/src/routes/
│  /documents/:id/comments                 │    documentComments.ts
│  /documents/:id/sections/:id/reviews     │    sectionReviews.ts
│  /documents/:id/sections/:id/items       │    sectionItems.ts
│  /documents/:id/workflows                │    approvalWorkflows.ts
│  /documents/:id/export + /import         │    documentImportExport.ts
├────────────┬─────────────────────────────┤
│  Y.js CRDT │  DynamoDB Tables            │
│  (content  │  - document-comments        │  social-api/src/repositories/
│   editing  │  - section-reviews          │
│   only)    │  - section-items            │
│            │  - document-sections        │
│            │  - approval-workflows       │
│            │  - crdt-documents (metadata)│
│            │  - crdt-snapshots (versions)│
│            │  - chat-messages            │
│            │  - user-activity            │
├────────────┴─────────────────────────────┤
│  WebSocket Services                      │  src/services/
│  - crdt (Y.js sync)                     │    crdt-service.js
│  - chat                                 │    chat-service.js
│  - document-events (broadcasts)          │    document-events-service.js
│  - presence, reactions, cursors          │    presence/reaction/cursor-service.js
│  - activity, social                     │    activity/social-service.js
├──────────────────────────────────────────┤
│  Frontend Hooks                          │  frontend/src/hooks/
│  - useCollaborativeDoc (Y.js)           │    Active: comments/reviews in Y.js
│  - useDocumentComments (REST+WS)        │    Created but NOT wired yet
│  - useDocumentReviews (REST+WS)         │    Created but NOT wired yet
│  - useDocumentItems (REST+WS)           │    Created but NOT wired yet
└──────────────────────────────────────────┘
```

---

## How to Run

```bash
tilt up
# If tables are missing:
tilt trigger dynamodb-setup
# If gateway crashes:
kubectl logs -l app.kubernetes.io/component=gateway
# Rebuild after code changes:
tilt trigger wsg-websocket-gateway-gateway
tilt trigger wsg-websocket-gateway-social-api
# If disk space error on build:
docker system prune -af
```

---

## Next Steps — Priority Order

### 1. Wire Frontend to REST API (Complete v4.0 Cutover)
Replace Y.js-based comments/reviews in DocumentEditorPage.tsx with the REST-backed hooks. This is the final decoupling step.

**Files:** `frontend/src/components/doc-editor/DocumentEditorPage.tsx`
**Hooks:** `useDocumentComments`, `useDocumentReviews`, `useDocumentItems`

### 2. CRDT Doc-Replaced Protocol
Implement the `crdt:doc-replaced` signal so restore works for connected clients. Requires changes to GatewayProvider.ts, useCollaborativeDoc.ts, and crdt-service.js.

### 3. Workflow UI
Build frontend components for the approval workflow system. The REST API and engine exist — needs UI for creating workflows, viewing progress, and advancing steps.

### 4. Item Assignment Notifications
Add toast notifications when a user is assigned to an action item. Wire through the existing NotificationBanner system.

### 5. Google Docs Integration
The import/export layer supports JSON and markdown. Add Google Docs webhook adapter for bidirectional sync.

---

## Tags
- `v3.1.2` — Protocol fixes
- `v3.2.0` — UI overhaul (sidebar, review mode, mentions)
- `v3.2.1` — Polish (dropdowns, social redesign)
- `v3.3.0` — DynamoDB persistence
- `v3.3.1` — Version history + finalize
- `v4.0.0` — Decoupled architecture (10-agent build)
