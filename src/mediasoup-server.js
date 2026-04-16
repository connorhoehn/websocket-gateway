const mediasoup = require('mediasoup');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createServer } = require('http');
const { spawn } = require('child_process');
const { Server } = require('socket.io');

// ---------------------------------------------------------------------------
// Logging — structured JSON (replaces emoji console.logs)
// ---------------------------------------------------------------------------
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? 2;

function log(level, fields, msg) {
  if ((LOG_LEVELS[level] ?? 2) > CURRENT_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, ...fields };
  if (msg) entry.msg = msg;
  console.log(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Media codec list (shared across all routers)
// ---------------------------------------------------------------------------
const MEDIA_CODECS = [
  { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
  {
    kind: 'video', mimeType: 'video/VP8', clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video', mimeType: 'video/VP9', clockRate: 90000,
    parameters: { 'profile-id': 2, 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video', mimeType: 'video/h264', clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '4d0032',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

// ---------------------------------------------------------------------------
// MediasoupServer — multi-worker, room-isolated, metrics-ready
// ---------------------------------------------------------------------------
class MediasoupServer {
  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    // Workers: array of { worker, webRtcServer, pid, index, roomCount, consumerCount }
    this.workers = [];
    this.nextWorkerIdx = 0;

    // Room isolation: each room gets its own router on a specific worker
    this.rooms = new Map();        // roomId -> { router, workerEntry, participants, createdAt }
    this.socketToRoom = new Map(); // socketId -> roomId

    // Per-socket resources
    this.transports = new Map();   // socketId -> { producer: Transport, consumer: Transport }
    this.producers = new Map();    // socketId -> Map<kind, Producer>  (FIX: was Map<socketId, Producer>)
    this.consumers = new Map();    // socketId -> Consumer[]

    // Pipe transport scaling (Week 3)
    this.overflowRouters = new Map();  // roomId -> [{ router, workerEntry, pipeProducers: Map }]
    this.pipeThreshold = parseInt(process.env.PIPE_THRESHOLD) || 400;

    // Recording state (Week 4)
    this.recordings = new Map();   // recordingId -> { ffmpeg, transports, consumers, path, ... }

    // Test injection state
    this.injections = new Map();   // injectionId -> { producer, transport, interval }

    // Draining flag for graceful shutdown
    this.draining = false;

    this.initPromise = this.init();
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------
  async init() {
    try {
      this.setupRoutes();
      await this.initWorkers();
      this.setupSocketHandlers();
      log('info', { component: 'sfu' }, 'MediasoupServer initialized');
    } catch (error) {
      log('error', { component: 'sfu', err: error.message }, 'Init failed');
      process.exit(1);
    }
  }

  // -----------------------------------------------------------------------
  // Multi-worker + WebRtcServer  (Day 3)
  // -----------------------------------------------------------------------
  async initWorkers() {
    const numWorkers = parseInt(process.env.MEDIASOUP_WORKERS) ||
      Math.min(os.cpus().length, 4);
    const basePort = parseInt(process.env.RTC_BASE_PORT) || 40000;

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: process.env.MEDIASOUP_WORKER_LOG_LEVEL || 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      });

      worker.on('died', () => {
        log('error', { component: 'worker', pid: worker.pid, index: i }, 'Worker died');
        this.replaceWorker(i);
      });

      // WebRtcServer: all transports on this worker share ONE port (huge for K8s)
      const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
      const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;
      const port = basePort + i;

      const webRtcServer = await worker.createWebRtcServer({
        listenInfos: [
          { protocol: 'udp', ip: listenIp, announcedAddress, port },
          { protocol: 'tcp', ip: listenIp, announcedAddress, port },
        ],
      });

      this.workers.push({
        worker, webRtcServer, pid: worker.pid, index: i,
        roomCount: 0, consumerCount: 0,
      });

      log('info', { component: 'worker', pid: worker.pid, port }, 'Worker started');
    }

    log('info', { component: 'sfu', numWorkers }, 'All workers initialized');
  }

  async replaceWorker(index) {
    const dead = this.workers[index];
    log('warn', { component: 'worker', pid: dead.pid, index }, 'Replacing dead worker');

    // Rooms on dead worker are destroyed (router.close cascades on worker death)
    for (const [roomId, room] of this.rooms) {
      if (room.workerEntry === dead) {
        this.io.to(roomId).emit('room-destroyed', { reason: 'worker-crash', roomId });
        for (const [socketId] of room.participants) {
          this.socketToRoom.delete(socketId);
          this.transports.delete(socketId);
          this.producers.delete(socketId);
          this.consumers.delete(socketId);
        }
        this.rooms.delete(roomId);
      }
    }

    const basePort = parseInt(process.env.RTC_BASE_PORT) || 40000;
    const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
    const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || undefined;

    const worker = await mediasoup.createWorker({
      logLevel: process.env.MEDIASOUP_WORKER_LOG_LEVEL || 'warn',
    });
    worker.on('died', () => this.replaceWorker(index));

    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        { protocol: 'udp', ip: listenIp, announcedAddress, port: basePort + index },
        { protocol: 'tcp', ip: listenIp, announcedAddress, port: basePort + index },
      ],
    });

    this.workers[index] = {
      worker, webRtcServer, pid: worker.pid, index,
      roomCount: 0, consumerCount: 0,
    };
    log('info', { component: 'worker', newPid: worker.pid, index }, 'Worker replaced');
  }

  getNextWorker() {
    const entry = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return entry;
  }

  // -----------------------------------------------------------------------
  // Room lifecycle  (Day 2)
  // -----------------------------------------------------------------------
  async getOrCreateRoom(roomId) {
    if (this.rooms.has(roomId)) return this.rooms.get(roomId);

    const workerEntry = this.getNextWorker();
    const router = await workerEntry.worker.createRouter({ mediaCodecs: MEDIA_CODECS });

    const room = {
      roomId, router, workerEntry,
      participants: new Map(), // socketId -> { type, metadata, joinedAt }
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    workerEntry.roomCount++;

    log('info', { component: 'room', roomId, workerPid: workerEntry.pid }, 'Room created');
    return room;
  }

  destroyRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.router.close();
    room.workerEntry.roomCount--;
    this.rooms.delete(roomId);
    log('info', { component: 'room', roomId }, 'Room destroyed');
  }

  // Get all producers in a room
  getProducersForRoom(roomId) {
    const result = [];
    for (const [socketId, producerMap] of this.producers) {
      if (this.socketToRoom.get(socketId) === roomId) {
        for (const [kind, producer] of producerMap) {
          result.push({ producerId: producer.id, kind, socketId });
        }
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Pipe Transport Scaling (Week 3, Days 15-16)
  // -----------------------------------------------------------------------

  // Check if a room's primary worker is near capacity
  shouldExpandRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.workerEntry.consumerCount >= this.pipeThreshold;
  }

  // Get the best router for a new consumer (primary or overflow)
  getRouterForConsumer(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Primary worker has room
    if (room.workerEntry.consumerCount < this.pipeThreshold) {
      return { router: room.router, workerEntry: room.workerEntry, isOverflow: false };
    }

    // Check existing overflow routers
    const overflows = this.overflowRouters.get(roomId) || [];
    for (const of_ of overflows) {
      if (of_.workerEntry.consumerCount < this.pipeThreshold) {
        return { router: of_.router, workerEntry: of_.workerEntry, isOverflow: true };
      }
    }

    // All full — need expansion
    return null;
  }

  // Expand a room to a new worker via pipe transports
  async expandRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Find least-loaded worker that isn't the primary
    const targetWorker = this.workers
      .filter(w => w !== room.workerEntry && !w.worker.closed)
      .sort((a, b) => a.consumerCount - b.consumerCount)[0];

    if (!targetWorker) {
      log('warn', { component: 'scaler', roomId }, 'No available worker for expansion');
      return null;
    }

    const targetRouter = await targetWorker.worker.createRouter({ mediaCodecs: MEDIA_CODECS });

    // Pipe all existing producers from source router to target
    const pipeProducers = new Map();
    const allProducers = this.getProducersForRoom(roomId);

    for (const { producerId } of allProducers) {
      try {
        const { pipeConsumer, pipeProducer } = await room.router.pipeToRouter({
          producerId,
          router: targetRouter,
        });
        pipeProducers.set(producerId, { pipeConsumer, pipeProducer });
      } catch (e) {
        log('warn', { component: 'scaler', producerId, err: e.message }, 'Pipe failed for producer');
      }
    }

    const overflow = { router: targetRouter, workerEntry: targetWorker, pipeProducers };
    if (!this.overflowRouters.has(roomId)) this.overflowRouters.set(roomId, []);
    this.overflowRouters.get(roomId).push(overflow);

    log('info', {
      component: 'scaler', roomId,
      targetPid: targetWorker.pid,
      pipedProducers: pipeProducers.size,
    }, 'Room expanded to overflow worker');

    return overflow;
  }

  // Pipe a new producer to all existing overflow routers for a room
  async pipeNewProducerToOverflows(roomId, producerId) {
    const room = this.rooms.get(roomId);
    const overflows = this.overflowRouters.get(roomId) || [];
    for (const of_ of overflows) {
      try {
        const { pipeConsumer, pipeProducer } = await room.router.pipeToRouter({
          producerId,
          router: of_.router,
        });
        of_.pipeProducers.set(producerId, { pipeConsumer, pipeProducer });
      } catch (e) {
        log('warn', { component: 'scaler', producerId, err: e.message }, 'Pipe to overflow failed');
      }
    }
  }

  // Shrink: remove empty overflow routers
  shrinkRoom(roomId) {
    const overflows = this.overflowRouters.get(roomId) || [];
    const active = [];
    for (const of_ of overflows) {
      if (of_.workerEntry.consumerCount <= 0) {
        of_.router.close();
        log('info', { component: 'scaler', roomId, pid: of_.workerEntry.pid }, 'Closed empty overflow router');
      } else {
        active.push(of_);
      }
    }
    if (active.length === 0) this.overflowRouters.delete(roomId);
    else this.overflowRouters.set(roomId, active);
  }

  // -----------------------------------------------------------------------
  // ICE servers
  // -----------------------------------------------------------------------
  getIceServers() {
    const iceServers = [];
    const coturnUrls = process.env.COTURN_URLS ? process.env.COTURN_URLS.split(',') : [];
    const coturnUsername = process.env.COTURN_USERNAME || 'webrtc';
    const coturnPassword = process.env.COTURN_PASSWORD || 'webrtc123';

    coturnUrls.forEach(url => {
      const trimmed = url.trim();
      if (trimmed.startsWith('stun:')) {
        iceServers.push({ urls: [trimmed] });
      } else if (trimmed.startsWith('turn:') || trimmed.startsWith('turns:')) {
        iceServers.push({ urls: [trimmed], username: coturnUsername, credential: coturnPassword });
      }
    });

    if (iceServers.length === 0) {
      iceServers.push({ urls: ['stun:stun.l.google.com:19302'] });
    }
    return iceServers;
  }

  // -----------------------------------------------------------------------
  // Express routes  (Day 4: health, metrics, workers, test injection)
  // -----------------------------------------------------------------------
  setupRoutes() {
    this.app.use(express.static(path.join(__dirname, 'static')));

    // Health
    this.app.get('/health', (req, res) => {
      const workersAlive = this.workers.filter(w => !w.worker.closed).length;
      const healthy = workersAlive > 0 && !this.draining;
      res.status(healthy ? 200 : 503).json({
        status: this.draining ? 'draining' : (healthy ? 'healthy' : 'degraded'),
        workers: { alive: workersAlive, total: this.workers.length },
        rooms: this.rooms.size,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    });

    // Worker stats
    this.app.get('/api/workers', async (req, res) => {
      const stats = await Promise.all(this.workers.map(async (entry) => {
        let resourceUsage = {};
        try { resourceUsage = await entry.worker.getResourceUsage(); } catch (e) { /* dead */ }
        return {
          pid: entry.pid, index: entry.index,
          rooms: entry.roomCount, consumers: entry.consumerCount,
          port: parseInt(process.env.RTC_BASE_PORT || 40000) + entry.index,
          resourceUsage: { ruUtime: resourceUsage.ru_utime || 0, ruStime: resourceUsage.ru_stime || 0 },
        };
      }));
      res.json({ workers: stats, totalWorkers: this.workers.length });
    });

    // Room stats
    this.app.get('/api/rooms', (req, res) => {
      const rooms = Array.from(this.rooms.values()).map(room => ({
        roomId: room.roomId,
        participants: room.participants.size,
        producers: this.getProducersForRoom(room.roomId).length,
        workerPid: room.workerEntry.pid,
        createdAt: new Date(room.createdAt).toISOString(),
      }));
      res.json({ rooms });
    });

    // Metrics (Prometheus format)
    this.app.get('/metrics', (req, res) => {
      let totalProducers = 0;
      for (const [, pMap] of this.producers) totalProducers += pMap.size;
      let totalConsumers = 0;
      for (const [, cArr] of this.consumers) totalConsumers += cArr.length;

      const lines = [
        `# HELP mediasoup_workers_active Number of active workers`,
        `# TYPE mediasoup_workers_active gauge`,
        `mediasoup_workers_active ${this.workers.filter(w => !w.worker.closed).length}`,
        `# HELP mediasoup_rooms_active Number of active rooms`,
        `# TYPE mediasoup_rooms_active gauge`,
        `mediasoup_rooms_active ${this.rooms.size}`,
        `# HELP mediasoup_producers_total Total active producers`,
        `# TYPE mediasoup_producers_total gauge`,
        `mediasoup_producers_total ${totalProducers}`,
        `# HELP mediasoup_consumers_total Total active consumers`,
        `# TYPE mediasoup_consumers_total gauge`,
        `mediasoup_consumers_total ${totalConsumers}`,
        `# HELP mediasoup_transports_active Total active transports`,
        `# TYPE mediasoup_transports_active gauge`,
        `mediasoup_transports_active ${this.transports.size}`,
      ];

      // Pipe transport metrics
      let totalOverflows = 0;
      for (const [, ofs] of this.overflowRouters) totalOverflows += ofs.length;
      lines.push(`# HELP mediasoup_overflow_routers_active Overflow routers via pipe transports`);
      lines.push(`# TYPE mediasoup_overflow_routers_active gauge`);
      lines.push(`mediasoup_overflow_routers_active ${totalOverflows}`);
      lines.push(`# HELP mediasoup_pipe_threshold Consumer threshold triggering pipe expansion`);
      lines.push(`# TYPE mediasoup_pipe_threshold gauge`);
      lines.push(`mediasoup_pipe_threshold ${this.pipeThreshold}`);

      // Per-worker metrics
      for (const entry of this.workers) {
        lines.push(`mediasoup_worker_consumers{pid="${entry.pid}"} ${entry.consumerCount}`);
        lines.push(`mediasoup_worker_rooms{pid="${entry.pid}"} ${entry.roomCount}`);
      }

      res.set('Content-Type', 'text/plain; version=0.0.4');
      res.end(lines.join('\n') + '\n');
    });

    // ---- Internal HTTP API (used by signaling gateway) ----

    // Create or get room
    this.app.post('/internal/rooms/:roomId/create', async (req, res) => {
      try {
        const room = await this.getOrCreateRoom(req.params.roomId);
        res.json({ routerRtpCapabilities: room.router.rtpCapabilities });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Delete room
    this.app.delete('/internal/rooms/:roomId', (req, res) => {
      this.destroyRoom(req.params.roomId);
      res.json({ deleted: true });
    });

    // List producers in a room
    this.app.get('/internal/rooms/:roomId/producers', (req, res) => {
      const producers = this.getProducersForRoom(req.params.roomId);
      res.json({ producers });
    });

    // Create transport
    this.app.post('/internal/rooms/:roomId/transport/create', async (req, res) => {
      try {
        const room = this.rooms.get(req.params.roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });
        const { type, socketId } = req.body;

        const transport = await room.router.createWebRtcTransport({
          webRtcServer: room.workerEntry.webRtcServer,
          enableUdp: true, enableTcp: true, preferUdp: true,
          initialAvailableOutgoingBitrate: 600000,
        });

        transport.on('dtlsstatechange', (state) => { if (state === 'closed') transport.close(); });

        if (!this.transports.has(socketId)) this.transports.set(socketId, {});
        this.transports.get(socketId)[type] = transport;

        res.json({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Connect transport
    this.app.post('/internal/rooms/:roomId/transport/:transportId/connect', async (req, res) => {
      try {
        const { socketId, type, dtlsParameters } = req.body;
        const transports = this.transports.get(socketId);
        if (!transports?.[type]) return res.status(404).json({ error: 'Transport not found' });
        await transports[type].connect({ dtlsParameters });
        res.json({ connected: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Produce
    this.app.post('/internal/rooms/:roomId/produce', async (req, res) => {
      try {
        const { socketId, kind, rtpParameters } = req.body;
        const transports = this.transports.get(socketId);
        if (!transports?.producer) return res.status(404).json({ error: 'Producer transport not found' });

        const producer = await transports.producer.produce({ kind, rtpParameters });
        producer.on('transportclose', () => producer.close());

        if (!this.producers.has(socketId)) this.producers.set(socketId, new Map());
        this.producers.get(socketId).set(kind, producer);

        const room = this.rooms.get(req.params.roomId);
        if (room) room.workerEntry.consumerCount; // just accessing, not incrementing

        // Pipe to any overflow routers for this room
        await this.pipeNewProducerToOverflows(req.params.roomId, producer.id);

        log('info', { component: 'internal', socketId, producerId: producer.id, kind }, 'Producer created via internal API');
        res.json({ producerId: producer.id });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Consume
    // Scaling-aware consume: auto-expands to overflow worker when primary is full
    this.app.post('/internal/rooms/:roomId/consume', async (req, res) => {
      try {
        const roomId = req.params.roomId;
        const room = this.rooms.get(roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const { socketId, producerId, rtpCapabilities } = req.body;

        // Find best router (primary or overflow)
        let routerInfo = this.getRouterForConsumer(roomId);
        if (!routerInfo) {
          // Need expansion
          const overflow = await this.expandRoom(roomId);
          if (!overflow) return res.status(503).json({ error: 'No capacity available' });
          routerInfo = { router: overflow.router, workerEntry: overflow.workerEntry, isOverflow: true };
        }

        // If consumer transport is on a different worker than the target router,
        // we need to create a new transport on the right worker.
        // For now, create transport on the target router's worker if not exists.
        let transports = this.transports.get(socketId);
        const transportKey = routerInfo.isOverflow ? 'consumerOverflow' : 'consumer';

        if (!transports?.[transportKey]) {
          // Create transport on the correct router
          const transport = await routerInfo.router.createWebRtcTransport({
            webRtcServer: routerInfo.workerEntry.webRtcServer,
            enableUdp: true, enableTcp: true, preferUdp: true,
          });
          transport.on('dtlsstatechange', (s) => { if (s === 'closed') transport.close(); });
          if (!transports) { transports = {}; this.transports.set(socketId, transports); }
          transports[transportKey] = transport;
        }

        // For overflow routers, the producer was piped — find the piped producerId
        let targetProducerId = producerId;
        if (routerInfo.isOverflow) {
          // The piped producer has the same ID due to keepId:true (default)
          // Just verify the router can consume it
        }

        if (!routerInfo.router.canConsume({ producerId: targetProducerId, rtpCapabilities })) {
          return res.status(400).json({ error: 'Cannot consume' });
        }

        const consumer = await transports[transportKey].consume({
          producerId: targetProducerId, rtpCapabilities, paused: true,
        });
        consumer.on('transportclose', () => consumer.close());
        consumer.on('producerclose', () => consumer.close());

        if (!this.consumers.has(socketId)) this.consumers.set(socketId, []);
        this.consumers.get(socketId).push(consumer);
        routerInfo.workerEntry.consumerCount++;

        res.json({
          id: consumer.id, kind: consumer.kind, rtpParameters: consumer.rtpParameters,
          producerId: consumer.producerId,
          overflow: routerInfo.isOverflow,
          workerPid: routerInfo.workerEntry.pid,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Resume consumer
    this.app.post('/internal/rooms/:roomId/consumer/:consumerId/resume', async (req, res) => {
      try {
        const { socketId } = req.body;
        const consumers = this.consumers.get(socketId) || [];
        const consumer = consumers.find(c => c.id === req.params.consumerId);
        if (!consumer) return res.status(404).json({ error: 'Consumer not found' });
        await consumer.resume();
        res.json({ resumed: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Cleanup a socket's resources
    this.app.post('/internal/rooms/:roomId/cleanup/:socketId', (req, res) => {
      this.cleanup(req.params.socketId);
      res.json({ cleaned: true });
    });

    // ================================================================
    // Recording API (Week 4, Days 22-23)
    // ================================================================

    this.app.post('/internal/rooms/:roomId/recording/start', async (req, res) => {
      try {
        const roomId = req.params.roomId;
        const room = this.rooms.get(roomId);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        const producers = this.getProducersForRoom(roomId);
        const videoProd = producers.find(p => p.kind === 'video');
        if (!videoProd) return res.status(400).json({ error: 'No video producer to record' });

        const recordingDir = process.env.RECORDING_PATH || path.join(os.tmpdir(), 'lvb-recordings');
        fs.mkdirSync(recordingDir, { recursive: true });

        const recordingId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const recordingPath = path.join(recordingDir, `${roomId}_${Date.now()}.mkv`);

        // Create PlainTransport for video
        const videoTransport = await room.router.createPlainTransport({
          listenInfo: { protocol: 'udp', ip: '127.0.0.1' },
          rtcpMux: true,
          comedia: true,
        });

        const videoConsumer = await videoTransport.consume({
          producerId: videoProd.producerId,
          rtpCapabilities: room.router.rtpCapabilities,
          paused: false,
        });

        const videoPort = videoTransport.tuple.localPort;
        const videoCodec = videoConsumer.rtpParameters.codecs[0];
        const videoSsrc = videoConsumer.rtpParameters.encodings[0].ssrc;

        // Generate SDP
        const codecName = videoCodec.mimeType.split('/')[1].toUpperCase();
        const sdpContent = [
          'v=0',
          'o=- 0 0 IN IP4 127.0.0.1',
          's=Recording',
          'c=IN IP4 127.0.0.1',
          't=0 0',
          `m=video ${videoPort} RTP/AVP ${videoCodec.payloadType}`,
          `a=rtpmap:${videoCodec.payloadType} ${codecName}/${videoCodec.clockRate}`,
          `a=ssrc:${videoSsrc} cname:recording`,
          'a=recvonly',
          '',
        ].join('\r\n');

        const sdpPath = `${recordingPath}.sdp`;
        fs.writeFileSync(sdpPath, sdpContent);

        // Spawn FFmpeg
        const ffmpeg = spawn('ffmpeg', [
          '-loglevel', 'warning',
          '-protocol_whitelist', 'file,udp,rtp',
          '-fflags', '+genpts',
          '-i', sdpPath,
          '-c:v', 'copy',
          '-f', 'matroska',
          recordingPath,
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        let ffmpegStderr = '';
        ffmpeg.stderr.on('data', (d) => { ffmpegStderr += d.toString(); });
        ffmpeg.on('close', (code) => {
          log('info', { component: 'recording', recordingId, exitCode: code }, 'FFmpeg exited');
        });

        const recording = {
          recordingId, roomId, path: recordingPath, sdpPath,
          ffmpeg, videoTransport, videoConsumer,
          startedAt: new Date(), state: 'ACTIVE',
        };
        this.recordings.set(recordingId, recording);

        log('info', { component: 'recording', recordingId, roomId, path: recordingPath }, 'Recording started');
        res.json({ recordingId, state: 'ACTIVE', path: recordingPath, startedAt: recording.startedAt.toISOString() });
      } catch (err) {
        log('error', { component: 'recording', err: err.message }, 'Start recording failed');
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/internal/rooms/:roomId/recording/:recordingId/stop', async (req, res) => {
      try {
        const recording = this.recordings.get(req.params.recordingId);
        if (!recording) return res.status(404).json({ error: 'Recording not found' });

        // Stop FFmpeg gracefully
        recording.ffmpeg.stdin.write('q');
        await new Promise((resolve) => {
          const timeout = setTimeout(() => { recording.ffmpeg.kill('SIGKILL'); resolve(); }, 10000);
          recording.ffmpeg.on('close', () => { clearTimeout(timeout); resolve(); });
        });

        // Close mediasoup resources
        recording.videoConsumer.close();
        recording.videoTransport.close();

        // Cleanup SDP
        try { fs.unlinkSync(recording.sdpPath); } catch {}

        let fileSize = 0;
        try { fileSize = fs.statSync(recording.path).size; } catch {}

        recording.state = 'STOPPED';
        recording.stoppedAt = new Date();
        recording.fileSize = fileSize;

        log('info', { component: 'recording', recordingId: recording.recordingId, fileSize }, 'Recording stopped');
        res.json({
          recordingId: recording.recordingId, state: 'STOPPED',
          path: recording.path, fileSize,
          duration: (recording.stoppedAt - recording.startedAt) / 1000,
          startedAt: recording.startedAt.toISOString(),
          stoppedAt: recording.stoppedAt.toISOString(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/internal/recordings', (req, res) => {
      const recs = Array.from(this.recordings.values()).map(r => ({
        recordingId: r.recordingId, roomId: r.roomId, state: r.state,
        path: r.path, fileSize: r.fileSize || 0,
        startedAt: r.startedAt.toISOString(),
        stoppedAt: r.stoppedAt?.toISOString(),
      }));
      res.json({ recordings: recs });
    });

    // ---- Test injection endpoint (development only) ----
    if (process.env.NODE_ENV !== 'production') {
      this.app.post('/api/test/inject-stream', async (req, res) => {
        try {
          const { roomId } = req.body;
          if (!roomId) return res.status(400).json({ error: 'roomId required' });

          const room = await this.getOrCreateRoom(roomId);
          const result = await this.injectSyntheticStream(room);
          res.json(result);
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      });

      this.app.delete('/api/test/inject-stream/:injectionId', (req, res) => {
        const injection = this.injections.get(req.params.injectionId);
        if (!injection) return res.status(404).json({ error: 'Not found' });
        clearInterval(injection.interval);
        injection.producer.close();
        injection.transport.close();
        // Clean up producer tracking
        this.producers.delete(injection.syntheticSocketId);
        this.socketToRoom.delete(injection.syntheticSocketId);
        this.injections.delete(req.params.injectionId);
        res.json({ stopped: true });
      });
    }
  }

  // -----------------------------------------------------------------------
  // Synthetic stream injection (for headless tests)
  // -----------------------------------------------------------------------
  async injectSyntheticStream(room) {
    const directTransport = await room.router.createDirectTransport();
    const producer = await directTransport.produce({
      kind: 'video',
      rtpParameters: {
        codecs: [{
          mimeType: 'video/VP8',
          payloadType: 101,
          clockRate: 90000,
          rtcpFeedback: [],
        }],
        encodings: [{ ssrc: 11111111 }],
      },
    });

    let seq = 0;
    let ts = 0;
    const interval = setInterval(() => {
      if (producer.closed) { clearInterval(interval); return; }
      const packet = this.generateVP8Packet(seq++, ts);
      producer.send(packet);
      ts += 3000; // 30fps at 90kHz
    }, 33);

    const injectionId = `inj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const syntheticSocketId = `__synthetic_${injectionId}__`;
    this.injections.set(injectionId, { producer, transport: directTransport, interval, syntheticSocketId });

    // Register in producers map so getProducersForRoom finds it
    this.socketToRoom.set(syntheticSocketId, room.roomId);
    if (!this.producers.has(syntheticSocketId)) {
      this.producers.set(syntheticSocketId, new Map());
    }
    this.producers.get(syntheticSocketId).set('video', producer);

    // Notify any existing clients in the room
    this.io.to(room.roomId).emit('newProducer', {
      producerId: producer.id,
      socketId: syntheticSocketId,
      kind: 'video',
    });

    log('info', { component: 'test', roomId: room.roomId, producerId: producer.id }, 'Synthetic stream injected');

    return { injectionId, producerId: producer.id, roomId: room.roomId };
  }

  generateVP8Packet(seq, timestamp) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 101;
    header.writeUInt16BE(seq & 0xFFFF, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(11111111, 8);

    const vp8Payload = Buffer.from([
      0x10, 0x00, 0x9d, 0x01, 0x2a, 0x00, 0x01, 0x00, 0x01,
    ]);

    return Buffer.concat([header, vp8Payload]);
  }

  // -----------------------------------------------------------------------
  // Socket.io handlers (Day 1-2: producer fix + room-scoped events)
  // -----------------------------------------------------------------------
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      log('info', { component: 'socket', socketId: socket.id }, 'Client connected');

      // -- Join room (creates router if needed, scopes everything) --
      socket.on('join-room', async (data, callback) => {
        try {
          const { roomId, type, metadata = {} } = data;
          if (!roomId) return callback?.({ error: 'roomId required' });

          // Leave current room if any
          const currentRoom = this.socketToRoom.get(socket.id);
          if (currentRoom) this.leaveRoom(socket);

          const room = await this.getOrCreateRoom(roomId);
          this.socketToRoom.set(socket.id, roomId);
          socket.join(roomId);
          room.participants.set(socket.id, { type, metadata, joinedAt: Date.now() });

          log('info', { component: 'room', roomId, socketId: socket.id, type }, 'Joined room');

          // Return router capabilities so client can load mediasoup Device
          const response = {
            success: true,
            routerRtpCapabilities: room.router.rtpCapabilities,
          };

          if (callback) callback(response);

          // Notify room (scoped)
          socket.to(roomId).emit('user-joined', {
            socketId: socket.id, type, roomId, metadata,
          });

          // Send existing producers to new subscriber
          const existingProducers = this.getProducersForRoom(roomId);
          for (const prod of existingProducers) {
            socket.emit('newProducer', {
              producerId: prod.producerId,
              socketId: prod.socketId,
              kind: prod.kind,
            });
          }
        } catch (error) {
          log('error', { component: 'room', err: error.message }, 'Join room failed');
          if (callback) callback({ error: error.message });
        }
      });

      // -- Router RTP capabilities (for clients that need it separately) --
      socket.on('get-router-rtp-capabilities', (callback) => {
        const roomId = this.socketToRoom.get(socket.id);
        const room = this.rooms.get(roomId);
        if (room) {
          callback(room.router.rtpCapabilities);
        } else {
          callback({ error: 'Not in a room' });
        }
      });

      // -- Create WebRTC transport (uses room's router + worker's WebRtcServer) --
      socket.on('create-webrtc-transport', async (data, callback) => {
        try {
          const { type } = data;
          const roomId = this.socketToRoom.get(socket.id);
          const room = this.rooms.get(roomId);
          if (!room) throw new Error('Not in a room');

          const transport = await room.router.createWebRtcTransport({
            webRtcServer: room.workerEntry.webRtcServer,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 600000,
          });

          transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') transport.close();
          });

          if (!this.transports.has(socket.id)) {
            this.transports.set(socket.id, {});
          }
          this.transports.get(socket.id)[type] = transport;

          log('debug', { component: 'transport', socketId: socket.id, type, transportId: transport.id }, 'Transport created');

          callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
        } catch (error) {
          log('error', { component: 'transport', err: error.message }, 'Transport creation failed');
          callback({ error: error.message });
        }
      });

      // -- Connect transport --
      socket.on('connect-transport', async (data, callback) => {
        try {
          const { type, dtlsParameters } = data;
          const transports = this.transports.get(socket.id);
          if (!transports?.[type]) throw new Error(`${type} transport not found`);
          await transports[type].connect({ dtlsParameters });
          callback();
        } catch (error) {
          log('error', { component: 'transport', err: error.message }, 'Transport connect failed');
          callback({ error: error.message });
        }
      });

      // -- Produce (FIX: stores per-kind, not overwriting) --
      socket.on('produce', async (data, callback) => {
        try {
          const { kind, rtpParameters } = data;
          const transports = this.transports.get(socket.id);
          if (!transports?.producer) throw new Error('Producer transport not found');

          const producer = await transports.producer.produce({ kind, rtpParameters });
          producer.on('transportclose', () => producer.close());

          // FIX: Map<socketId, Map<kind, Producer>> instead of overwriting
          if (!this.producers.has(socket.id)) {
            this.producers.set(socket.id, new Map());
          }
          this.producers.get(socket.id).set(kind, producer);

          log('info', {
            component: 'produce', socketId: socket.id, producerId: producer.id,
            kind, type: producer.type,
          }, 'Producer created');

          // Notify room (scoped — not broadcast to everyone)
          const roomId = this.socketToRoom.get(socket.id);
          if (roomId) {
            socket.to(roomId).emit('newProducer', {
              producerId: producer.id,
              socketId: socket.id,
              kind,
            });
          }

          callback({ id: producer.id });
        } catch (error) {
          log('error', { component: 'produce', err: error.message }, 'Produce failed');
          callback({ error: error.message });
        }
      });

      // -- Consume --
      socket.on('consume', async (data, callback) => {
        try {
          const { producerId, rtpCapabilities } = data;
          const roomId = this.socketToRoom.get(socket.id);
          const room = this.rooms.get(roomId);
          if (!room) throw new Error('Not in a room');

          const transports = this.transports.get(socket.id);
          if (!transports?.consumer) throw new Error('Consumer transport not found');

          if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            return callback({ error: 'Cannot consume' });
          }

          const consumer = await transports.consumer.consume({
            producerId, rtpCapabilities, paused: true,
          });

          consumer.on('transportclose', () => consumer.close());
          consumer.on('producerclose', () => {
            consumer.close();
            socket.emit('consumerClosed', { consumerId: consumer.id });
          });

          if (!this.consumers.has(socket.id)) {
            this.consumers.set(socket.id, []);
          }
          this.consumers.get(socket.id).push(consumer);
          room.workerEntry.consumerCount++;

          log('debug', {
            component: 'consume', socketId: socket.id, consumerId: consumer.id,
            producerId, kind: consumer.kind,
          }, 'Consumer created');

          callback({
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          });
        } catch (error) {
          log('error', { component: 'consume', err: error.message }, 'Consume failed');
          callback({ error: error.message });
        }
      });

      // -- Resume consumer --
      socket.on('resume', async (data, callback) => {
        try {
          const { consumerId } = data;
          const consumers = this.consumers.get(socket.id) || [];
          const consumer = consumers.find(c => c.id === consumerId);
          if (!consumer) throw new Error(`Consumer ${consumerId} not found`);
          await consumer.resume();
          callback();
        } catch (error) {
          callback({ error: error.message });
        }
      });

      // -- Chat (room-scoped) --
      socket.on('chat-message', (data) => {
        const roomId = this.socketToRoom.get(socket.id);
        if (roomId) {
          socket.to(roomId).emit('chat-message', {
            socketId: socket.id,
            message: data.message,
            timestamp: new Date().toISOString(),
          });
        }
      });

      // -- Disconnect --
      socket.on('disconnect', () => {
        log('info', { component: 'socket', socketId: socket.id }, 'Client disconnected');
        this.leaveRoom(socket);
        this.cleanup(socket.id);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Leave room
  // -----------------------------------------------------------------------
  leaveRoom(socket) {
    const roomId = this.socketToRoom.get(socket.id);
    if (!roomId) return;

    const room = this.rooms.get(roomId);
    if (room) {
      room.participants.delete(socket.id);
      socket.to(roomId).emit('user-left', { socketId: socket.id });
      socket.leave(roomId);

      // Destroy room if empty
      if (room.participants.size === 0) {
        this.destroyRoom(roomId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup (FIX: iterates producer Map<kind, Producer>)
  // -----------------------------------------------------------------------
  cleanup(socketId) {
    const roomId = this.socketToRoom.get(socketId);

    // Clean up producers (FIX: iterate inner map)
    const producerMap = this.producers.get(socketId);
    if (producerMap) {
      for (const [kind, producer] of producerMap) {
        producer.close();
        if (roomId) {
          this.io.to(roomId).emit('producerClosed', {
            producerId: producer.id, socketId, kind,
          });
        }
      }
      this.producers.delete(socketId);
    }

    // Clean up consumers
    const consumers = this.consumers.get(socketId);
    if (consumers) {
      const room = this.rooms.get(roomId);
      consumers.forEach(consumer => {
        consumer.close();
        if (room) room.workerEntry.consumerCount--;
      });
      this.consumers.delete(socketId);
    }

    // Clean up transports
    const transports = this.transports.get(socketId);
    if (transports) {
      Object.values(transports).forEach(t => { if (!t.closed) t.close(); });
      this.transports.delete(socketId);
    }

    this.socketToRoom.delete(socketId);
  }

  // -----------------------------------------------------------------------
  // Start / Shutdown
  // -----------------------------------------------------------------------
  async start(port = 3001) {
    await this.initPromise;
    this.server.listen(port, () => {
      log('info', {
        component: 'sfu', port,
        workers: this.workers.length,
        pids: this.workers.map(w => w.pid),
      }, 'MediasoupServer listening');
    });
  }

  async shutdown() {
    log('info', { component: 'sfu' }, 'Shutting down');
    this.draining = true;

    // Close all injections
    for (const [id, injection] of this.injections) {
      clearInterval(injection.interval);
      injection.producer.close();
      injection.transport.close();
    }
    this.injections.clear();

    // Close all transports (cascades to producers/consumers)
    this.transports.forEach((transports) => {
      Object.values(transports).forEach(t => { if (!t.closed) t.close(); });
    });
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();

    // Close all rooms
    for (const [roomId] of this.rooms) {
      this.destroyRoom(roomId);
    }

    // Close workers
    for (const entry of this.workers) {
      entry.worker.close();
    }

    // Close HTTP server
    if (this.server) {
      await new Promise(resolve => this.server.close(resolve));
    }

    log('info', { component: 'sfu' }, 'Shutdown complete');
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function startServer() {
  const server = new MediasoupServer();
  const port = process.env.PORT || 3001;

  const gracefulShutdown = async (signal) => {
    log('info', { component: 'sfu', signal }, 'Graceful shutdown initiated');
    try {
      await server.shutdown();
      process.exit(0);
    } catch (error) {
      log('error', { component: 'sfu', err: error.message }, 'Shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    log('error', { component: 'sfu', err: error.message, stack: error.stack }, 'Uncaught exception');
    gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    log('error', { component: 'sfu', reason: String(reason) }, 'Unhandled rejection');
    gracefulShutdown('unhandledRejection');
  });

  await server.start(port);
  return server;
}

startServer().catch(err => {
  log('error', { component: 'sfu', err: err.message }, 'Failed to start');
  process.exit(1);
});
