# Snapshot capture — operator runbook

A small Playwright-driven job that captures full-page screenshots of the
gateway's key UI surfaces and writes them under
`$AGENT_HUB_ROOT/snapshots/<slug>/<utc-iso-timestamp>.png` plus a
`snapshots/index.json` manifest.

Output lives **outside** this repo so screenshots don't bloat git
history.

## Quick start

```bash
# Run from the gateway repo root
node scripts/snapshot-capture.mjs
```

Expected runtime: **~30–45 s** total (server boot + 14 page captures
at ~2 s each + teardown).

A successful run produces:
- `$AGENT_HUB_ROOT/snapshots/<slug>/<timestamp>.png` — one PNG per
  captured page.
- `$AGENT_HUB_ROOT/snapshots/index.json` — appended-to manifest with
  one entry per run: timestamp, commit SHA, captured slugs, errored
  slugs (with reasons).

## Server lifecycle

The script auto-detects whether servers are already running:

- **social-api** on `:3001` — if up (any HTTP response on `/health`,
  including 503-degraded), it's reused. Otherwise the script spawns
  `npm run dev` in `social-api/`.
- **frontend** on `:5174` — same logic against the Vite root.

Whatever the script spawned, it cleanly tears down at the end.
Whatever was already running is left untouched. So `node
scripts/snapshot-capture.mjs` is safe to run while you're already
running `npm run dev` in another terminal.

## Environment variables

| Var               | Default                                                    | Purpose                                                  |
|-------------------|------------------------------------------------------------|----------------------------------------------------------|
| `AGENT_HUB_ROOT`  | `/Users/connorhoehn/Projects/hoehn-claude-orchestrator`    | Where `snapshots/` lives. Must exist before the run.     |

The frontend is launched with `VITE_DEV_BYPASS_AUTH=true` so route
gates that normally require a Cognito session land you straight on
the page. The social-api dev script already sets `SKIP_AUTH=true`.

## Pages captured (current set)

The list lives in `scripts/snapshot-capture.mjs` (`PAGES` array). At the
time of this writing:

- `/previews`, `/social`, `/dashboard`, `/documents`
- `/document-types`, `/field-types`
- `/pipelines`, `/pipelines/approvals`
- `/observability`, `/observability/{nodes,events,metrics}`
- API JSON renders proxied through Vite:
  `/api/pipelines/inspector/summary`, `/api/pipelines/dlq`

To add a page, edit the `PAGES` array. Slugs are stable (they become
the directory name); changing a slug means future runs land in a new
directory tree alongside the old one.

## Error handling

Any single page that fails (timeout, 5xx render error, navigation
abort) is logged to `index.json` under `errored: [...]` with the
failure reason. The run continues for the remaining pages — one bad
page does NOT abort the whole capture. Read the manifest after a run
to see if anything regressed.

## Reproducibility

Every run records the gateway repo's HEAD SHA in the manifest. Two
manifests with the same SHA but different timestamps mean the only
delta is wall-clock time + non-deterministic UI state (e.g. degraded
banners that depend on backend availability when the run fired).

## Local infra dependencies

Snapshots run cleanly even when:

- Dynamo / Redis / LocalStack aren't running. Social-api will report
  503-degraded on `/health`, the frontend's degraded banner will
  render, and the screenshots will visibly show that state — which
  is itself useful operator info.
- The WebSocket gateway isn't running. The frontend's
  `Disconnected` indicator will render in screenshots.

If you want screenshots that show the system "fully healthy", boot
LocalStack and the gateway WS server before running the capture.

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
existing snapshot history under the old slug).
