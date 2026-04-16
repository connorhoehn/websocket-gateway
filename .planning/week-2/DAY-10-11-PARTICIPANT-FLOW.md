# Days 10-11: Participant Tokens + Publish/Subscribe Flow

Implements IVS equivalents: CreateParticipantToken, GetParticipant, ListParticipants, DisconnectParticipant.

## REST: CreateParticipantToken

### POST /api/stages/:stageId/participants

```js
app.post('/api/stages/:stageId/participants', (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  const {
    userId = '',
    capabilities = ['PUBLISH', 'SUBSCRIBE'],
    duration = 720,       // minutes, default 12h (IVS default)
    attributes = {}
  } = req.body;

  // Validate capabilities
  const validCaps = ['PUBLISH', 'SUBSCRIBE'];
  if (!capabilities.every(c => validCaps.includes(c))) {
    return res.status(400).json({ error: 'Invalid capabilities' });
  }
  if (duration < 1 || duration > 20160) {
    return res.status(400).json({ error: 'Duration must be 1-20160 minutes' });
  }
  // Validate attributes size (IVS: max 1KB total)
  if (JSON.stringify(attributes).length > 1024) {
    return res.status(400).json({ error: 'Attributes must be under 1KB' });
  }

  const tokenData = generateParticipantToken(stage.stageId, {
    userId, capabilities, duration, attributes
  });

  res.status(200).json({ participantToken: tokenData });
});
```

## REST: ListParticipants

### GET /api/stages/:stageId/participants

```js
app.get('/api/stages/:stageId/participants', (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  let participants = Array.from(stage.participants.values());

  // IVS-compatible filters (only one at a time)
  const { filterByPublished, filterByState, filterByUserId } = req.query;
  if (filterByPublished !== undefined) {
    const pub = filterByPublished === 'true';
    participants = participants.filter(p => p.published === pub);
  } else if (filterByState) {
    participants = participants.filter(p => p.state === filterByState);
  } else if (filterByUserId) {
    participants = participants.filter(p => p.userId === filterByUserId);
  }

  res.json({
    participants: participants.map(serializeParticipant)
  });
});
```

## REST: DisconnectParticipant

### DELETE /api/stages/:stageId/participants/:participantId

```js
app.delete('/api/stages/:stageId/participants/:participantId', async (req, res) => {
  const stage = stageManager.stages.get(req.params.stageId);
  if (!stage) return res.status(404).json({ error: 'Stage not found' });

  const participant = stage.participants.get(req.params.participantId);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  const reason = req.body?.reason || 'Disconnected by server';

  // Force disconnect the socket
  const socket = io.sockets.sockets.get(participant.socketId);
  if (socket) {
    socket.emit('force-disconnect', { reason });
    socket.disconnect(true);
  }

  res.status(200).json({});
});
```

## WebSocket: Join Stage Flow

### Client sends: `join-stage`

```js
socket.on('join-stage', async ({ token }, callback) => {
  try {
    // 1. Validate JWT
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const { stageId, participantId, userId, capabilities, attributes } = payload;

    // 2. Find stage
    const stage = stageManager.stages.get(stageId);
    if (!stage) return callback({ error: 'Stage not found' });

    // 3. Check capacity
    if (stage.participants.size >= stage.maxParticipants) {
      return callback({ error: 'Stage full' });
    }

    // 4. Create session on first join
    if (!stage.activeSessionId) {
      stage.activeSessionId = `sess_${nanoid(12)}`;
      stage.state = 'ACTIVE';
    }

    // 5. Register participant
    const participantRecord = {
      participantId,
      userId,
      capabilities,
      attributes,
      socketId: socket.id,
      state: 'CONNECTED',
      published: false,
      firstJoinTime: new Date(),
    };
    stage.participants.set(participantId, participantRecord);

    // 6. Track socket -> stage mapping
    socketToStage.set(socket.id, stageId);
    socket.join(stageId);
    socket.participantId = participantId;
    socket.capabilities = capabilities;
    socket.stageId = stageId;

    // 7. Get router capabilities from mediasoup
    const resp = await fetch(`${stage.mediasoupPod.url}/internal/rooms/${stageId}/create`, {
      method: 'POST'
    });
    const { routerRtpCapabilities } = await resp.json();

    // 8. Get existing producers
    const prodResp = await fetch(`${stage.mediasoupPod.url}/internal/rooms/${stageId}/producers`);
    const { producers } = await prodResp.json();

    // 9. Notify others
    socket.to(stageId).emit('stage-participant-joined', {
      stageId, participantId, userId, attributes
    });

    // 10. Return to client
    callback({
      success: true,
      stageId,
      participantId,
      routerRtpCapabilities,
      existingProducers: producers
    });

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return callback({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return callback({ error: 'Invalid token' });
    }
    logger.error({ err }, 'Join stage failed');
    callback({ error: err.message });
  }
});
```

### Produce with capability check

```js
socket.on('produce', async (data, callback) => {
  if (!socket.capabilities || !socket.capabilities.includes('PUBLISH')) {
    return callback({ error: 'PUBLISH_NOT_ALLOWED' });
  }

  const stage = stageManager.stages.get(socket.stageId);
  const resp = await fetch(`${stage.mediasoupPod.url}/internal/rooms/${socket.stageId}/produce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      socketId: socket.id,
      transportId: data.transportId,
      kind: data.kind,
      rtpParameters: data.rtpParameters
    })
  });
  const { producerId } = await resp.json();

  // Update participant record
  const participant = stage.participants.get(socket.participantId);
  if (participant) participant.published = true;

  // Notify stage
  socket.to(socket.stageId).emit('stage-participant-published', {
    stageId: socket.stageId,
    participantId: socket.participantId,
    kind: data.kind
  });

  socket.to(socket.stageId).emit('newProducer', {
    producerId,
    socketId: socket.id,
    participantId: socket.participantId,
    kind: data.kind
  });

  callback({ id: producerId });
});
```

### Consume with capability check

```js
socket.on('consume', async (data, callback) => {
  if (!socket.capabilities || !socket.capabilities.includes('SUBSCRIBE')) {
    return callback({ error: 'SUBSCRIBE_NOT_ALLOWED' });
  }

  const stage = stageManager.stages.get(socket.stageId);
  const resp = await fetch(`${stage.mediasoupPod.url}/internal/rooms/${socket.stageId}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      socketId: socket.id,
      transportId: data.transportId,
      producerId: data.producerId,
      rtpCapabilities: data.rtpCapabilities
    })
  });
  const result = await resp.json();
  callback(result);
});
```

### Disconnect cleanup

```js
socket.on('disconnect', async () => {
  const stageId = socketToStage.get(socket.id);
  if (!stageId) return;

  const stage = stageManager.stages.get(stageId);
  if (stage) {
    // Update participant state
    const participant = stage.participants.get(socket.participantId);
    if (participant) {
      participant.state = 'DISCONNECTED';
      participant.published = false;
    }

    // Notify stage
    socket.to(stageId).emit('stage-participant-left', {
      stageId,
      participantId: socket.participantId,
      userId: participant?.userId
    });

    // Cleanup on mediasoup
    await fetch(`${stage.mediasoupPod.url}/internal/rooms/${stageId}/cleanup/${socket.id}`, {
      method: 'POST'
    }).catch(() => {}); // Best effort

    // Remove participant
    stage.participants.delete(socket.participantId);

    // If stage is now empty, transition to IDLE
    if (stage.participants.size === 0) {
      stage.state = 'IDLE';
      stage.activeSessionId = null;
    }
  }

  socketToStage.delete(socket.id);
});
```

## ParticipantRecord Shape

```js
{
  participantId: 'pid_abc',
  userId: 'user-456',
  capabilities: ['PUBLISH', 'SUBSCRIBE'],
  attributes: { displayName: 'Bob', role: 'host' },
  socketId: 'socket-xyz',
  state: 'CONNECTED',          // CONNECTED | DISCONNECTED
  published: true,
  firstJoinTime: Date,
}
```

## Verification Script: `scripts/test-participant-flow.js`

```
1.  Create stage via POST /api/stages
2.  Create publisher token: capabilities=['PUBLISH','SUBSCRIBE']
3.  Create viewer token: capabilities=['SUBSCRIBE']

4.  Publisher connects, emits join-stage with publisher token
    Assert: callback has routerRtpCapabilities

5.  Publisher creates producer transport
6.  Publisher produces video
7.  Publisher produces audio
    Assert: 2 produce callbacks with valid producerIds

8.  Viewer connects, emits join-stage with viewer token
    Assert: callback has existingProducers with 2 entries (video + audio)

9.  Viewer creates consumer transport
10. Viewer consumes video producer
11. Viewer consumes audio producer
    Assert: 2 consume callbacks with valid consumer params

12. Viewer resumes both consumers

13. Viewer attempts to produce
    Assert: callback has error 'PUBLISH_NOT_ALLOWED'

14. GET /api/stages/:stageId/participants
    Assert: 2 participants, publisher has published=true

15. GET /api/stages/:stageId/participants?filterByPublished=true
    Assert: 1 result (publisher only)

16. DELETE /api/stages/:stageId/participants/:publisherPid
    Assert: 200
    Assert: viewer receives 'stage-participant-left' event

17. GET /api/stages/:stageId/participants
    Assert: 1 participant (viewer only)

18. Exit 0
```

## Files Changed
- `src/signaling-server.js` — participant endpoints, socket handlers
- `scripts/test-participant-flow.js` — new file
