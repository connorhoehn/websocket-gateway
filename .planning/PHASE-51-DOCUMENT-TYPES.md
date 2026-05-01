# Phase 51 — Document Types & Fields (Drupal Fields-UI / Webforms style)

**Status:** Phases A through G **SHIPPED**. Phase F decision: Option B
(parallel systems — typed documents and CRDT documents remain separate).

## North star

Tenant admins define their own document shapes (types) and the fields
inside them — text, numbers, dates, references, taxonomy — without
engineering involvement. End-users create documents matching those
shapes via auto-generated forms. Operators get a no-code path to add
new document shapes; engineering stops being a bottleneck for "we
need a new field on the X form."

The reference is Drupal's Content Types + Fields UI (and Webforms).
Concretely: pick a field type, pick a widget, set cardinality, set
validation. Don't build a CMS.

## Carry-over from Drupal

What we **carry**:
- Type → fields → widget separation (the data shape is independent of
  how it's collected/displayed).
- Cardinality (1 / N / unlimited) as a per-field config.
- Required / default / help text / validation rules at the field.
- Display modes (full / teaser / list — different field subsets render
  differently).
- Reference fields and taxonomy terms.

What we **drop**:
- Drupal's view-mode-per-bundle templating engine (Twig). React
  rendering is enough.
- Multilingual field translations (single-language for v5.0; revisit
  with a real internationalization initiative).
- Field formatters as user-configurable per display (Phase F+ at the
  earliest; default formatter per type is enough).
- The full module/permission/role taxonomy that Drupal layers on top.
- Drupal's bundle-vs-entity distinction. We have one entity type
  (TypedDocument); each "bundle" is a DocumentType row.

## Existing scaffolding (what we don't have to rebuild)

The frontend ALREADY has:
- `frontend/src/components/doc-types/DocumentTypesPage.tsx` (350 LOC)
- `frontend/src/components/doc-types/DocumentTypeWizard.tsx` (564 LOC,
  37 vitests)
- `frontend/src/components/field-types/FieldTypesPage.tsx` (638 LOC)
- `frontend/src/types/documentType.ts` — `DocumentType` + `DocumentTypeField`
  shapes.
- `frontend/src/hooks/useDocumentTypes.ts` — CRUD with localStorage
  persistence.
- `frontend/src/renderers/{tasks,rich-text,checklist,decisions,default}/`
  — pluggable section-type renderers used by the wizard's field-type
  picker.

What we DON'T have yet:
- Server-side persistence for DocumentType (today: localStorage only).
- Any concept of a "TypedDocument" — a document instance that conforms
  to a DocumentType schema. Today's "Document" (CRDT-backed,
  collaborative-editing) is a separate, untyped surface.
- An auto-generated form that consumes a DocumentType schema and
  produces a typed instance.

## Data model

### DocumentType (the schema)

DDB table: **`document-types`** (new).
- PK: `typeId` (string, UUID).
- Item shape mirrors the existing `DocumentType` TS interface:
  ```
  {
    typeId: string,
    name: string,
    description: string,
    icon: string,
    fields: DocumentTypeField[],   // see below
    createdBy: string,             // userId
    createdAt: string,             // ISO
    updatedAt: string,             // ISO
  }
  ```
- `DocumentTypeField` (Phase A — text/long_text only):
  ```
  {
    fieldId: string,
    name: string,
    fieldType: 'text' | 'long_text',
    widget: 'text_field' | 'textarea',
    cardinality: 1 | 'unlimited',
    required: boolean,
    helpText: string,
  }
  ```
- Phase B+ adds `number | date | boolean`. Phase C+ adds
  `reference | taxonomy | enum`.

### TypedDocument (the instance)

DDB table: **`typed-documents`** (new).
- PK: `documentId` (string, UUID).
- GSI on `typeId` (so "list all instances of type X" is a Query, not a
  Scan).
- Item shape:
  ```
  {
    documentId: string,
    typeId: string,
    values: Record<fieldId, string | string[]>,
                                   // string when cardinality=1
                                   // string[] when cardinality=unlimited
    createdBy: string,
    createdAt: string,
    updatedAt: string,
  }
  ```
- Validation: route POST /api/typed-documents enforces that every
  required field on the type has a value, and every value is shaped
  according to the field's cardinality. Unknown fields are rejected.

### Storage choice — defended

- **DDB chosen** (vs SQLite / distributed-core / pipeline state machine).
  - social-api's existing convention is DDB across all repos. Adding a
    new table is one IaC entry; consistent with how Profiles, Rooms,
    Groups, Documents, etc. live.
  - distributed-core's `ResourceRegistry` is the wrong shape — it's
    built for cluster ownership semantics (Raft-replicated entity
    state for routing), not for application schemas with a CRUD UI.
    Using it would be an anti-goal per the constitution's
    "Don't recreate distributed-core abstractions in this repo."
  - SQLite would add a new dependency for no benefit; we don't gain
    transactionality we need (each document write is one-shot), and
    we'd lose the fan-out story the existing DDB streams give us for
    free in Phase F.
  - The pipeline state machine is for orchestration runs, not
    application data — orthogonal.

### Phase F decision: TypedDocument and Document remain separate (Option B)

**Operator decision (via blocker #26, 2026-05-01):** TypedDocument and
Document (CRDT/Yjs-backed) remain **parallel systems** — no bridge, no
subsumption. Rationale: Phases A–E demonstrated that the two surfaces
solve distinct problems (structured data collection with validation vs.
collaborative unstructured editing). They don't overlap in current usage;
forcing convergence would be high-cost for low immediate benefit. The two
systems coexist: TypedDocument for intake forms / registry / taxonomy,
Document for narrative / freeform collaborative surfaces.

## Phase decomposition

| Phase | Title                                          | Demo at end of phase                                                              |
|-------|------------------------------------------------|-----------------------------------------------------------------------------------|
| A     | Server-side persistence + minimal auto-form    | Admin creates type ("Article" with `title`/`body`); end-user fills form; persists | **SHIPPED** |
| A.5   | Wizard dual-write to server                    | Wizard saves sync to `/api/document-types` when authenticated                     | **SHIPPED** |
| B     | More field types: number, date, boolean        | Same flow with the four primitive field types                                     | **SHIPPED** |
| C     | Reference / taxonomy / enum fields             | Field that picks from another typed-document or a controlled vocabulary           | **SHIPPED** |
| D     | Validation rules + required/conditional logic  | Required + min/max + regex + show-this-field-when                                 | **SHIPPED** |
| E     | Display modes (full / teaser / list)           | Admin picks which fields show in each render context                              | **SHIPPED** |
| F     | Bridge to CRDT documents (decision phase)      | Decide: do typed documents subsume CRDT docs, OR do they remain parallel?         | **SHIPPED (Option B: parallel)** |
| G     | Bulk import/export, JSON Schema export         | Admin exports a type as JSON Schema; bulk-import instances from CSV               | **SHIPPED** |

This list is the menu, not a commitment. Phases B–G get filed as
separate hub tasks. Each is bounded; none is more than ~300 LOC.

## Integration points

- **Existing doc-type wizard**: in Phase A the wizard's local-storage
  CRUD path is preserved (37 tests stay green); we additionally
  best-effort sync wizard saves to the new server. Phase A.5 (small
  follow-up) flips primary persistence to the server.
- **Existing renderer registry** (`frontend/src/renderers/registry.ts`):
  Phase B+ ties new field types to renderers; Phase A's two field
  types use plain `<input>` / `<textarea>` and don't go through the
  registry yet (decoupling — the registry is currently for
  CRDT-section renderers, a different surface).
- **distributed-core**: NONE in Phase A. The pin stays at v0.11.0.
  This phase neither adopts new core symbols nor blocks on any.
- **Pipeline / EventBus**: NONE in Phase A. Document mutations could
  fan out to subscribers via the bus (Phase F+ candidate); not now.

## Phase A acceptance (this hub#48)

- `social-api` ships:
  - `DocumentTypeRepository` (DDB-backed; create, get, list, update, delete)
  - `TypedDocumentRepository` (DDB-backed; create, get, list-by-type)
  - `routes/documentTypes.ts` (POST/GET/LIST/PUT/DELETE under
    `/api/document-types`)
  - `routes/typedDocuments.ts` (POST/GET/LIST under `/api/typed-documents`)
  - Unit tests for both repos + integration tests for both routes.
- `frontend` ships:
  - `useTypedDocuments` hook (API CRUD).
  - `TypedDocumentForm` — auto-generated form: given a DocumentType,
    render `<input type="text">` for `text` fields, `<textarea>` for
    `long_text` fields, with cardinality 1 / unlimited support
    (unlimited shows a `+` button to add another value).
  - `TypedDocumentsPage` — picks a type from existing store, renders
    the form, lists existing instances of that type.
  - Vitests on the new components.
  - Best-effort sync of `useDocumentTypes` saves to the new server
    endpoint (NON-blocking — localStorage stays primary so the 37
    existing wizard tests are unaffected).
- Test totals stay green: gateway 372 / social-api 297 / frontend 994.
- Constitution edit submitted via handoff to orchestrator (NOT
  silently committed).

## Demo path

Once Phase A lands:

1. Open the admin wizard, create a type "Note" with two fields:
   `title` (text, required, cardinality=1) and `body` (long_text,
   cardinality=1, optional).
2. Open the new TypedDocuments page; pick "Note" from the type list.
3. Fill in title and body; submit.
4. The new instance appears in the list below the form.
5. Refresh the browser — the type AND the instance survive.
6. Curl: `GET /api/typed-documents?typeId=<id>` returns the instance.

## Out of scope for Phase A (deferred to follow-up phases)

- Number / date / boolean fields (Phase B).
- Reference / taxonomy / enum (Phase C).
- Validation rules beyond presence + cardinality (Phase D).
- Display modes (Phase E).
- Linking typed documents to existing CRDT documents (Phase F).
- Bulk operations (Phase G).
- Multi-tenant scoping. Constitution §"single-tenant invariants are
  load-bearing" — defer until tenancy lands as a top-level concern.

## Risks + open questions

- **DDB IaC step.** New tables (`document-types`, `typed-documents`)
  need provisioning. Phase A code will use the same `docClient`
  singleton; in the local jest env the existing test pattern mocks
  the client at module level. Real-environment provisioning is
  operator work; left to a separate IaC task.
- **GSI on `typeId`.** TypedDocument list-by-type uses a GSI; until
  the IaC adds it, the route falls back to a filtered Scan (acceptable
  for Phase A demo loads, NOT for production traffic — flagged in code
  comment).
- **Wizard sync rollout.** Best-effort sync means a localStorage type
  may never reach the server if the user closes the tab during a
  network failure. Phase A.5 should flip to server-primary; until
  then this is an acknowledged minor data-fidelity gap on the local
  dev environment only.
