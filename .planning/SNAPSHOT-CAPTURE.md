# Snapshot capture — operator runbook

A small Playwright-driven job that captures full-page screenshots of the
gateway's key UI surfaces and writes them under
`$AGENT_HUB_ROOT/snapshots/<slug>/<utc-iso-timestamp>.png` plus a
`snapshots/index.json` manifest.

Output lives **outside** this repo so screenshots don't bloat git
history.

## Modes

The Tiltfile auto-detects which of two modes to run in:

- **standalone** (default) — Tilt deploys redis + dynamodb-local pods
  alongside the gateway. Self-contained.
- **shared** — Tilt picks this up automatically when
  `$AGENT_HUB_ROOT/.shared-services.json` exists. Skips deploying the
  redis + dynamodb pods (the chart renders ExternalName aliases
  pointing at the host) and consumes the host-side shared stack.
  Multiple project agents can share one DDB-local + Redis-local
  without port collisions.

## Quick start

```bash
# 0. (shared mode only — skip if you don't have an agent-hub orchestrator)
#    Bring up the shared local-services stack ONCE for all projects.
$AGENT_HUB_ROOT/scripts/start-shared-services.sh

# 1. Bring up gateway. Tilt picks up shared mode automatically when
#    $AGENT_HUB_ROOT/.shared-services.json exists; otherwise standalone.
tilt up

# 2. Once Tilt reports "All resources ready", seed deterministic
#    sample rows so the UI isn't empty:
node scripts/snapshot-seed.mjs

# 3. Capture page snapshots + run journeys.
node scripts/snapshot-capture.mjs

# 4. Tear the stack down when you're done.
tilt down
# (Shared services persist across `tilt down`. Stop them separately
#  with $AGENT_HUB_ROOT/scripts/stop-shared-services.sh.)
```

Expected runtime for step 3: **~30–45 s** (12 page captures + 4
journeys).

If you started the stack a different way (e.g. `cd social-api && npm
run dev`), the snapshot script still runs as long as :3001 and :5174
are reachable — it doesn't care who started them, but it does abort
with a clear message if they're missing.

## Output

A successful run produces:
- `$AGENT_HUB_ROOT/snapshots/<slug>/<timestamp>.png` — one PNG per
  captured page.
- `$AGENT_HUB_ROOT/snapshots/index.json` — appended-to manifest with
  one entry per run: timestamp, gateway HEAD SHA, captured slugs,
  errored slugs (with reasons).

## Server lifecycle

The capture script does **not** spawn its own services. It expects:
- **social-api** reachable at `http://localhost:3001/health`. Status
  503 (degraded) is logged but doesn't abort — the operator has
  visibility into the degraded reason via Tilt's UI.
- **frontend** reachable at `http://localhost:5174`. Vite proxies
  `/api/*` to social-api on `:3001`.

If either is unreachable, the script aborts with a clear "run tilt
up first" message. The decision to spawn or reuse services is
deliberately delegated to Tilt — no parallel docker-compose path.

## Schema bootstrap + seed

Tilt's `dynamodb-setup` `local_resource` creates all DDB tables on
first up (idempotent — re-running Tilt is safe), including the
Phase 51 Phase A tables (`document-types`, `typed-documents`).

Seed (`scripts/snapshot-seed.mjs`) inserts deterministic sample rows
on top of the Tilt-created tables:

- 1 dev profile.
- 3 rooms (general / engineering / design) with the dev user as owner.
- 2 document types ("Article", "Event") with a few fields each.
- 2 typed-document instances.
- 4 activity-log entries.

Re-running the seed overwrites in place; same IDs each time, so
visual diffs across snapshot runs reflect real UI changes, not seed
churn.

## Environment variables

| Var               | Default                                                    | Purpose                                                  |
|-------------------|------------------------------------------------------------|----------------------------------------------------------|
| `AGENT_HUB_ROOT`  | `/Users/connorhoehn/Projects/hoehn-claude-orchestrator`    | Where `snapshots/` lives. Must exist before the run.     |
| `LOCALSTACK_ENDPOINT` | `http://localhost:8000`                                | DDB endpoint for the seed script.                        |
| `AWS_REGION`      | `us-east-1`                                                | DDB region.                                              |

## Pages captured (current set, 12 total)

Per orchestrator handoff #34, the page list is **user-facing UI
surfaces only**. No `/api/*` routes — Chromium rendering of raw JSON
is useless for a visual evolution archive.

Current slugs (in `scripts/snapshot-capture.mjs`'s `PAGES` array):

- `/previews`, `/social`, `/dashboard`, `/documents`
- `/document-types`, `/field-types`
- `/pipelines`, `/pipelines/approvals`
- `/observability`, `/observability/{nodes,events,metrics}`

If a future UI page surfaces DLQ entries or pipeline-inspector data,
it goes here under a slug like `pipelines-dlq` (no `api-` prefix).

## Retired slugs (deprecated)

These slugs were captured by an earlier version of the script and have
been retired:

- `api-pipelines-inspector` (was JSON of `GET /api/pipelines/inspector/summary`)
- `api-pipelines-dlq` (was JSON of `GET /api/pipelines/dlq`)

The capture script logs a one-line hint per existing deprecated
directory at startup. To clear them out:

```bash
rm -rf "$AGENT_HUB_ROOT/snapshots/api-pipelines-inspector"
rm -rf "$AGENT_HUB_ROOT/snapshots/api-pipelines-dlq"
```

(The script can't delete those directories itself — worker policy
forbids destructive operations outside this repo.)

## Error handling

Any single page that fails (timeout, 5xx render error, navigation
abort) is logged to `index.json` under `errored: [...]` with the
failure reason. The run continues for the remaining pages — one bad
page does NOT abort the whole capture. Read the manifest after a run
to see if anything regressed.

## Reproducibility

Every run records the gateway repo's HEAD SHA in the manifest. Two
manifests with the same SHA but different timestamps mean the only
delta is wall-clock time + non-deterministic UI state. Seed data is
deterministic across runs, so visual diffs reflect real UI changes.

## Adding more pages

```js
// In scripts/snapshot-capture.mjs:
const PAGES = [
  // ...existing entries...
  { slug: 'my-new-page', url: '/some/route' },
];
```

Slug rules: lowercase, hyphenated, deterministic. Don't rename
existing slugs without an operator decision (renaming orphans the
existing snapshot history under the old slug). Don't add `/api/*`
URLs — capture user-facing UI only, per handoff #34.

## UI journeys (hub#54)

Beyond per-page snapshots, the capture run ALSO executes named UI
journeys — multi-step Playwright flows that exercise real
configuration paths and capture a screenshot at every step. Operator
can step through the carousel ("click create → fill form → save →
populated") to verify the feature actually works end-to-end, not just
that the page renders.

Output:

```
$AGENT_HUB_ROOT/journeys/<journey-slug>/<run-ts>/<NN>-<step-name>.png
$AGENT_HUB_ROOT/journeys/index.json
```

The manifest records every run (passed or failed) with started_at,
ended_at, commit_sha, status, failure-text-on-error, and the per-step
list. Failed journeys still produce screenshots up to the failing
step for triage.

### Current journeys

Defined in `scripts/snapshot-journeys.mjs` as inline JS objects.
Document-side journeys exercise the document-types wizard surface
end-to-end; pipeline-side journeys exercise the pipelines list,
editor, and runs pages.

**Document journeys**

| slug | what it exercises |
|------|-------------------|
| `create-document-type-basic` | Empty state → wizard → name + add a section field → save → populated list |
| `edit-document-type-name` | Pre-seed a type via localStorage → click Edit → rename → save |
| `comprehensive-design-doc` | 28-step lifecycle: admin schema → end-user fill (gap-tracked) → reader → 2-user CRDT collab |
| `multi-field-document-type` | Build a Project Brief schema with up to 4 different field kinds in sequence |
| `edit-document-type-toggle-field-flags` | Pre-seed a 2-field type → toggle required + collapsed flags → save |
| `multi-page-wizard-add-page-and-reorder` | Pre-seed a 1-page type → +Page → rename via TOC → save |
| `delete-document-type-with-confirmation` | Pre-seed a type → click × → confirm modal → confirm delete |

**Pipeline journeys**

| slug | what it exercises |
|------|-------------------|
| `pipelines-list-create-from-blank` | Visit /pipelines → open the new-pipeline modal → name → confirm → land in editor |
| `pipeline-runs-page-search-and-range` | Visit a pipeline-id/runs page → type search query → click 7d / 24h / all range pills |

The edit and delete journeys (and the multi-page + flags variants)
seed `localStorage` directly via `page.evaluate()` rather than driving
the wizard inline — that isolates each journey's flow from cross-
journey state and removes race conditions on wizard mount/unmount.

The pipeline journeys are best-effort: the new-pipeline launcher
button has no canonical testid (matched by visible text), and the
runs page renders an empty state for the seeded pipeline-id (which is
fine — the search + range filter still update URL state, which is
what the journey verifies via screenshot).

### Running journeys standalone

```bash
# Frontend must be running on :5174 (e.g. `cd frontend && npm run dev`).
node scripts/snapshot-journeys.mjs
```

The capture script (`snapshot-capture.mjs`) invokes this runner
automatically after page captures complete, in the same lifecycle so
servers don't need to be restarted.

### Adding a new journey

Add an entry to the `JOURNEYS` array in `scripts/snapshot-journeys.mjs`:

```js
{
  slug: 'my-new-journey',
  title: 'Operator-readable title',
  description: 'One-line description for the dashboard.',
  async run(page, step) {
    await step('step-name', 'Step description', async () => {
      // Playwright actions here. Screenshot is taken automatically at
      // the end of the step.
    });
    // ...more steps...
  },
}
```

Slug rules: kebab-case, deterministic. Don't rename existing slugs
(orphans the historical run directory). Step names are also
kebab-cased for filesystem safety.

## What's deliberately out of scope

- Scheduled re-runs (cron). v1 is manual; the orchestrator has the
  cron primitives if a recurring job is wanted later.
- Diff highlighting between consecutive runs. The PNGs sit in stable
  paths so any standard image-diff tool can be pointed at them.
- Dashboard/timeline viewer for the snapshots. Operator's job to add
  a `/snapshots` screen once enough runs have accumulated to make it
  worth wiring.
- Capturing video / interaction recordings.
- Snapshotting external dependencies (e.g. social-api's swagger UI).
  This script is gateway-owned pages only.
