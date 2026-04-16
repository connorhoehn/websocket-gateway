# Day 3: Multi-Worker + WebRtcServer

## Problem

One mediasoup worker = one CPU core = ~500 consumers max.
Also: each WebRtcTransport currently opens its own UDP port, requiring thousands of ports.

## Multi-Worker Init

Replace single `mediasoup.createWorker()` with worker pool:

```js
async initWorkers() {
  const numWorkers = parseInt(process.env.MEDIASOUP_WORKERS) ||
    Math.min(require('os').cpus().length, 4);
  const basePort = parseInt(process.env.RTC_BASE_PORT) || 40000;

  for (let i = 0; i < numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: process.env.MEDIASOUP_LOG_LEVEL || 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    });

    worker.on('died', () => {
      logger.error({ workerPid: worker.pid, index: i }, 'Worker died');
      this.replaceWorker(i);
    });

    // WebRtcServer: all transports on this worker share one port
    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        {
          protocol: 'udp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
          port: basePort + i,  // Worker 0=40000, Worker 1=40001, ...
        },
        {
          protocol: 'tcp',
          ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
          announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
          port: basePort + i,
        }
      ]
    });

    this.workers.push({
      worker,
      webRtcServer,
      pid: worker.pid,
      index: i,
      roomCount: 0,
      consumerCount: 0,
    });
  }

  this.nextWorkerIdx = 0;
  logger.info({ numWorkers }, 'Workers initialized');
}
```

### Why WebRtcServer Matters

Without it: each `createWebRtcTransport()` opens a new UDP port. 100 viewers = 100 ports.
With it: all transports on a worker share **one** UDP+TCP port pair.

- 4 workers = 4 ports total (40000, 40001, 40002, 40003)
- Massively simplifies K8s port exposure
- Set via `webRtcServer` option when creating transports (replaces `listenInfos`)

### Transport Creation Update

```js
socket.on('create-webrtc-transport', async (data, callback) => {
  const roomId = this.socketToRoom.get(socket.id);
  const room = this.rooms.get(roomId);

  const transport = await room.router.createWebRtcTransport({
    webRtcServer: room.workerEntry.webRtcServer,
    // No listenInfos needed — webRtcServer handles it
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 600000,
  });

  // ... rest unchanged
});
```

## Round-Robin Room Assignment

```js
getNextWorker() {
  const entry = this.workers[this.nextWorkerIdx];
  this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
  entry.roomCount++;
  return entry;
}
```

Room creation (from Day 2) already calls `this.getNextWorker()`.

## Worker Death Recovery

```js
async replaceWorker(index) {
  const deadEntry = this.workers[index];
  logger.warn({ pid: deadEntry.pid, index }, 'Replacing dead worker');

  // Rooms on dead worker are gone (router.close() cascades on worker death)
  // Clean up our tracking
  for (const [roomId, room] of this.rooms) {
    if (room.workerEntry === deadEntry) {
      // Notify clients to reconnect
      this.io.to(roomId).emit('room-destroyed', {
        reason: 'worker-crash',
        roomId
      });

      // Clean up socket mappings for this room
      for (const [socketId] of room.participants) {
        this.socketToRoom.delete(socketId);
        this.transports.delete(socketId);
        this.producers.delete(socketId);
        this.consumers.delete(socketId);
      }

      this.rooms.delete(roomId);
    }
  }

  // Spawn replacement
  const basePort = parseInt(process.env.RTC_BASE_PORT) || 40000;
  const worker = await mediasoup.createWorker({
    logLevel: process.env.MEDIASOUP_LOG_LEVEL || 'warn',
  });

  worker.on('died', () => this.replaceWorker(index));

  const webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        port: basePort + index },
      { protocol: 'tcp', ip: '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
        port: basePort + index }
    ]
  });

  this.workers[index] = {
    worker, webRtcServer,
    pid: worker.pid,
    index,
    roomCount: 0,
    consumerCount: 0,
  };

  logger.info({ newPid: worker.pid, index }, 'Worker replaced');
}
```

## Worker Stats Endpoint

`GET /api/workers`:

```js
app.get('/api/workers', async (req, res) => {
  const stats = await Promise.all(this.workers.map(async (entry) => {
    let resourceUsage = {};
    try {
      resourceUsage = await entry.worker.getResourceUsage();
    } catch (e) { /* worker may be dead */ }

    return {
      pid: entry.pid,
      index: entry.index,
      rooms: entry.roomCount,
      consumers: entry.consumerCount,
      port: parseInt(process.env.RTC_BASE_PORT || 40000) + entry.index,
      resourceUsage: {
        ruUtime: resourceUsage.ru_utime || 0,
        ruStime: resourceUsage.ru_stime || 0,
      }
    };
  }));

  res.json({ workers: stats, totalWorkers: this.workers.length });
});
```

## Docker Compose Port Change

With WebRtcServer, mediasoup only needs `numWorkers` ports:

```yaml
mediasoup:
  ports:
    - "3001:3001"                           # HTTP API
    - "40000-40003:40000-40003/udp"         # 1 port per worker (4 workers)
    - "40000-40003:40000-40003/tcp"
```

Down from 5000 ports to 4.

## Verification Script: `scripts/test-multi-worker.js`

```
1. Start server (should have 4 workers by default)
2. GET /api/workers -> assert 4 workers listed
3. Create 8 rooms with publishers
4. GET /api/workers -> assert roomCount distributed (not all on worker 0)
5. For each room: verify a subscriber can consume (router works on assigned worker)
6. Assert: all workers have port != 0
7. Exit 0
```

## Files Changed
- `src/mediasoup-server.js` — initWorkers(), getNextWorker(), replaceWorker(), transport creation
- `docker-compose.yml` — mediasoup port mapping (5000 -> 4 ports)
- `scripts/test-multi-worker.js` — new file
