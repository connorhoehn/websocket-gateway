# Automated Test Strategy

All testing is headless — no browsers, no manual verification.
Scripts inject synthetic media and validate via mediasoup consumer score events.

## Test Harness Architecture

```
scripts/
  test-harness.js                # Base TestClient class
  test-dual-track.js             # Week 1: producer stores video AND audio
  test-room-isolation.js         # Week 1: rooms don't leak
  test-multi-worker.js           # Week 1: rooms distribute across workers
  test-gateway.js                # Week 1: signaling is single entry point
  test-stage-crud.js             # Week 2: stage create/read/update/delete
  test-participant-flow.js       # Week 2: publish + subscribe + capability enforcement
  test-chat.js                   # Week 2: room messaging + rate limiting
  test-api-suite.js              # Week 2: all REST endpoints
  test-broadcast.js              # Week 3: 1:N + simulcast layers
  test-fan-out.js                # Week 3: pipe transports under load
  test-scale-trigger.js          # Week 3: K8s HPA triggers new pod
  test-observability.js          # Week 3: health, metrics, dashboard
  test-recording.js              # Week 4: record + verify output
  test-reconnect.js              # Week 4: pod failure recovery
  test-load.js                   # Week 4: 300 viewer ramp
  test-full-suite.js             # Runs all tests in sequence
```

## Core Test Client

`scripts/test-harness.js` — headless mediasoup client using socket.io-client:

```js
class TestClient {
  constructor(serverUrl)
  async joinStage(stageId, token)        // Emits join-stage, gets RTP capabilities
  async publish(kind)                     // Creates producer transport, produces blank track
  async subscribe(producerId)             // Creates consumer transport, consumes
  async verifyMediaFlowing()              // Checks consumer.score events over 3s window
  async disconnect()                      // Cleanup
  getStats()                              // { producerStats, consumerStats, transportStates }
}
```

## Synthetic Media Approaches

### Option A: Server-side DirectTransport (preferred for unit tests)
No browser needed. MediaSoup's DirectTransport lets you inject RTP directly on the server.

```js
// Server endpoint: POST /api/test/inject-stream
// Creates DirectTransport + producer in a stage
// Sends blank VP8 frames on a timer
const directTransport = await router.createDirectTransport();
const producer = await directTransport.produce({ kind: 'video', rtpParameters: {...} });
producer.send(rtpPacket); // Buffer containing valid RTP
```

Gated by `NODE_ENV=development` / `testing.enabled=true` in Helm values.

### Option B: fake-mediastreamtrack (for client-side tests)
Uses the `fake-mediastreamtrack` npm package to create MediaStreamTrack objects in Node.js.

### Option C: mediasoup-client-aiortc (for full E2E)
Python/aiortc bridge that provides real WebRTC in headless mode. Heavier but most realistic.

## Test Output Format

Every script exits 0 (pass) or 1 (fail) and prints structured JSON:

```json
{
  "test": "fan-out-50-viewers",
  "passed": true,
  "durationMs": 12340,
  "metrics": {
    "avgJoinLatencyMs": 342,
    "medianFirstFrameMs": 890,
    "consumersCreated": 50,
    "framesVerified": true
  }
}
```

## Test Suite Groupings

### Foundation (Week 1)
| Test | What it proves |
|---|---|
| `test-dual-track` | Producer stores video AND audio (bug fix) |
| `test-room-isolation` | Room A can't see Room B producers |
| `test-multi-worker` | Rooms distribute across workers |
| `test-gateway` | Client only talks to signaling, never mediasoup directly |

### API Surface (Week 2)
| Test | What it proves |
|---|---|
| `test-stage-crud` | Full stage lifecycle CRUD |
| `test-participant-flow` | Publish/subscribe with capability enforcement |
| `test-chat` | Messaging, rate limiting, message length limits |
| `test-api-suite` | Every REST endpoint returns correct shapes |

### Scaling (Week 3)
| Test | What it proves |
|---|---|
| `test-broadcast` | 1:N with simulcast layer selection |
| `test-fan-out` | Pipe transports engage at capacity threshold |
| `test-scale-trigger` | K8s HPA creates new pod under load |
| `test-observability` | /health, /metrics, /dashboard return correct data |

### Resilience (Week 4)
| Test | What it proves |
|---|---|
| `test-recording` | PlainTransport + FFmpeg produces valid MP4 |
| `test-reconnect` | Pod death -> automatic subscriber recovery |
| `test-load` | 300 viewers, p95 join < 2s |

## Load Test Spec

`scripts/test-load.js`:
- Create 1 channel (broadcast mode)
- Ramp: 10 subscribers/second for 30 seconds (300 total)
- Measure per subscriber:
  - Transport creation latency
  - Time to first consumer.score event (= media flowing)
  - Sustained score over 10s window
- Output: `{ p50, p95, p99 latencies, totalConsumers, failures }`
- Target: p95 join < 2s, 0 failures at 300 viewers

## Running Tests

```bash
# Individual test
node scripts/test-dual-track.js

# Full suite
node scripts/test-full-suite.js

# Via Helm
helm test lvb

# Load test
node scripts/test-load.js --viewers=300 --ramp=10
```
