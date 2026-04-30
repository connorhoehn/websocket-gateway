# Constitution: websocket-gateway

> A living document. Edit deliberately and explain the reason in commit messages.
> Workers re-read this on every `/clear` between tasks; it is the north star
> when no task has been dispatched and self-driven work needs to be chosen.

## Mission

A real-time gateway that connects users to backend services with
reliable pipeline orchestration. The application that consumes
`distributed-core` primitives and integrates them with social-api +
frontend into a working product.

## Scope

**This project IS:**
- An application: `gateway/` + `social-api/` + `frontend/`.
- The integration layer that turns `distributed-core` primitives into
  user-visible features (pipelines, presence, rooms, observability).
- The first real consumer of every distributed-core release. When
  distributed-core ships a primitive, this is where its first
  production wiring lives.

**This project IS NOT:**
- A library. Cross-repo abstractions belong in `distributed-core`. If
  you're tempted to copy a function from there and modify it locally,
  STOP and file a task for distributed-core (or a blocker if
  immediate).
- A multi-tenant platform. Single-tenant invariants are load-bearing
  in many code paths.
- A multi-node runtime today. Path-(a) "stay in-process / single-node"
  is the deliberate posture; revisit triggers are explicit (≥2 nodes
  for any reason / pipeline-blocks-API incident / hard
  crash-isolation requirement).

## Principles (non-negotiable)

1. **Pin to versioned distributed-core releases.** Never pin to a SHA
   in production code. Bump the pin as part of a deliberate adoption
   task; integration-test the new symbols before merging.
2. **Don't fork shared code.** If `distributed-core` lacks a variant
   you need, file a task for that repo or raise a blocker.
3. **Test the integration points.** Every new wire to a
   distributed-core primitive needs an integration test in this repo
   that exercises the full call site, not just unit-level mocks.
4. **No premature multi-node.** Don't write code paths "for when we
   add a second node." Add them when the second node is real.
5. **App-side data migrations need approval.** Anything that touches
   production data in a non-throwaway environment is destructive
   work — raise a blocker.
6. **Linear history.** Rebase, don't merge. Commit small + atomic.
   Reference hub task ids in commit bodies.

## Anti-goals

- **Don't recreate distributed-core abstractions in this repo.**
  Recurring temptation: "we just need something simpler." That
  becomes a fork. File a task for distributed-core instead.
- **Don't deploy to AWS / K8s / GCP / Azure from agent sessions.**
  CI is intentionally disabled. Cloud apply is operator-only.
- **Don't add multi-tenant scaffolding.** Single-tenant is the
  contract today.
- **Phase 50 is hardened; Phase 51 is now active.** Polish work on
  Phase 50 surfaces is fine but no longer takes priority over Phase 51
  feature progression.
- **Don't push half-done state to main.** Tests must be green
  (gateway + social-api + frontend) before push.

## Current phase

**Phase 51: Document Types & Fields.** Phase A shipped at SHA `42b27d8`
(hub#48):
- DDB-backed `DocumentTypeRepository` + `TypedDocumentRepository`
- `/api/document-types` CRUD and `/api/typed-documents` create/get/list
  with schema-aware validation
- React `TypedDocumentForm` auto-generates inputs from a schema; new
  `TypedDocumentsPage` lists types and renders instances
- Phase decomposition lives at `.planning/PHASE-51-DOCUMENT-TYPES.md`

Phase 50 is shipped + hardened (operator preview/redrive UX, error
taxonomy, route-level test coverage all closed by self-driven hub#43,
#44, #46). Phase 50 polish backlog is empty.

Tests green: gateway 372 / social-api 239 / frontend 919.

## Phase north-star

Phase 51 lets tenant admins define document shapes (types) and end-users
create instances against those shapes — without engineering. Phase A
(shipped) demonstrates the pattern with text + long_text fields. The
"done" state for Phase 51: a tenant admin can model a real document
shape (10+ fields, mixed types, references, taxonomy) end-to-end via
the UI, instances persist server-side, and the operator can monitor
schema usage from the dashboard.

## Self-driven backlog (in priority order, ranked)

When the dispatched queue is empty AND no unread handoffs are open,
draw from these ranked items. Each item must still satisfy the
"Good-enhancement criteria" below before being claimed.

1. **Phase 51 Phase B**: more field types — `number`, `date`, `boolean`
   with appropriate widgets. Same auto-form pattern; same DDB shape.
   ~150 LOC.
2. **Phase 51 Phase A.5**: unify the type-creation surface. Today the
   existing localStorage-backed wizard and the new server-backed
   `/api/document-types` live in parallel. Wire the wizard's save path
   to dual-write (local + server) so creating a type is server-primary
   without breaking the 37 existing wizard tests. ~80 LOC.
3. **Phase 51 Phase C**: reference / taxonomy / enum fields — schema
   gains a "select from another typed document" or "select from a
   controlled vocabulary" affordance. ~200 LOC.
4. **Phase 51 Phase D**: validation rules (min/max, regex, conditional
   show-when). Schema gains optional `validation: { ... }` per field;
   form enforces client-side; route enforces server-side. ~150 LOC.
5. **Phase 51 Phase E**: display modes (full / teaser / list). Admin
   picks which fields show in each render context. ~150 LOC.
6. **Phase 51 Phase F**: bridge decision — do typed documents subsume
   the existing CRDT documents, or remain parallel? Operator-input
   needed; file as a planning task with options before code. ~planning
   only.
7. **Phase 51 Phase G**: bulk operations + JSON Schema export.
   Lower priority; defer until Phases B-E ship and the schema model
   has stabilized. ~250 LOC.
8. **Pipeline / Phase 50 leftovers** (carry-over):
   - `T2 IdempotentProducer` adoption — only if duplicate-trigger
     incidents are observed. Don't pre-adopt.
   - `T6 ConsumerGroup` adoption — only if multi-node trigger fires.
   - k8s preStop drain recipe + integration test — gated on having a
     Subscriber/worker-loop in place; today's in-process executor has
     nothing to drain.

The list IS NOT exhaustive. New items appear via handoff or via your
own grep through `.planning/` + recent production logs. Refile this
list when a top item ships.

## Good-enhancement criteria

A self-driven task is worth claiming if it satisfies AT LEAST ONE of:

- **Hardens a Phase 50 surface** (added in the last release — e.g.
  the DLQ router, the inspector router, the metrics wiring).
- **Removes a legacy workaround** that v0.11.0 (or later) made
  removable — cite the workaround AND the canonical replacement.
- **Adds an integration test** for a wire-up that has only unit-level
  coverage today.
- **Closes a `.planning/` follow-up** that's older than 2 weeks.
- **Improves operator visibility** of an existing surface (a metric,
  a log, a dashboard panel that's currently absent).

A self-driven task is **not** worth claiming if it:

- Builds for a multi-node future (path-(a) is the contract).
- Adds a new external API without an existing consumer.
- Refactors a green code path with no measured benefit.
- Spends more than ~200 LOC across the implementation. Larger than
  that → file a blocker for operator review of scope first.

## User-facing framing

This is an application, so "user" can mean three personas. Pick the
right one for each task and frame impact in their vocabulary:

- **End-user (the human using the product):** what they see, what
  works better, what stops breaking. "Users no longer lose their
  last 30 seconds of messages when their connection drops."
- **Tenant operator (admin running an org):** what they can configure,
  monitor, audit. "Tenant admins can now see which pipelines are
  stuck and re-run them without engineering involvement."
- **Platform operator (you, on-call):** what they can debug,
  intervene on, observe. "On-call can find a stuck pipeline run from
  the dashboard in under 30 seconds during an incident, instead of
  SSHing into the pod and grepping logs."

**Good user-impact statements:**
- "Operators can preview which DLQ entries a redrive will pull before
  triggering it — no more accidentally re-running 10k events that
  should stay dead."
- "When a pipeline run fails, the dashboard now shows a structured
  error category (NetworkError / TimeoutError / RegistryConflict)
  instead of a stringified exception, so on-call can decide
  retry-vs-investigate at a glance."
- "End-users no longer see a generic 'Disconnected' indicator when
  the API is degraded but the WebSocket is fine; the banner now
  distinguishes the two."

**Bad user-impact statements (REJECTED):**
- "Wires `getQueueMetrics` into bootstrap." (Names internal call.)
- "Adopts T13 InMemoryQueueInspector via boundary adapter." (Internal
  abstraction; nobody outside the codebase cares.)
- "Improves observability." (Vague; specify which signal a specific
  persona will see.)

**For internal refactors with no user-visible change:** say so —
"no user-visible change; removes legacy ResourceRegistry
downgrade-with-warning workaround that v0.10 made obsolete." Don't
fabricate impact.

## Affected consumers

This is a leaf application — the only direct consumer is the
end-user via the frontend. There is no other agent that pins to this
repo's source.

**Producers we depend on:**
- `distributed-core` — pinned to `v0.11.0` (commit `f0a5852`).
  Bump deliberately as part of an adoption task. When
  `distributed-core` ships a new release, expect a handoff with the
  primitive table; file an adoption task before consuming the new
  symbols.

## Daily cap

**Default: up to 30 self-driven tasks per UTC day per agent session.**
Tracked via the hub: count `task.done` activity rows where
`agent_name=self` AND `detail` contains `[self-driven]` over the last
24 hours.

**Operator override:** if `$AGENT_HUB_ROOT/.budget-websocket-gateway`
exists, read its integer as today's cap (overrides this default).
This is the operator's per-agent dial — read every `/clear` cycle so
changes take effect on the next task. The Anthropic weekly limit is
handled separately via `.cooldown_until` (see worker-template.md).

When the cap is reached:
1. `append_log("daily cap reached at <N>; idling until next UTC day")`.
2. Optionally file a "daily summary" handoff to operator.
3. `/clear` and stop.

## Constitution review cadence

After every **5 self-driven `task.done` events**, run a constitution
review:
1. Read this file.
2. Read the last 5 self-driven done summaries from the hub.
3. Decide: does the constitution still describe what's being built?
4. If YES → log it and continue.
5. If NO → propose an edit to this file via a handoff to operator.
   Do NOT silently commit constitution changes.

## Cross-repo contracts you depend on

- **Pin format**: `github:connorhoehn/distributed-core#vX.Y.Z` (semver
  tag). Don't pin to a SHA in production code.
- **Envelope shape**: T1 `Envelope<T>` from
  `distributed-core/src/messaging/envelope`. Boundary adapters in
  this repo translate between bus events and envelopes.
- **Metric prefix**: `dc_*` for distributed-core-emitted metrics,
  `gateway_*` and `pipeline_*` for app-emitted. Don't mix.
- **Fencing tokens** (consumer groups, when adopted): Raft
  term-derived per `distributed-core` T6b decision.

## Kill-switch

If `$AGENT_HUB_ROOT/.no_self_driven` exists, do NOT enter the
self-generation step. Only execute dispatched work. Idle when the
dispatched queue is empty.
