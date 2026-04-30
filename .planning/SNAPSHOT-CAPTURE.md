# Snapshot capture — operator runbook

A small Playwright-driven job that captures full-page screenshots of the
gateway's key UI surfaces and writes them under
`$AGENT_HUB_ROOT/snapshots/<slug>/<utc-iso-timestamp>.png` plus a
`snapshots/index.json` manifest.

Output lives **outside** this repo so screenshots don't bloat git
history.

## Quick start (healthy snapshots — recommended)

The healthy-snapshot path uses a local Dynamo + Redis stack so the
degraded banner is gone and seeded data populates the sidebars.

```bash
# 1. Bring up local Dynamo (port 8000) + Redis (port 6379).
scripts/snapshot-stack.sh up

# 2. Create the DDB tables social-api expects (idempotent).
node scripts/snapshot-bootstrap.mjs

# 3. Seed sample rows so the UI isn't empty (idempotent — re-running
#    overwrites in place, no duplicates).
node scripts/snapshot-seed.mjs

# 4. Stop any existing `npm run dev` you have running on :3001 — the
#    snapshot script will spawn its own social-api with the snapshot env
#    (REDIS_ENDPOINT=localhost) only when the port is free.

# 5. Capture.
node scripts/snapshot-capture.mjs

# 6. (Optional) Tear the stack down once you're done.
scripts/snapshot-stack.sh down
```

Expected runtime: **~30–45 s** for step 5 (server boot + 12 page
captures at ~2 s each + teardown).

## Quick start (degraded snapshots — fallback)

If you don't want to set up the local stack (e.g. you only need to
verify the page list works), you can skip steps 1–3. The capture
script reuses any social-api that's already running on :3001, even one
without `REDIS_ENDPOINT=localhost`. The screenshots will all show the
yellow "Backend services degraded" banner — which is a legitimate
record of "this is what the system looks like when its dependencies
are down."

```bash
node scripts/snapshot-capture.mjs
```

## Output

A successful run produces:
- `$AGENT_HUB_ROOT/snapshots/<slug>/<timestamp>.png` — one PNG per
  captured page.
- `$AGENT_HUB_ROOT/snapshots/index.json` — appended-to manifest with
  one entry per run: timestamp, gateway HEAD SHA, captured slugs,
  errored slugs (with reasons).

## Server lifecycle

The script auto-detects whether servers are already running:

- **social-api** on `:3001` — if up, reused; the script logs a warning
  if `/health` is degraded so you know snapshots will reflect that.
  If it's not running, the script spawns `npm run dev` in `social-api/`
  with `REDIS_ENDPOINT=localhost`.
- **frontend** on `:5174` — same logic against the Vite root, with
  `VITE_DEV_BYPASS_AUTH=true` injected so route gates land you
  straight on the page.

Whatever the script spawned, it cleanly tears down at the end.
Whatever was already running is left untouched.

The local Dynamo + Redis containers (started via `snapshot-stack.sh
up`) are NOT torn down by the capture script — they're orthogonal,
and operators may want them to outlive a single capture run. Run
`snapshot-stack.sh down` explicitly when you're done.

## Schema bootstrap + seed

Bootstrap (`scripts/snapshot-bootstrap.mjs`) creates the DDB tables
the captured UI surfaces touch:

- `social-profiles` — `/health` canary table.
- `social-rooms`, `social-room-members` (with GSI `userId-roomId-index`).
- `social-relationships`, `social-outbox`, `user-activity`.
- `document-types`, `typed-documents` (Phase 51 Phase A).

Seed (`scripts/snapshot-seed.mjs`) inserts deterministic sample rows:

- 1 dev profile.
- 3 rooms (general / engineering / design) with the dev user as owner.
- 2 document types ("Article", "Event") with a few fields each.
- 2 typed-document instances.
- 4 activity-log entries.

Both scripts are **idempotent** — re-running overwrites in place
rather than duplicating, so re-runs are safe.

## Environment variables

| Var               | Default                                                    | Purpose                                                  |
|-------------------|------------------------------------------------------------|----------------------------------------------------------|
| `AGENT_HUB_ROOT`  | `/Users/connorhoehn/Projects/hoehn-claude-orchestrator`    | Where `snapshots/` lives. Must exist before the run.     |
| `LOCALSTACK_ENDPOINT` | `http://localhost:8000`                                | DDB endpoint for bootstrap/seed.                         |
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

Defined in `scripts/snapshot-journeys.mjs` as inline JS objects:

| slug | what it exercises |
|------|-------------------|
| `create-document-type-basic` | Empty state → wizard → name + add a section field → save → populated list |
| `edit-document-type-name` | Pre-seed a type via localStorage → click Edit → rename → save |
| `delete-document-type-with-confirmation` | Pre-seed a type → click × → confirm modal → confirm delete |

The edit and delete journeys seed `localStorage` directly via
`page.evaluate()` rather than driving the wizard inline — that
isolates each journey's flow from cross-journey state and removes
race conditions on wizard mount/unmount.

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

### Known issue

The `create-document-type-basic` and `edit-document-type-name`
journeys can race on wizard mount-after-click in headless runs
depending on machine load. The runner records the failure text and
the screenshots up to the failing step so the operator can triage. A
follow-up task tracks tightening the selectors / replacing
inline-create with seeded localStorage where applicable.

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
