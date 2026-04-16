# Days 15-16: Pipe Transports for Cross-Worker/Pod Fan-out

The key scaling mechanism. Without this, you're capped at ~500 consumers per worker.

## Concept

mediasoup's `router.pipeToRouter()` forwards a producer from Router A to Router B.
The piped producer appears as a local producer on Router B — consumers attach normally.

```
Publisher -> Router1/Worker1 (primary)
               |
               |-- pipeToRouter --> Router2/Worker2  (overflow, consumers 501-1000)
               |-- pipeToRouter --> Router3/Worker3  (overflow, consumers 1001-1500)
               |
               |-- cross-pod pipe --> Router4/Pod B  (when single pod is full)
```

## Same-Host Pipe (Cross-Worker)

Used when a stage's consumers exceed one worker's capacity.

### Implementation

```js
class StageScaler {
  constructor(mediasoupServer) {
    this.server = mediasoupServer;
    this.overflowRouters = new Map(); // stageId -> [{ router, workerEntry, pipeProducers }]
    this.pipeTransports = new Map();  // `${sourceRouterId}-${targetRouterId}` -> { pipeConsumer, pipeProducer }
  }

  shouldExpand(stageId) {
    const room = this.server.rooms.get(stageId);
    if (!room) return false;
    return room.workerEntry.consumerCount >= (parseInt(process.env.PIPE_THRESHOLD) || 400);
  }

  async expandStage(stageId) {
    const room = this.server.rooms.get(stageId);
    const sourceRouter = room.router;

    // Find least-loaded worker that ISN'T the current one
    const targetWorker = this.server.workers
      .filter(w => w !== room.workerEntry)
      .sort((a, b) => a.consumerCount - b.consumerCount)[0];

    if (!targetWorker) {
      logger.warn({ stageId }, 'No available worker for expansion');
      return null;
    }

    // Create new router on target worker
    const targetRouter = await targetWorker.worker.createRouter({
      mediaCodecs: this.server.mediaCodecs
    });

    // Pipe all existing producers from source to target
    const pipeProducers = new Map();
    const allProducers = this.server.getProducersForRoom(stageId);

    for (const { producerId, kind, socketId } of allProducers) {
      const { pipeConsumer, pipeProducer } = await sourceRouter.pipeToRouter({
        producerId,
        router: targetRouter,
        listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
        // enableSrtp: false for same-host
        // enableRtx: false for lower overhead
      });

      pipeProducers.set(producerId, { pipeConsumer, pipeProducer, kind, socketId });

      logger.info({ stageId, producerId, targetWorkerPid: targetWorker.pid },
        'Piped producer to overflow router');
    }

    // Store overflow router
    if (!this.overflowRouters.has(stageId)) {
      this.overflowRouters.set(stageId, []);
    }
    this.overflowRouters.get(stageId).push({
      router: targetRouter,
      workerEntry: targetWorker,
      pipeProducers,
    });

    return { router: targetRouter, workerEntry: targetWorker };
  }

  // Get the best router for a new consumer in a stage
  getRouterForConsumer(stageId) {
    const room = this.server.rooms.get(stageId);

    // If primary worker is under threshold, use it
    if (room.workerEntry.consumerCount < (parseInt(process.env.PIPE_THRESHOLD) || 400)) {
      return { router: room.router, workerEntry: room.workerEntry };
    }

    // Check overflow routers
    const overflows = this.overflowRouters.get(stageId) || [];
    for (const overflow of overflows) {
      if (overflow.workerEntry.consumerCount < (parseInt(process.env.PIPE_THRESHOLD) || 400)) {
        return overflow;
      }
    }

    // All full — expand
    return null; // Caller should call expandStage()
  }

  // When a new producer joins an already-expanded stage, pipe it to all overflow routers
  async pipeNewProducer(stageId, producerId) {
    const room = this.server.rooms.get(stageId);
    const overflows = this.overflowRouters.get(stageId) || [];

    for (const overflow of overflows) {
      const { pipeConsumer, pipeProducer } = await room.router.pipeToRouter({
        producerId,
        router: overflow.router,
        listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
      });
      overflow.pipeProducers.set(producerId, { pipeConsumer, pipeProducer });
    }
  }

  // Tear down overflow when consumers drop
  async shrinkStage(stageId) {
    const overflows = this.overflowRouters.get(stageId) || [];

    // Remove empty overflow routers (no consumers left)
    const active = [];
    for (const overflow of overflows) {
      if (overflow.workerEntry.consumerCount === 0) {
        overflow.router.close();
        logger.info({ stageId, workerPid: overflow.workerEntry.pid }, 'Closed empty overflow router');
      } else {
        active.push(overflow);
      }
    }

    if (active.length === 0) {
      this.overflowRouters.delete(stageId);
    } else {
      this.overflowRouters.set(stageId, active);
    }
  }
}
```

### Integration with Consumer Creation

In the signaling gateway, when a subscriber requests to consume:

```js
socket.on('consume', async (data, callback) => {
  const stage = stageManager.stages.get(socket.stageId);

  // Ask scaler for best router
  let routerInfo = stageScaler.getRouterForConsumer(socket.stageId);

  if (!routerInfo) {
    // Need to expand — create overflow router with pipe transports
    routerInfo = await stageScaler.expandStage(socket.stageId);
    if (!routerInfo) {
      return callback({ error: 'No capacity available' });
    }
  }

  // Create consumer transport on the selected router's worker
  // (The consumer transport must be on the same router as the piped producer)
  const transport = await routerInfo.router.createWebRtcTransport({
    webRtcServer: routerInfo.workerEntry.webRtcServer,
  });

  // ... standard consume flow, but using routerInfo.router instead of primary
});
```

## Cross-Pod Pipe Transport

Used when a single K8s pod is fully loaded (all workers at capacity).

### Signaling Server Orchestrates

```js
// POST /internal/pipe/initiate
// Called by signaling server when it detects a pod is full

async initiateCrossPodPipe(stageId, sourcePodUrl, targetPodUrl) {
  // 1. Create pipe transport on source pod
  const sourceResp = await fetch(`${sourcePodUrl}/internal/rooms/${stageId}/pipe-transport/create`, {
    method: 'POST',
    body: JSON.stringify({ enableSrtp: true })
  });
  const sourceTransport = await sourceResp.json();
  // Returns: { transportId, ip, port, srtpParameters }

  // 2. Create pipe transport on target pod
  const targetResp = await fetch(`${targetPodUrl}/internal/rooms/${stageId}/pipe-transport/create`, {
    method: 'POST',
    body: JSON.stringify({ enableSrtp: true })
  });
  const targetTransport = await targetResp.json();

  // 3. Connect source to target
  await fetch(`${sourcePodUrl}/internal/rooms/${stageId}/pipe-transport/${sourceTransport.transportId}/connect`, {
    method: 'POST',
    body: JSON.stringify({
      ip: targetTransport.ip,
      port: targetTransport.port,
      srtpParameters: targetTransport.srtpParameters
    })
  });

  // 4. Connect target to source
  await fetch(`${targetPodUrl}/internal/rooms/${stageId}/pipe-transport/${targetTransport.transportId}/connect`, {
    method: 'POST',
    body: JSON.stringify({
      ip: sourceTransport.ip,
      port: sourceTransport.port,
      srtpParameters: sourceTransport.srtpParameters
    })
  });

  // 5. For each producer on source, create pipe consumer (source) + pipe producer (target)
  const producers = await (await fetch(`${sourcePodUrl}/internal/rooms/${stageId}/producers`)).json();
  for (const prod of producers.producers) {
    await fetch(`${sourcePodUrl}/internal/rooms/${stageId}/pipe-transport/${sourceTransport.transportId}/consume`, {
      method: 'POST',
      body: JSON.stringify({ producerId: prod.id })
    });

    await fetch(`${targetPodUrl}/internal/rooms/${stageId}/pipe-transport/${targetTransport.transportId}/produce`, {
      method: 'POST',
      body: JSON.stringify({ kind: prod.kind, rtpParameters: prod.rtpParameters })
    });
  }

  return { sourceTransportId: sourceTransport.transportId, targetTransportId: targetTransport.transportId };
}
```

### Mediasoup Internal Endpoints for Pipe

```
POST /internal/rooms/:roomId/pipe-transport/create
  Body: { enableSrtp: true }
  Response: { transportId, ip, port, srtpParameters }

POST /internal/rooms/:roomId/pipe-transport/:transportId/connect
  Body: { ip, port, srtpParameters }
  Response: 200

POST /internal/rooms/:roomId/pipe-transport/:transportId/consume
  Body: { producerId }
  Response: { consumerId }

POST /internal/rooms/:roomId/pipe-transport/:transportId/produce
  Body: { kind, rtpParameters }
  Response: { producerId }
```

## Prometheus Metrics

```js
mediasoup_pipe_transports_active   // gauge: current pipe transports
mediasoup_overflow_routers_active  // gauge: overflow routers per stage
```

## Verification Script: `scripts/test-fan-out.js`

```
1.  Set PIPE_THRESHOLD=5 (low for testing)
2.  Create stage, inject synthetic publisher (video + audio)

3.  Connect 4 subscribers
    Assert: all on same worker, all receiving media (consumer score > 0)
    Assert: GET /api/workers shows 4 consumers on 1 worker

4.  Connect subscriber #5
    Assert: triggers pipe transport creation
    Assert: overflow router created on different worker
    Assert: subscriber #5 receives media

5.  Connect subscribers #6-10
    Assert: distributed across primary + overflow workers
    Assert: all receiving media

6.  Disconnect subscribers #6-10
    Assert: overflow router torn down (shrinkStage)
    Assert: GET /api/workers shows consumers back on 1 worker

7.  GET /metrics
    Assert: mediasoup_pipe_transports_active was > 0 during expansion

8.  Exit 0
```

## Files Changed
- `src/mediasoup-server.js` — StageScaler class, pipe transport endpoints
- `src/signaling-server.js` — consumer routing through scaler
- `scripts/test-fan-out.js` — new file
