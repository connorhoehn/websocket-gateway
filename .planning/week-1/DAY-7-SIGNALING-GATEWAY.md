# Day 7: Unify Signaling as Gateway

## Problem

Three server files doing overlapping things:
- `turn-server.js` — P2P signaling + room management (class TurnServer)
- `signaling-server.js` — identical copy of turn-server.js (same class TurnServer)
- `mediasoup-server.js` — runs own socket.io, serves own static files, clients connect directly

No coordination layer. Can't route between mediasoup pods. Can't enforce auth.

## Target Architecture

```
Browser/Test Client
       |
       | WebSocket (socket.io)
       v
Signaling Server (port 3000)         <-- Single entry point
  |  - Serves static files (UI)
  |  - Handles all client WebSocket connections  
  |  - Maintains stage/room/participant state
  |  - Routes SFU operations to correct mediasoup pod
  |  - Auth (JWT validation)
  |
  |  HTTP (internal)
  v
Mediasoup Server (port 3001)          <-- Internal only, no direct client access
  - No static file serving
  - No socket.io (HTTP API only)
  - Creates/manages routers, transports, producers, consumers
  - Returns transport params to signaling, which forwards to client
```

## Mediasoup: Convert to Internal HTTP API

Remove socket.io from mediasoup-server.js. Replace with Express REST endpoints.

### Internal API Endpoints

```
POST   /internal/rooms/:roomId/create
  Body: { mediaCodecs }
  Response: { routerRtpCapabilities }

POST   /internal/rooms/:roomId/transport/create
  Body: { type: 'producer'|'consumer' }
  Response: { id, iceParameters, iceCandidates, dtlsParameters }

POST   /internal/rooms/:roomId/transport/:transportId/connect
  Body: { dtlsParameters }
  Response: 200 OK

POST   /internal/rooms/:roomId/produce
  Body: { transportId, kind, rtpParameters }
  Response: { producerId }

POST   /internal/rooms/:roomId/consume
  Body: { transportId, producerId, rtpCapabilities }
  Response: { id, kind, rtpParameters, producerId }

POST   /internal/rooms/:roomId/consumer/:consumerId/resume
  Response: 200 OK

DELETE /internal/rooms/:roomId
  Response: 200 OK

GET    /internal/rooms/:roomId/producers
  Response: { producers: [{ id, socketId, kind }] }

GET    /health
GET    /metrics
GET    /api/workers
```

### Mediasoup Server Changes

```js
// REMOVE: this.io = new Server(...)
// REMOVE: this.setupSocketHandlers()
// REMOVE: app.use(express.static(...))

// ADD: Express routes
this.app.post('/internal/rooms/:roomId/create', async (req, res) => {
  const { roomId } = req.params;
  const room = await this.getOrCreateRoom(roomId);
  res.json({ routerRtpCapabilities: room.router.rtpCapabilities });
});

this.app.post('/internal/rooms/:roomId/transport/create', async (req, res) => {
  const { roomId } = req.params;
  const { type, socketId } = req.body;
  const room = this.rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const transport = await room.router.createWebRtcTransport({
    webRtcServer: room.workerEntry.webRtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  // Store by socketId (signaling passes this through)
  if (!this.transports.has(socketId)) this.transports.set(socketId, {});
  this.transports.get(socketId)[type] = transport;

  // DTLS state monitoring
  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close();
  });

  res.json({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  });
});

// ... similar for connect, produce, consume, resume
```

## Signaling: Become the Gateway

### New Signaling Server Structure

```js
class SignalingGateway {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, { cors: { origin: '*' } });

    // State
    this.stages = new Map();         // stageId -> { config, mediasoupPodUrl, ... }
    this.rooms = new Map();          // roomId -> { config, linkedStageId, ... }
    this.socketToStage = new Map();  // socketId -> stageId
    
    // Mediasoup pod registry
    this.mediasoupPods = [];         // [{ url, name, healthy, load }]

    this.setupStaticFiles();
    this.setupRestApi();
    this.setupSocketHandlers();
  }
}
```

### Socket Handler: Proxy to Mediasoup

```js
setupSocketHandlers() {
  this.io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    socket.on('join-stage', async (data, callback) => {
      const { token } = data;
      
      // 1. Validate JWT
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { stageId, participantId, capabilities } = payload;
      
      // 2. Find stage and its mediasoup pod
      const stage = this.stages.get(stageId);
      if (!stage) return callback({ error: 'Stage not found' });
      
      // 3. Ensure room exists on mediasoup
      const resp = await fetch(`${stage.mediasoupPodUrl}/internal/rooms/${stageId}/create`, {
        method: 'POST'
      });
      const { routerRtpCapabilities } = await resp.json();
      
      // 4. Track mapping
      this.socketToStage.set(socket.id, stageId);
      socket.join(stageId);
      socket.participantId = participantId;
      socket.capabilities = capabilities;
      
      // 5. Notify room
      socket.to(stageId).emit('stage-participant-joined', {
        stageId, participantId,
        userId: payload.userId,
        attributes: payload.attributes
      });
      
      // 6. Return router capabilities + existing producers
      const prodResp = await fetch(`${stage.mediasoupPodUrl}/internal/rooms/${stageId}/producers`);
      const { producers } = await prodResp.json();
      
      callback({
        success: true,
        routerRtpCapabilities,
        existingProducers: producers
      });
    });

    socket.on('create-webrtc-transport', async (data, callback) => {
      const stageId = this.socketToStage.get(socket.id);
      const stage = this.stages.get(stageId);

      const resp = await fetch(
        `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/transport/create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: data.type, socketId: socket.id })
        }
      );
      const transportParams = await resp.json();
      callback(transportParams);
    });

    socket.on('connect-transport', async (data, callback) => {
      const stageId = this.socketToStage.get(socket.id);
      const stage = this.stages.get(stageId);

      await fetch(
        `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/transport/${data.transportId}/connect`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dtlsParameters: data.dtlsParameters })
        }
      );
      callback();
    });

    socket.on('produce', async (data, callback) => {
      // Check capability
      if (!socket.capabilities.includes('PUBLISH')) {
        return callback({ error: 'PUBLISH_NOT_ALLOWED' });
      }

      const stageId = this.socketToStage.get(socket.id);
      const stage = this.stages.get(stageId);

      const resp = await fetch(
        `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/produce`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: data.transportId,
            socketId: socket.id,
            kind: data.kind,
            rtpParameters: data.rtpParameters
          })
        }
      );
      const { producerId } = await resp.json();

      // Notify other participants in the stage
      socket.to(stageId).emit('newProducer', {
        producerId,
        socketId: socket.id,
        participantId: socket.participantId,
        kind: data.kind
      });

      callback({ id: producerId });
    });

    socket.on('consume', async (data, callback) => {
      if (!socket.capabilities.includes('SUBSCRIBE')) {
        return callback({ error: 'SUBSCRIBE_NOT_ALLOWED' });
      }

      const stageId = this.socketToStage.get(socket.id);
      const stage = this.stages.get(stageId);

      const resp = await fetch(
        `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/consume`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transportId: data.transportId,
            socketId: socket.id,
            producerId: data.producerId,
            rtpCapabilities: data.rtpCapabilities
          })
        }
      );
      callback(await resp.json());
    });

    socket.on('resume', async (data, callback) => {
      const stageId = this.socketToStage.get(socket.id);
      const stage = this.stages.get(stageId);

      await fetch(
        `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/consumer/${data.consumerId}/resume`,
        { method: 'POST' }
      );
      callback();
    });

    socket.on('disconnect', async () => {
      const stageId = this.socketToStage.get(socket.id);
      if (!stageId) return;

      // Notify stage
      socket.to(stageId).emit('stage-participant-left', {
        stageId,
        participantId: socket.participantId
      });

      // Cleanup on mediasoup (close transports/producers/consumers for this socket)
      const stage = this.stages.get(stageId);
      if (stage) {
        await fetch(
          `${stage.mediasoupPodUrl}/internal/rooms/${stageId}/cleanup/${socket.id}`,
          { method: 'POST' }
        );
      }

      this.socketToStage.delete(socket.id);
    });
  });
}
```

## Delete turn-server.js

Its room management is now in the signaling gateway. Its P2P signaling can be a mode flag
if needed later, but the primary path is SFU.

## Files Changed

- `src/mediasoup-server.js` — remove socket.io, add internal HTTP API
- `src/signaling-server.js` — complete rewrite as SignalingGateway
- `src/turn-server.js` — DELETE
- `docker/Dockerfile.signaling` — update to copy signaling-server.js (not turn-server.js)

## Verification Script: `scripts/test-gateway.js`

```
1. Connect socket.io to signaling server (port 3000) ONLY
2. Create stage via POST /api/stages
3. Create participant token via POST /api/stages/:stageId/participants
4. Join stage via ws.emit('join-stage', { token })
5. Assert: receive routerRtpCapabilities
6. Create producer transport via ws.emit('create-webrtc-transport')
7. Produce via ws.emit('produce')
8. Connect second client as subscriber
9. Assert: subscriber receives newProducer event
10. Consume via ws.emit('consume') + ws.emit('resume')
11. Verify: NO direct connections to port 3001 were made by any client
12. Exit 0
```
