# Phase 51 — Design Document Journey: existing capability assessment

Audit done before any code per hub#57. The goal: know honestly what's
shipped vs. faked vs. gap, so the comprehensive journey is credible
and the gap-list becomes a real next-phase backlog.

## TL;DR

Phase 51 has shipped *more* than I expected at the renderer + collab
layer and *less* than expected at the multi-page-wizard / diagram /
viewer-mode layers. The journey is feasible end-to-end with two
genuine placeholders (multi-page wizard, diagram primitive) and one
visually-faked-but-real-underneath layer (real-time presence — the
infra is shipped via TipTap+Yjs, but per-section presence indicators
are partial).

## What ships today (real)

### Document type schema (admin defines fields)

- **Phase 51 Phase A** server-side document types (`/api/document-types`)
  with `text` + `long_text` field types.
- **Phase 51 Phase B** added `number`, `date`, `boolean`.
- **Wizard UI** (`/document-types`) supports adding fields by
  *renderer type* — see below — not the API-side `fieldType` enum.
  The two layers run in parallel; Phase A.5's adapter translates
  wizard saves into API shape on best-effort sync.

### Section renderers (the rich field types in the editor)

Five renderers ship in `frontend/src/renderers/*`:

| renderer    | what it does                                                          | journey usage                            |
|-------------|-----------------------------------------------------------------------|------------------------------------------|
| `tasks`     | Action-item table: rows of {assignee, due, status, label}             | Action Items + Pending Tasks sections    |
| `decisions` | Append-only decision/approval log w/ reviewer name + timestamp         | Approvals / Decision Log section         |
| `rich-text` | TipTap editor for long-form body (with collab cursor)                 | Long-form body section                   |
| `checklist` | Yes/no checklist                                                      | (not used in this journey — could be)    |
| `default`   | Fallback                                                              | (not used)                               |

Each renderer ships an **editor**, **reader**, and **ack** view-mode
component (`DefaultRenderer` for everything else). So a journey can
genuinely capture a "viewer reads this" screenshot — that's real.

### Real-time collaboration

- **TipTap + @tiptap/y-tiptap** are in the deps; collaboration cursor
  (`@tiptap/extension-collaboration-cursor`) is wired.
- **CRDT layer** is the gateway's own: WebSocket-backed CRDT service
  (see `src/services/crdt-service.js`) with snapshot persistence to
  the `crdt-snapshots` DDB table.
- **Presence** lives in `frontend/src/hooks/usePresence.ts` plus a
  `ParticipantAvatars` component in the doc editor — the avatars
  appear in the document header in real time.

### Approval workflow (per-document, not per-section)

- The Tiltfile's `dynamodb-setup` creates an `approval-workflows`
  table with a status-index GSI. Schema is per-document
  (`documentId` + `workflowId` keys).
- The decisions renderer's "log" semantics are append-only entries,
  but there's no first-class "approve this section now" flow tied
  to that table. Mostly a renderer-level concept.

### Document editor UI surfaces

- `/documents` — list of documents.
- `/documents/:documentId` — editor page with mode switcher
  (`editor` / `reader` / `ack`).
- `DocumentHeader`, `ParticipantAvatars`, `ActivityFeed`, `EditorToolbar`,
  `AckMode` (sequential chunk review), `ReaderMode` — all exist.
- View mode is a `?mode=reader` / `?mode=ack` URL parameter.

## What's a gap (honest)

### Multi-page wizard layout

Today's wizard (`DocumentTypeWizard`, ~564 LOC) has a fixed 3-step
flow: basics → fields → view-modes. There is **no per-section page
assignment** — all fields end up on a single editor screen, regardless
of length. For the journey, "splitting the doc across multiple wizard
pages" doesn't have a configurable surface.

**Journey workaround:** the journey captures the existing 3-step
wizard as the closest analog to "page 1 / page 2 / page 3" — Basic
Info / Sections / View Modes. A placeholder note acknowledges this
isn't section-paginated content.

**Filed as follow-up:** hub task — "Phase 51 / multi-page layout"
(see follow-up section).

### Diagram embed primitive

No `diagram` / `image` / `embed` renderer ships today. None of the
five renderers handle inline imagery beyond what `rich-text` (TipTap)
permits in its content body.

**Journey workaround:** the journey adds a `default` section labeled
"Architecture Diagram" and renders it as the empty placeholder — the
screenshot demonstrates the slot exists, not that an image is loaded.

**Filed as follow-up:** "Phase 51 / diagram renderer."

### Viewer-mode layout differs from editor

The reader-mode renderers exist per section type, but the *layout*
of the page doesn't materially change between editor and reader —
same doc-editor shell, swapped section components. There is no
TOC / anchor links / paginated reader.

**Journey workaround:** capture the reader-mode rendering as-is. The
absence of a richer viewer is named in the assessment.

**Filed as follow-up:** "Phase 51 / viewer-mode TOC + paginated
reader."

### Per-section presence (the "alice is editing the decision-log" indicator)

`ParticipantAvatars` shows users who are on the doc, but doesn't
attribute them to a specific section in the UI. The CRDT layer can
discriminate (Yjs awareness state can carry a `currentSection`), but
the rendering at the section level isn't shipped.

**Journey workaround:** the journey opens two contexts and lets both
participants type concurrently in the same doc. The header's
`ParticipantAvatars` updates in real time — that's a genuine
real-time signal even without per-section attribution.

**Filed as follow-up:** "Phase 51 / per-section presence attribution."

### Per-section approval flow (with append-only log)

The `decisions` renderer has append-only log semantics, but doesn't
trigger DB writes against `approval-workflows` — it persists via
the CRDT layer like any other section. There's no "click approve →
log entry persists with reviewer name + section ID + timestamp"
wired to the approval-workflows table.

**Journey workaround:** the journey uses the decisions renderer's
in-renderer "add entry" affordance (whatever it has) to demonstrate
the append flow. The persistence is via CRDT, not the
approval-workflows table — and this is acknowledged explicitly.

**Filed as follow-up:** "Phase 51 / wire decisions renderer to
approval-workflows table."

## Stack used to capture the journey

- Existing snapshot-stack.sh + snapshot-bootstrap + snapshot-seed
  bring up DDB-local + Redis-local + tables. (Per orchestrator
  handoff #35 the operator wants this migrated to Tilt; see follow-up
  task.)
- Frontend dev server at :5174 with `VITE_DEV_BYPASS_AUTH=true`.
- Two `browser.newContext()` calls in the journey for the two-user
  collab scene.

## Inventory of the journey scenes

Per the task spec: ~25-40 steps total. Concrete plan:

- **Scene A — Admin defines schema (10 steps):** wizard creates
  "Design Document" with sections for tasks, decisions, rich-text body.
- **Scene B — End user fills via wizard (12 steps):** open editor,
  pick the new type, fill metadata, advance through the 3 wizard
  pages, save.
- **Scene C — Viewer reads (4 steps):** ?mode=reader on the same doc;
  capture the read-only rendering.
- **Scene D — Two-user collab (6 steps):** two browser contexts,
  ParticipantAvatars updates as both join, both edit different
  sections concurrently, screenshots show the avatar update + a
  decision log append from one user appearing in the other's view.

## Follow-ups filed (gap tasks)

- Phase 51 / multi-page layout — split sections across configurable
  wizard pages.
- Phase 51 / diagram renderer — image / SVG / embed primitive.
- Phase 51 / viewer-mode TOC + paginated reader — richer reader
  layout distinct from editor.
- Phase 51 / per-section presence attribution — Yjs awareness
  surfacing on individual sections.
- Phase 51 / decisions renderer ↔ approval-workflows table wiring —
  persist approval entries to the dedicated table.
- Phase 51 / migrate snapshot stack to Tilt — per orchestrator
  handoff #35; remove docker-compose-style scripts in favor of
  `tilt up`.

These are filed as separate hub tasks — each scoped <200 LOC.
