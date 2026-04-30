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
- **Don't build phase 51+ work before Phase 50 is hardened.** See
  current phase below.
- **Don't push half-done state to main.** Tests must be green
  (gateway + social-api + frontend) before push.

## Current phase

**Phase 50: Pipeline Error Visibility & Health.** Just shipped at
SHA `f569132`:
- Pin bump v0.10.0 → v0.11.0
- T12 consumer-lag metrics wired into both gateway + social-api
- T13 + T1 inspector boundary adapter (new `/api/pipelines/inspector`
  router)
- T9 + T1 DLQ boundary adapter (new `/api/pipelines/dlq` router with
  redrive)

Tests green: gateway 372 / social-api 204 / frontend 913.

Phase 50 is *shipped* but **not yet hardened**. Polish work is the
self-driven backlog below.

## Phase north-star

Phase 50 production-hardened: the operator can answer "what's stuck,
why, and what's the fastest fix?" using ONLY the new dashboards and
APIs, on real production traffic shapes. Phase 51 (next) gets scoped
into `.planning/` once Phase 50 stops surfacing surprises in
production.

## Self-driven backlog (in priority order, ranked)

When the dispatched queue is empty AND no unread handoffs are open,
draw from these ranked items. Each item must still satisfy the
"Good-enhancement criteria" below before being claimed.

1. **Phase 50 polish: redrive UX.** The new `/api/pipelines/dlq`
   redrive endpoint exists but lacks rate limiting and a "preview
   the redrive" mode. Add both — small, contained, observably useful.
2. **Phase 50 polish: inspector cardinality guard.** `/api/pipelines/inspector`
   can return unbounded lists. Add pagination + a 200-item cap.
3. **Phase 50 polish: structured error taxonomy on DLQ entries.**
   Right now failures are stringified; classify into known kinds
   (NetworkError, TimeoutError, RegistryConflict, etc.) so the
   operator can filter the dashboard.
4. **Adopt T2 IdempotentProducer** if (and only if) duplicate-trigger
   incidents have been observed. Don't pre-adopt.
5. **Drop the legacy ResourceRegistry raft downgrade-with-warning** in
   `social-api/src/pipeline/config/registries.ts`. v0.10.0 made this
   workaround removable. Replace `entityRegistryType: 'wal'` fallback
   with `entityRegistry: cluster.registry` directly.
6. **Drop MetricsExporter cast-through-any.** Replace with
   `formatPrometheus(registry.getSnapshot())` per the canonical
   pattern at distributed-core's `docs/observability/prometheus.md`.
7. **k8s preStop drain recipe** (T11 follow-up). Real recipe and
   integration test for SIGTERM → drain → exit. Pre-Phase-4
   readiness. Coordinate with distributed-core if their
   `docs/patterns/` recipe needs additions.
8. **Phase 51 scoping in `.planning/`.** When 1–7 are done, draft
   Phase 51 candidates from production observations. Don't pick
   the work yet — write the menu, file a handoff to operator.

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

**Up to 10 self-driven tasks per UTC day per agent session.** Tracked
via the hub: count `task.done` activity rows where `agent_name=self`
AND `detail` contains `[self-driven]` over the last 24 hours.

When the cap is reached:
1. `append_log("daily cap reached; idling until next UTC day")`.
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
