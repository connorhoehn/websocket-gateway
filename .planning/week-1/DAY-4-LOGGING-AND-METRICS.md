# Day 4: Structured Logging + Prometheus Metrics

## Structured Logging

Replace all emoji `console.log` calls with `pino` structured JSON logging.

### Setup

```js
const pino = require('pino');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  // Pretty print in dev, JSON in production
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});
```

### Replacement Pattern

```js
// BEFORE:
log('🚀 [SFU-INIT]', 'MediasoupServer constructor started');
log('🔌 [SFU-CONNECTION]', `New client connected: ${socket.id}`);
log('❌ [SFU-ERROR]', `Error creating WebRTC transport for ${socket.id}:`, error.message);

// AFTER:
logger.info({ component: 'sfu' }, 'MediasoupServer starting');
logger.info({ component: 'sfu', socketId: socket.id }, 'Client connected');
logger.error({ component: 'sfu', socketId: socket.id, err: error }, 'Transport creation failed');
```

### Log Levels

| Level | Usage |
|---|---|
| `error` | Unrecoverable failures, worker death, unhandled errors |
| `warn` | Recoverable issues, stale transport cleanup, rate limiting |
| `info` | Lifecycle events: client connect/disconnect, room create/destroy, produce/consume |
| `debug` | Transport state changes, ICE/DTLS events, score updates |
| `trace` | RTP stats, per-frame details (only in development) |

### Files to Update

- `src/mediasoup-server.js` — ~50 console.log calls to replace
- `src/signaling-server.js` — ~30 console.log calls to replace
- `src/turn-server.js` — ~20 console.log calls (may be deleted Day 7)

---

## Prometheus Metrics

### Setup

```js
const promClient = require('prom-client');
const register = new promClient.Registry();

// Default Node.js metrics (event loop lag, heap, GC, etc.)
promClient.collectDefaultMetrics({ register });
```

### Custom Metrics

```js
const metrics = {
  // Gauges (current values)
  workersActive: new promClient.Gauge({
    name: 'mediasoup_workers_active',
    help: 'Number of active mediasoup workers',
    registers: [register]
  }),
  roomsActive: new promClient.Gauge({
    name: 'mediasoup_rooms_active',
    help: 'Number of active rooms',
    registers: [register]
  }),
  producersTotal: new promClient.Gauge({
    name: 'mediasoup_producers_total',
    help: 'Total active producers',
    registers: [register]
  }),
  consumersTotal: new promClient.Gauge({
    name: 'mediasoup_consumers_total',
    help: 'Total active consumers',
    registers: [register]
  }),
  transportsActive: new promClient.Gauge({
    name: 'mediasoup_transports_active',
    help: 'Total active transports',
    registers: [register]
  }),
  pipeTransportsActive: new promClient.Gauge({
    name: 'mediasoup_pipe_transports_active',
    help: 'Active pipe transports (cross-worker/pod)',
    registers: [register]
  }),

  // Per-worker gauges
  workerConsumers: new promClient.Gauge({
    name: 'mediasoup_worker_consumers',
    help: 'Consumers per worker',
    labelNames: ['worker_pid'],
    registers: [register]
  }),
  workerRooms: new promClient.Gauge({
    name: 'mediasoup_worker_rooms',
    help: 'Rooms per worker',
    labelNames: ['worker_pid'],
    registers: [register]
  }),

  // Histograms (latency tracking)
  joinLatency: new promClient.Histogram({
    name: 'mediasoup_join_latency_seconds',
    help: 'Time from join-room request to callback',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [register]
  }),
  transportCreateLatency: new promClient.Histogram({
    name: 'mediasoup_transport_create_latency_seconds',
    help: 'Time to create a WebRTC transport',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register]
  }),

  // Counters (cumulative)
  connectionsTotal: new promClient.Counter({
    name: 'mediasoup_connections_total',
    help: 'Total socket connections since startup',
    registers: [register]
  }),
  errorsTotal: new promClient.Counter({
    name: 'mediasoup_errors_total',
    help: 'Total errors since startup',
    labelNames: ['type'],
    registers: [register]
  }),
};
```

### Metrics Endpoint

```js
this.app.get('/metrics', async (req, res) => {
  // Update gauge values before serving
  metrics.workersActive.set(this.workers.length);
  metrics.roomsActive.set(this.rooms.size);
  metrics.producersTotal.set(countTotalProducers());
  metrics.consumersTotal.set(countTotalConsumers());
  metrics.transportsActive.set(this.transports.size * 2); // producer + consumer

  for (const entry of this.workers) {
    metrics.workerConsumers.labels(String(entry.pid)).set(entry.consumerCount);
    metrics.workerRooms.labels(String(entry.pid)).set(entry.roomCount);
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Instrumenting Key Operations

```js
// join-room: measure latency
socket.on('join-room', async (data, callback) => {
  const timer = metrics.joinLatency.startTimer();
  try {
    // ... existing logic ...
    timer(); // records duration
  } catch (err) {
    metrics.errorsTotal.inc({ type: 'join' });
    throw err;
  }
});

// create-webrtc-transport: measure latency
socket.on('create-webrtc-transport', async (data, callback) => {
  const timer = metrics.transportCreateLatency.startTimer();
  // ... create transport ...
  timer();
});

// connection: count
this.io.on('connection', (socket) => {
  metrics.connectionsTotal.inc();
  // ...
});

// consumer count tracking
socket.on('consume', async (data, callback) => {
  // ... create consumer ...
  const roomId = this.socketToRoom.get(socket.id);
  const room = this.rooms.get(roomId);
  if (room) room.workerEntry.consumerCount++;
});
```

### Update Health Endpoint

```js
this.app.get('/health', (req, res) => {
  const workersAlive = this.workers.filter(w => !w.worker.closed).length;
  const healthy = workersAlive > 0;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    workers: { alive: workersAlive, total: this.workers.length },
    rooms: this.rooms.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

### New Dependencies

Add to `src/package.json`:
```json
{
  "pino": "^8.17.0",
  "pino-pretty": "^10.3.0",
  "prom-client": "^15.1.0"
}
```

## Verification

```bash
# Start server, create room, publish
curl -s localhost:3001/metrics | grep mediasoup_
# Should see:
#   mediasoup_workers_active 4
#   mediasoup_rooms_active 1
#   mediasoup_producers_total 2
#   mediasoup_consumers_total 0
#   mediasoup_join_latency_seconds_bucket{le="0.1"} 1
```

## Files Changed
- `src/mediasoup-server.js` — logging overhaul + metrics integration
- `src/package.json` — add pino, pino-pretty, prom-client
