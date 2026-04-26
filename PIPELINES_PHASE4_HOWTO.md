# Pipelines — Phase-4-A Real-Bridge Mode (How-To)

A focused walkthrough for flipping a working dev environment from the
in-browser **MockExecutor** to the live **distributed-core `PipelineModule`**
wired into `social-api`.

> Companion to [`PIPELINES_GETTING_STARTED.md`](./PIPELINES_GETTING_STARTED.md)
> (Phase 1 path). Phase-4-A status and the full Phase-4-B checklist live in
> [`PIPELINES_PLAN.md` §10.6](./PIPELINES_PLAN.md).

---

## 1. What this enables

Phase-4-A swaps the in-browser `MockExecutor` for a real `PipelineModule`
booted in-process inside `social-api`. Real LLM tokens stream from
Anthropic (or Bedrock) through the bridge and land on the editor canvas.
Everything else — auth, persistence, observability fixtures — stays the same.

---

## 2. Prerequisites

- **Sibling repo** `distributed-core` at `~/Sandbox/distributed-core` (the
  path `social-api/package.json` resolves via `"distributed-core":
  "file:../../distributed-core"`). If you've never built it:

  ```bash
  cd ~/Sandbox/distributed-core
  git pull
  npm install
  npm run build
  ```

- **An LLM credential**, one of:
  - **Anthropic** API key — get one at <https://console.anthropic.com/>.
  - **Bedrock** — AWS credentials in your default chain with the
    `bedrock:InvokeModelWithResponseStream` permission, in `AWS_REGION`.

- **Redis** running locally on `localhost:6379` (or override
  `REDIS_ENDPOINT` / `REDIS_PORT` in `social-api/.env`).

---

## 3. Configuration

Both `.env` files are gitignored. Templates live next to them as
`.env.example` — copy, then fill in.

```bash
cp social-api/.env.example social-api/.env
cp frontend/.env.example   frontend/.env
```

### `social-api/.env`

```
PIPELINE_LLM_PROVIDER=anthropic        # or 'bedrock'
ANTHROPIC_API_KEY=sk-ant-...           # required when provider is anthropic
```

For Bedrock, drop `ANTHROPIC_API_KEY` and make sure `AWS_REGION` plus the
default credentials chain resolve to a profile with
`bedrock:InvokeModelWithResponseStream`.

### `frontend/.env`

```
VITE_PIPELINE_SOURCE=websocket
```

The default in `.env.example` is `mock` — Phase 1 behavior. Flip it to
`websocket` to subscribe to the real bridge.

---

## 4. Run the stack

From the repo root:

```bash
npm run dev
```

That fan-outs to `concurrently -n api,ui` (see the `dev` script in the root
`package.json`) — `social-api` on `:3001`, Vite on `:5174`.

Expected log lines on `social-api` startup (from a real boot):

```
social-api listening on port 3001
[pipeline:<uuid>] Registered resource type: pipeline-run
[pipeline:<uuid>] Pipeline EventBus started
[pipeline:<uuid>] PipelineModule initialized
[pipeline:<uuid>] PipelineModule started
[social-api] PipelineModule bootstrapped on node <uuid>
```

These confirm the bridge is wired. If they don't appear, bootstrap failed
and the routes fell back to `stubRunStore` mode — the startup error log
(`[social-api] PipelineModule bootstrap failed (continuing with stub
paths):`) will say why.

---

## 5. Verify it's live

```bash
curl http://localhost:3001/api/pipelines/health
```

Look for `"bridgeWired": true` in the response. (Surfaced by
`social-api/src/routes/pipelineHealth.ts`; if your branch predates that,
scan stdout for the bootstrap lines from §4 instead.)

In the frontend at <http://localhost:5174/pipelines>, open any pipeline
that has a real LLM node, click **▶ Run**. Real Claude tokens should
stream into the canvas, identical in shape to the Phase 1 mock stream.

---

## 6. Troubleshooting

**`PipelineModule bootstrap failed` in logs**
Confirm `ANTHROPIC_API_KEY` is set (and valid — paste it into the
Anthropic console to validate). Confirm Redis is reachable on the
configured `REDIS_ENDPOINT`/`REDIS_PORT`.

**Frontend still uses MockExecutor**
Confirm `VITE_PIPELINE_SOURCE=websocket` lives in `frontend/.env` (not
just `.env.example`). Vite only reads env on cold start — restart the dev
server.

**Cluster gossip warnings**
Harmless in single-node mode. If noisy, lower the log level inside
`social-api/src/pipeline/bootstrap.ts` (the inline `logger` object).

**`Cannot find module 'distributed-core'`**
Run `npm install` inside `social-api/` after pulling the sibling repo —
the `file:../../distributed-core` link needs a fresh install to wire up.

---

## 7. Reverting to mock

Set `VITE_PIPELINE_SOURCE=mock` in `frontend/.env` (or remove the line —
mock is the default), then restart Vite. `social-api` can keep running
with the bridge wired; the frontend just stops subscribing to it.

---

## 8. What's NOT yet wired (Phase-4-B)

Per [`PIPELINES_PLAN.md §10.6`](./PIPELINES_PLAN.md) Phase-4-A status table:

- **Smoke test with real credentials** — step 9 (`⏳ Phase-4-B`,
  per-developer; needs a real Anthropic key).
- **Toggle off the mock** — step 10 (`⏳ Phase-4-B`, follows step 9).
- **`pipeline.run.reassigned` event subscription** — step 6 partial
  (`✓ wrapper exists; reassigned event subscription deferred to
  Phase-4-B`).

Multi-node cluster (`nodeCount: 1` today), WAL durability
(`registry: { type: 'memory' }`, flips to `'wal'` in Phase-5), and the
gateway-process IPC path are tracked separately in §10.6 and §11.5 —
events emitted by `social-api`'s `PipelineModule` stay within the
`social-api` process today; the frontend reads run history via
`GET /api/pipelines/:pipelineId/runs/:runId/history?fromVersion=0`,
not WebSocket streaming.
