# Day 21: Health Monitoring & Observability

## Aggregated Health Endpoint

### GET /api/health (on signaling server)

```js
app.get('/api/health', async (req, res) => {
  // Check all mediasoup pods
  const podStatuses = await Promise.all(
    podRegistry.getAll().map(async (pod) => {
      try {
        const resp = await fetch(`${pod.url}/health`, { timeout: 3000 });
        const data = await resp.json();
        return { name: pod.podName, ...data, reachable: true };
      } catch (e) {
        return { name: pod.podName, status: 'unreachable', reachable: false };
      }
    })
  );

  const allHealthy = podStatuses.every(p => p.reachable && p.status !== 'degraded');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    services: {
      signaling: {
        status: 'healthy',
        connections: io.sockets.sockets.size
      },
      mediasoup: {
        pods: podStatuses
      }
    },
    stages: {
      active: stageManager.stages.size,
      totalParticipants: countAllParticipants()
    },
    channels: {
      live: countLiveChannels(),
      totalViewers: countAllViewers()
    },
    rooms: {
      active: roomManager.rooms.size
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});
```

## Dashboard Data Endpoint

### GET /api/dashboard (on signaling server)

```js
app.get('/api/dashboard', async (req, res) => {
  // Aggregate metrics from all mediasoup pods
  const podDetails = await Promise.all(
    podRegistry.getAll().map(async (pod) => {
      try {
        const [health, workers] = await Promise.all([
          fetch(`${pod.url}/health`).then(r => r.json()),
          fetch(`${pod.url}/api/workers`).then(r => r.json())
        ]);
        return { ...pod, health, workers: workers.workers };
      } catch (e) {
        return { ...pod, health: { status: 'unreachable' }, workers: [] };
      }
    })
  );

  res.json({
    overview: {
      stages: stageManager.stages.size,
      channels: channelManager.channels.size,
      rooms: roomManager.rooms.size,
      totalConnections: io.sockets.sockets.size,
    },
    stages: Array.from(stageManager.stages.values()).map(s => ({
      stageId: s.stageId,
      name: s.name,
      state: s.state,
      participants: s.participants.size,
      publishers: countByCapability(s.participants, 'PUBLISH'),
      pod: s.mediasoupPod.podName
    })),
    channels: Array.from(channelManager.channels.values()).map(c => ({
      channelId: c.channelId,
      name: c.name,
      state: c.state,
      viewers: c.viewers.size,
      pod: c.mediasoupPod.podName
    })),
    pods: podDetails.map(p => ({
      name: p.podName,
      ip: p.podIp,
      status: p.health.status,
      workers: (p.workers || []).map(w => ({
        pid: w.pid,
        rooms: w.rooms,
        consumers: w.consumers,
        resourceUsage: w.resourceUsage
      }))
    })),
    timestamp: new Date().toISOString()
  });
});
```

## Signaling Server Metrics

Add prom-client to signaling server too:

```js
const signalingMetrics = {
  activeConnections: new promClient.Gauge({
    name: 'signaling_active_connections',
    help: 'Current WebSocket connections',
    registers: [register]
  }),
  stagesActive: new promClient.Gauge({
    name: 'signaling_stages_active',
    help: 'Active stages',
    registers: [register]
  }),
  channelsLive: new promClient.Gauge({
    name: 'signaling_channels_live',
    help: 'Live broadcast channels',
    registers: [register]
  }),
  roomsActive: new promClient.Gauge({
    name: 'signaling_rooms_active',
    help: 'Active chat rooms',
    registers: [register]
  }),
  apiLatency: new promClient.Histogram({
    name: 'signaling_api_latency_seconds',
    help: 'REST API response time',
    labelNames: ['method', 'path'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register]
  }),
};
```

## Trace IDs

Every client connection gets a trace ID, propagated through all operations:

```js
io.on('connection', (socket) => {
  socket.traceId = `trace_${nanoid(16)}`;

  // Propagate to all mediasoup HTTP calls
  const originalEmit = socket.emit;
  // Log with traceId in every handler
});

// In mediasoup HTTP calls from signaling:
headers: {
  'Content-Type': 'application/json',
  'X-Trace-Id': socket.traceId
}

// In mediasoup server, log with received trace ID:
app.use((req, res, next) => {
  req.traceId = req.headers['x-trace-id'] || `internal_${nanoid(8)}`;
  next();
});
```

## Verification Script: `scripts/test-observability.js`

```
1. Create stage, publish synthetic stream, add 3 subscribers

2. GET /api/health
   Assert: status='healthy'
   Assert: signaling.connections >= 4
   Assert: mediasoup.pods[0].status='healthy'
   Assert: stages.active=1, stages.totalParticipants=4

3. GET /api/dashboard
   Assert: stages array has 1 entry with correct participant count
   Assert: pods array has worker details with consumer counts

4. GET /metrics (on signaling)
   Assert: signaling_stages_active = 1
   Assert: signaling_active_connections >= 4

5. GET /metrics (on mediasoup)
   Assert: mediasoup_consumers_total >= 3
   Assert: mediasoup_producers_total >= 2
   Assert: mediasoup_rooms_active >= 1

6. Exit 0
```

## Files Changed
- `src/signaling-server.js` — health, dashboard, signaling metrics, trace IDs
- `src/mediasoup-server.js` — trace ID middleware
- `scripts/test-observability.js` — new file
