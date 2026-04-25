# Changelog

## [Unreleased] — Pipelines Phase 0 + Phase 1

### Added
- **Pipelines feature** (`/pipelines`) — visual workflow builder using React Flow:
  - 8 node types: Trigger, LLM, Transform, Condition, Action, Fork, Join, Approval
  - Full-canvas editor with drag-drop node palette, config panel, execution log
  - Inline execution visualization (node state colors, LLM token streaming, edge flow animation)
  - Pipeline list view with search, filters (status, trigger, tags), sort
  - Run replay page with scrubber UI (Phase 5 will wire to WAL)
  - Run history page `/pipelines/:id/runs`
  - Pending approvals page `/pipelines/approvals`
  - Pipeline templates gallery (document summary, meeting notes, content moderation, auto-tag, approval chain, webhook translate)
  - Pipeline icon picker + tag editor in the editor top bar
  - Validation suite (7 error codes, 4 warning codes) with jump-to-node from issues
  - Publish / draft lifecycle with version tracking
  - Copy/paste/duplicate/undo/redo keyboard shortcuts on the canvas
- **Observability feature** (`/observability`) — system-level dashboard:
  - Dashboard, Nodes, Events, Metrics sub-routes
  - KPI cards, node grid with sparklines, event timeline with filter rail, metric charts (recharts)
  - Chaos panel wired to an in-memory chaos state that affects MockExecutor latency + failure rates
- **Executor:** `MockExecutor` Phase 1 in-browser — full §8 + §17 executor contract, streams LLM tokens, handles approval blocking, cancel, fork-branch partial failures, Join modes (all / any / n_of_m) with race-safe sibling cancellation
- **Shared primitives:** `Modal`, `EmptyState`, `Toast` + `ToastProvider`, `ShortcutsHelp`, `IconPicker`, `TagEditor`, `UserPicker`, `CodeEditor`, `Sparkline`, `Chart` (recharts wrapper), `SkeletonCard`, `EventRow` + `eventGlyphs`
- **Gateway service scaffolds:** `pipeline-service.js` + `pipeline-bridge.js` for Phase 4 EventBus-over-WebSocket wiring
- **Backend endpoint:** `GET /api/profiles?q=…` for UserPicker search
- **Reduced-motion support** via `usePrefersReducedMotion` across all animated elements
- **Keyboard shortcut help overlay** triggered by `?`

### Changed
- `AppLayout`: added `Pipelines` and `Observability` primary tabs + Pipelines sub-nav (All / Pending approvals badge) + Observability sub-nav (Dashboard / Nodes / Events / Metrics)
- `CollapsibleSidebar`: added Pipelines section listing the user's pipelines
- `DocumentTypesPage` + `NewDocumentModal`: refactored to consume shared `Modal` + `EmptyState` primitives (visual output unchanged)
- `BigBrotherPanel`: extracted row-rendering to shared `EventRow` + `eventGlyphs` (used by Observability Events too)

### Removed (Phase 0)
- Entire legacy approval/workflow system: `WorkflowPanel`, `useWorkflows`, `WorkflowEngine`, `ApprovalWorkflowRepository`, `approvalWorkflows` route, MCP tools (`document_get_workflow`, `document_advance_workflow`, `my_pending_workflows`), `DocumentType.workflows` field, DocumentTypeWizard Step 4, `approval-workflows` DynamoDB table
- See `PIPELINES_PLAN.md` §12 for the complete file-by-file deletion manifest

### Tests
- 193 new pipeline tests passing (validation, storage, contract, integration, perf, contexts, node components, routes smoke, handleCompatibility)
- 9 tests explicitly skipped with TODOs pointing at Phase 2/3/5 work

### Deferred to later phases
- **Phase 3:** `PipelineModule` in `distributed-core` — sandbox-blocked from this session; will be built from that repo
- **Phase 4:** Real WebSocket bridge from `EventBus` in distributed-core → gateway `pipeline-service` → frontend
- **Phase 5:** WAL replay for historical runs, chaos panel wired to real `ChaosInjector`
