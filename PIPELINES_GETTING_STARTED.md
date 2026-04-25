# Pipelines — Getting Started

A developer-focused walkthrough of the Pipelines feature: boot the stack, build
a pipeline on the canvas, trigger a run, and poke at the observability views.

> This guide assumes you've never seen the code. It covers what you can do
> **today** (Phase 1). Pointers to the full design live in
> [`PIPELINES_PLAN.md`](./PIPELINES_PLAN.md).

---

## 1. Opening the UI (Phase 1)

Three processes; only the first two are required for Phase 1.

```bash
# 1. Frontend (Vite dev server on :5174)
cd frontend && npm run dev
```

```bash
# 2. Social API (Express + Redis, in another terminal)
cd social-api && npm start
```

```bash
# 3. (Optional, Phase 4+) WebSocket gateway
cd .. && npm start
```

Then:

1. Open the app in a browser — Vite prints the URL, typically
   <http://localhost:5174>.
2. Sign in via the Cognito hosted UI (use the dev user from
   `create-user.sh`, or your own).
3. In the top nav, click the **Pipelines** tab. You land on
   `/pipelines` with a list of your saved pipelines (empty on first run).

If the Pipelines tab is missing, confirm your build is up to date
(`npm run dev` restarts on file changes, but cold-cache browsers may need a
hard refresh).

---

## 2. Creating your first pipeline

From the pipelines list page:

1. Click **`+ New Pipeline`** in the top right.
2. Give it a name (e.g. `hello-llm`) and click **Create**.
3. The editor opens at `/pipelines/<id>` with a single **Trigger** node
   pre-placed on the canvas. Leave it where it is.
4. From the left-hand **Node Palette**, drag an **LLM** node onto the canvas.
5. Hover the Trigger node until its right-side `out` handle appears.
   Click-drag from `out` to the LLM node's `in` handle to connect them.
6. Click the LLM node. The right-hand **Config panel** opens.
7. Fill in the LLM config:
   - **Provider** (e.g. `anthropic`)
   - **Model** (e.g. `claude-opus-4-7`)
   - **System prompt** — e.g. `You are a helpful assistant.`
   - **User prompt template** — e.g. `Summarize: {{input.text}}`
8. Click **Save** — or wait ~1s for auto-save (debounced).
9. Click **Publish** in the top bar. Validation runs; if the chip goes green
   your pipeline is runnable.

Auto-save persists to `localStorage` under keys prefixed with
`ws_pipelines_v1`. Publishing just flips the status from `draft` to
`published` — it's local-only in Phase 1.

---

## 3. Running your first pipeline

1. With the pipeline **published**, click **`▶ Run`** in the top bar.
2. The Trigger node flashes, then the LLM node's border turns **blue**
   (running). In Phase 1 the MockExecutor streams synthetic tokens inline
   under the node title.
3. When the run finishes a toast pops ("Run complete"), and the LLM node
   settles to **green** (success). Failures show **red** with an error chip.
4. Click the LLM node → Config panel → **Runs** tab to see the step-level
   execution log (status, duration, tokens, inputs/outputs).

The **Run History** drawer (bottom of the editor) lists all recent runs for
the pipeline across every node.

---

## 4. Node types at a glance

| Node      | Purpose |
|-----------|---------|
| Trigger   | Entry point. Exactly one per pipeline. Fired by `▶ Run` (Phase 1) or external events (Phase 4+). |
| LLM       | Invokes a provider/model with a templated prompt. Outputs text + token usage. |
| Transform | Runs a pure JS/JSONata snippet on the payload. Useful for reshaping between nodes. |
| Condition | Routes to one of two downstream edges based on a boolean expression. |
| Action    | Side-effecting call — HTTP webhook, queue publish, etc. Phase 3 adds real adapters. |
| Fork      | Splits execution into N parallel branches. |
| Join      | Waits for all inbound branches of a matching Fork before continuing. |
| Approval  | Pauses the run until a human clicks Approve/Reject in the UI. |

For full schemas see `frontend/src/types/pipeline.ts` and the in-app
**docsContent** popovers on each node type.

---

## 5. Observability

Top nav → **Observability**. Four sub-tabs:

- **Dashboard** — cluster overview. Phase 1 renders a static fixture so you
  can see the layout; Phase 4 wires it to the gateway.
- **Nodes** — per-node detail, heartbeats, and **chaos controls** (kill,
  slow, partition). Fixture-backed in Phase 1.
- **Events** — live event stream with filters by type, severity, and node.
  Hooks into the MockExecutor event bus today.
- **Metrics** — placeholder charts (throughput, p50/p95 latency, error
  rate). Real Prometheus-backed data arrives in Phase 4.

---

## 6. Architecture in one diagram

```
 ┌──────────────┐        (Phase 4)        ┌──────────────────────────┐
 │   Frontend   │  ────── WebSocket ────▶ │  WebSocket Gateway (ws)  │
 │ React + RF   │  ◀─── events/patches ── │  Node.js — src/          │
 └──────┬───────┘                          └────────────┬─────────────┘
        │                                               │ bridge
        │ Phase 1: in-browser                           ▼
        │ MockExecutor                    ┌──────────────────────────┐
        │                                 │  distributed-core        │
        └────────────────────────────────▶│  PipelineModule (Phase 3)│
                                          │  + WAL, chaos, replay    │
                                          └────────────┬─────────────┘
                                                       │ out-of-process
                                                       ▼
                                          ┌──────────────────────────┐
                                          │  LLM providers / actions │
                                          └──────────────────────────┘
```

Deep dive: [`PIPELINES_PLAN.md` §1](./PIPELINES_PLAN.md) (architecture).

---

## 7. Development tips

### Where the contracts live

| Concern                  | File |
|--------------------------|------|
| Domain types             | `frontend/src/types/pipeline.ts` |
| Phase 1 executor         | `frontend/src/pipeline/MockExecutor.ts` |
| Validation rules         | `frontend/src/pipeline/validatePipeline.ts` |
| Persistence (localStorage)| `frontend/src/pipeline/pipelineStorage.ts` |
| Phase 3 module (stub)    | `distributed-core/src/applications/pipeline/PipelineModule.ts` |

### Tests

```bash
# From frontend/
npx vitest run pipelineExecutor.contract   # executor contract
npx vitest run validatePipeline            # validation rules
npx vitest run pipelineStorage             # persistence
npx vitest run pipelineFlow.integration    # end-to-end flow
npx vitest run pipelineExecutor.perf       # performance smoke
```

### Try the demo pipeline

On an empty `/pipelines` list, click **"try the demo pipeline"** in the empty
state. It spawns a pre-built showcase (Trigger → LLM → Transform → Action)
so you can skip straight to step 3.

### Resetting storage

Open DevTools → Application → Local Storage → your origin, and delete every
key matching `ws_pipelines_v1*`. That wipes all pipelines and runs.

```js
// Or from the console:
Object.keys(localStorage)
  .filter(k => k.startsWith('ws_pipelines_v1'))
  .forEach(k => localStorage.removeItem(k));
```

---

## 8. Phase roadmap

| Phase | Scope                                                           | Status |
|-------|------------------------------------------------------------------|--------|
| 1     | Canvas editor, Node palette, Config panel, MockExecutor, fixtures| Done   |
| 2     | Observability UI (Dashboard, Nodes, Events, Metrics) wired to fixtures | In progress |
| 3     | `distributed-core` `PipelineModule` — real executor, real adapters | Planned |
| 4     | Gateway bridge — frontend talks to the cluster over WebSocket   | Planned |
| 5     | WAL replay, chaos toolkit, failure drills                       | Planned |

Details and acceptance criteria: [`PIPELINES_PLAN.md` §10](./PIPELINES_PLAN.md).

---

## 9. Troubleshooting

**Run button disabled**
Pipeline must be **published** and pass validation. Hover / click the
validation chip in the top bar to expand the error list.

**"Trigger missing" error**
Every pipeline needs exactly one Trigger node. One is seeded at creation —
don't delete it. If you did, drag a new Trigger from the palette.

**LLM provider error / nothing happens on Run**
Phase 1 uses the MockExecutor — real provider calls are not wired yet. The
mock synthesizes token streams locally. Real LLM dispatch lands in Phase 3.

**Pipeline disappeared**
Pipelines are persisted in `localStorage` only (Phase 1). Clearing site
data, switching browsers, or opening an incognito window will hide them.
Use the **Export JSON** action in the editor's top-right menu before
clearing.

**Frontend can't reach social-api**
Check the Vite dev proxy in `frontend/vite.config.ts` and confirm
`social-api` is listening on its expected port. The frontend dev server
runs on **:5174** (see commit `c838be5`).

**Auth loop / Cognito redirect fails**
Confirm the Cognito callback URL in your user pool matches
`http://localhost:5174/auth/callback`. Update via the AWS console or
`cdk.json`.

---

## Where next

- Full design doc: [`PIPELINES_PLAN.md`](./PIPELINES_PLAN.md)
- Distributed core overview: [`DISTRIBUTED_ARCHITECTURE.md`](./DISTRIBUTED_ARCHITECTURE.md)
- Sibling IVS backend (video sessions): `~/Sandbox/videonowandlater`
