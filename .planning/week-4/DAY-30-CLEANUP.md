# Day 30: Cleanup & Tag v1.0.0

## Code Cleanup

### Remove debug logging from client JS
- Strip all `console.log('element found:', ...)` from `src/static/mediasoup-client.js`
- Remove canvas test code, forced play button debug code
- Remove `window.debugVideoState`, `window.forceShowPlayButtons`, `window.playAllVideos`
- Remove `window.checkTransports` debug globals
- These are replaced by the SDK's configurable `logLevel`

### Remove unused files
- `src/turn-server.js` — absorbed into signaling-server.js (Day 7)
- `src/static/app.js` — replaced by SDK
- `src/static/test.html` — replaced by automated tests
- `src/static/index.html` — replaced by demo-stage.html
- `docker/signaling-package.json` — if no longer needed
- `architecture-analysis.yaml` — empty, never used

### Clean up old P2P-specific code
- `src/static/p2p.html` / `src/static/p2p-client.js` — keep if P2P mode is still wanted, otherwise remove

### Ensure test-only routes are gated

```js
if (process.env.NODE_ENV === 'development' || process.env.TESTING_ENABLED === 'true') {
  app.post('/api/test/inject-stream', ...);
}
```

## OpenAPI Spec

Write `docs/openapi.yaml` covering all REST endpoints:
- `/api/stages` (CRUD)
- `/api/stages/:stageId/participants` (CRUD)
- `/api/rooms` (CRUD)
- `/api/rooms/:roomId/tokens`
- `/api/channels` (CRUD)
- `/api/channels/:channelId/viewers`
- `/api/stages/:stageId/recording/start|stop`
- `/api/recordings`
- `/api/health`
- `/api/dashboard`
- `/metrics`

## README Update

Quick-start section:

```markdown
## Quick Start (Docker Compose)

docker compose --profile sfu up -d
open http://localhost:3000

## Quick Start (Kubernetes)

# Build images
docker build -f docker/Dockerfile.signaling -t lvb/signaling:latest .
docker build -f docker/Dockerfile.mediasoup -t lvb/mediasoup:latest .

# Install
helm install lvb ./helm/live-video-broadcaster

# Test
helm test lvb

# Access
kubectl port-forward svc/lvb-signaling 3000:3000
open http://localhost:3000

## Run Tests

node scripts/test-full-suite.js

## Load Test

node scripts/test-load.js --viewers=100 --ramp=10
```

## Tag v1.0.0

```bash
git add -A
git commit -m "v1.0.0: Local IVS replacement with stages, rooms, fan-out, recording"
git tag v1.0.0
```

## Final Checklist

- [ ] All 15 test scripts pass (`node scripts/test-full-suite.js`)
- [ ] `helm install` + `helm test` pass
- [ ] Load test: 100 viewers, p95 join < 2s
- [ ] `/api/health` returns healthy
- [ ] `/metrics` returns valid Prometheus format
- [ ] OpenAPI spec matches actual endpoints
- [ ] No emoji in server logs (all structured JSON via pino)
- [ ] No `console.log` in server code
- [ ] No debug globals in client code
- [ ] README has quick-start for both Docker Compose and K8s
